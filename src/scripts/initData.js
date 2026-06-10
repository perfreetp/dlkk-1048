require('dotenv').config();
const connectDB = require('../config/database');
const logger = require('../utils/logger');
const House = require('../models/House');
const Resident = require('../models/Resident');
const PropertyFee = require('../models/PropertyFee');
const DunningTemplate = require('../models/DunningTemplate');
const moment = require('moment');

const initHouses = async () => {
  const buildings = ['1号楼', '2号楼', '3号楼', '5号楼', '6号楼', '7号楼', '8号楼', '9号楼'];
  const units = ['1单元', '2单元'];
  const floors = 30;
  const roomsPerFloor = 4;

  const houses = [];
  const residents = [];
  const fees = [];

  for (const building of buildings) {
    for (const unit of units) {
      for (let floor = 1; floor <= floors; floor++) {
        for (let room = 1; room <= roomsPerFloor; room++) {
          const roomNo = `${floor.toString().padStart(2, '0')}${room.toString().padStart(2, '0')}`;
          const houseNo = `${building}${unit}${roomNo}`;
          const area = 80 + Math.floor(Math.random() * 80);
          const ownerName = `业主${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
          const phone = `138${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;

          const house = {
            houseNo,
            building,
            unit,
            floor,
            roomNo,
            area,
            propertyType: ['住宅', '商铺'][Math.floor(Math.random() * 2)],
            ownerName,
            ownerPhone: phone,
            status: Math.random() > 0.1 ? '已收房' : '未收房',
            deliveryDate: moment().subtract(2 + Math.floor(Math.random() * 3), 'years').toDate()
          };

          houses.push(house);

          if (house.status === '已收房') {
            const resident = {
              houseId: null,
              name: ownerName,
              phone,
              idCard: `110101${moment().subtract(30 + Math.floor(Math.random() * 30), 'years').format('YYYYMMDD')}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
              isBlacklist: Math.random() < 0.02,
              blacklistReason: Math.random() < 0.02 ? '恶意拖欠物业费' : null,
              complaintCount: Math.floor(Math.random() * 3),
              isInComplaintHandling: Math.random() < 0.05,
              customerRemark: Math.random() < 0.3 ? '该住户对物业服务有特殊要求' : null,
              promisedPaymentDate: Math.random() < 0.1 ? moment().add(Math.floor(Math.random() * 30), 'days').toDate() : null
            };
            residents.push(resident);

            const feeMonths = 12;
            const unitPrice = house.propertyType === '住宅' ? 2.5 : 5.0;
            for (let m = feeMonths - 1; m >= 0; m--) {
              const feeMonth = moment().subtract(m, 'months').startOf('month');
              const totalAmount = area * unitPrice;
              const unpaidMonths = Math.floor(Math.random() * 8);
              const isUnpaid = m < unpaidMonths;
              const paidAmount = isUnpaid ? (Math.random() > 0.7 ? totalAmount * 0.3 : 0) : totalAmount;
              const unpaidAmount = totalAmount - paidAmount;

              const dueDate = feeMonth.clone().add(1, 'month').date(15);
              const overdueDays = isUnpaid && unpaidAmount > 0 ? moment().diff(dueDate, 'days') : 0;

              let overdueLevel = '正常';
              if (overdueDays > 180) overdueLevel = '三级';
              else if (overdueDays > 90) overdueLevel = '二级';
              else if (overdueDays > 30) overdueLevel = '一级';

              fees.push({
                houseId: null,
                residentId: null,
                feeYear: feeMonth.year(),
                feeMonth: feeMonth.month() + 1,
                feePeriod: `${feeMonth.format('YYYY-MM')}`,
                feeType: '物业费',
                billingArea: area,
                unitPrice,
                totalAmount,
                paidAmount,
                unpaidAmount,
                paymentStatus: unpaidAmount > 0 ? '未结清' : '已结清',
                dueDate: dueDate.toDate(),
                actualPaymentDate: paidAmount > 0 ? feeMonth.clone().add(10, 'days').toDate() : null,
                isOverdue: unpaidAmount > 0 && overdueDays > 0,
                overdueDays,
                overdueLevel,
                recalculated: false,
                recalculationHistory: []
              });
            }
          }
        }
      }
    }
  }

  try {
    logger.info(`开始初始化数据...`);
    logger.info(`房屋数据: ${houses.length} 条`);
    logger.info(`住户数据: ${residents.length} 条`);
    logger.info(`费用数据: ${fees.length} 条`);

    await House.deleteMany({});
    await Resident.deleteMany({});
    await PropertyFee.deleteMany({});

    const insertedHouses = await House.insertMany(houses);
    logger.info(`房屋数据插入完成`);

    for (let i = 0; i < residents.length; i++) {
      residents[i].houseId = insertedHouses[i]._id;
    }
    const insertedResidents = await Resident.insertMany(residents);
    logger.info(`住户数据插入完成`);

    let houseIndex = 0;
    let residentIndex = 0;
    for (let i = 0; i < fees.length; i++) {
      if (i > 0 && i % 12 === 0) {
        houseIndex++;
        residentIndex++;
      }
      fees[i].houseId = insertedHouses[houseIndex]._id;
      fees[i].residentId = insertedResidents[residentIndex]._id;
    }
    await PropertyFee.insertMany(fees);
    logger.info(`费用数据插入完成`);

    return { houses: insertedHouses.length, residents: insertedResidents.length, fees: fees.length };
  } catch (error) {
    logger.error('初始化数据失败:', error);
    throw error;
  }
};

const initTemplates = async () => {
  const templates = [
    {
      templateCode: 'SMS_REMIND_LEVEL1',
      templateName: '一级逾期短信提醒',
      channel: '短信',
      dunningStage: '提醒期',
      overdueLevel: '一级',
      content: '【XX物业】尊敬的{业主姓名}您好，您的{房屋地址}物业费已逾期{逾期天数}天，欠费金额{欠费金额}元，请您尽快缴纳。如有疑问请致电：400-XXXX-XXXX',
      variables: ['业主姓名', '房屋地址', '逾期天数', '欠费金额'],
      priority: 3,
      isEnabled: true
    },
    {
      templateCode: 'SMS_REMIND_LEVEL2',
      templateName: '二级逾期短信催告',
      channel: '短信',
      dunningStage: '催告期',
      overdueLevel: '二级',
      content: '【XX物业】尊敬的{业主姓名}您好，您的{房屋地址}物业费已逾期{逾期天数}天，欠费金额{欠费金额}元。请您于{截止日期}前缴纳，否则我司将采取进一步催缴措施。咨询电话：400-XXXX-XXXX',
      variables: ['业主姓名', '房屋地址', '逾期天数', '欠费金额', '截止日期'],
      priority: 2,
      isEnabled: true
    },
    {
      templateCode: 'SMS_REMIND_LEVEL3',
      templateName: '三级逾期短信警告',
      channel: '短信',
      dunningStage: '严厉期',
      overdueLevel: '三级',
      content: '【XX物业】重要通知：{业主姓名}您好，您的{房屋地址}物业费已逾期{逾期天数}天，欠费金额{欠费金额}元。请立即缴纳，否则我司将启动法律程序追讨欠费。咨询电话：400-XXXX-XXXX',
      variables: ['业主姓名', '房屋地址', '逾期天数', '欠费金额'],
      priority: 1,
      isEnabled: true
    },
    {
      templateCode: 'CALL_REMIND_LEVEL1',
      templateName: '一级逾期电话提醒',
      channel: '电话',
      dunningStage: '提醒期',
      overdueLevel: '一级',
      content: '您好，我是XX物业的客服代表{客服姓名}。请问是{业主姓名}先生/女士吗？关于您{房屋地址}的物业费，目前已逾期{逾期天数}天，欠费金额{欠费金额}元。想提醒您尽快缴费，请问您是遇到什么问题了吗？',
      variables: ['客服姓名', '业主姓名', '房屋地址', '逾期天数', '欠费金额'],
      priority: 3,
      isEnabled: true
    },
    {
      templateCode: 'CALL_REMIND_LEVEL2',
      templateName: '二级逾期电话催告',
      channel: '电话',
      dunningStage: '催告期',
      overdueLevel: '二级',
      content: '您好，我是XX物业的客服代表{客服姓名}。再次致电是关于您{房屋地址}的物业费，目前已逾期{逾期天数}天，欠费金额{欠费金额}元。希望您能在{截止日期}前完成缴费，否则我们可能需要安排工作人员上门拜访。',
      variables: ['客服姓名', '业主姓名', '房屋地址', '逾期天数', '欠费金额', '截止日期'],
      priority: 2,
      isEnabled: true
    },
    {
      templateCode: 'PAYMENT_THANK_YOU',
      templateName: '缴费感谢短信',
      channel: '短信',
      dunningStage: '提醒期',
      overdueLevel: '正常',
      content: '【XX物业】尊敬的{业主姓名}您好，感谢您已缴纳{房屋地址}物业费{缴费金额}元。如有任何物业服务需求，请随时联系我们。',
      variables: ['业主姓名', '房屋地址', '缴费金额'],
      priority: 5,
      isEnabled: true
    },
    {
      templateCode: 'PROMISE_REMINDER',
      templateName: '承诺付款到期提醒',
      channel: '短信',
      dunningStage: '提醒期',
      overdueLevel: '一级',
      content: '【XX物业】尊敬的{业主姓名}您好，您承诺的{承诺日期}付款日期即将到来，请您按时缴纳{房屋地址}物业费{欠费金额}元。感谢您的配合。',
      variables: ['业主姓名', '承诺日期', '房屋地址', '欠费金额'],
      priority: 2,
      isEnabled: true
    },
    {
      templateCode: 'BIRTHDAY_GREETING',
      templateName: '业主生日祝福',
      channel: '短信',
      dunningStage: '提醒期',
      overdueLevel: '正常',
      content: '【XX物业】尊敬的{业主姓名}您好，在您生日来临之际，XX物业全体员工祝您生日快乐，阖家幸福！',
      variables: ['业主姓名'],
      priority: 5,
      isEnabled: true
    }
  ];

  try {
    await DunningTemplate.deleteMany({});
    const result = await DunningTemplate.insertMany(templates);
    logger.info(`催缴模板初始化完成，共 ${result.length} 条`);
    return result.length;
  } catch (error) {
    logger.error('初始化催缴模板失败:', error);
    throw error;
  }
};

const initAll = async () => {
  try {
    await connectDB();
    logger.info('数据库连接成功，开始初始化数据...');

    const counts = await initHouses();
    const templateCount = await initTemplates();

    logger.info('========================================');
    logger.info('🎉 数据初始化完成！');
    logger.info('========================================');
    logger.info(`房屋数据: ${counts.houses} 条`);
    logger.info(`住户数据: ${counts.residents} 条`);
    logger.info(`费用数据: ${counts.fees} 条`);
    logger.info(`催缴模板: ${templateCount} 条`);
    logger.info('========================================');

    process.exit(0);
  } catch (error) {
    logger.error('数据初始化失败:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  initAll();
}

module.exports = { initAll, initHouses, initTemplates };
