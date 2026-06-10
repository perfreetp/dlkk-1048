require('dotenv').config();
const connectDB = require('../config/database');
const logger = require('../utils/logger');
const { generateNo } = require('../utils/common');
const House = require('../models/House');
const Resident = require('../models/Resident');
const PropertyFee = require('../models/PropertyFee');
const DunningTemplate = require('../models/DunningTemplate');
const moment = require('moment');

const initHouses = async () => {
  const buildings = ['1号楼', '2号楼', '3号楼', '5号楼', '6号楼', '7号楼', '8号楼', '9号楼'];
  const units = ['1单元', '2单元'];
  const floors = 10;
  const roomsPerFloor = 2;

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
            propertyType: Math.random() > 0.2 ? '住宅' : '商铺',
            ownerName,
            ownerPhone: phone,
            status: Math.random() > 0.05 ? '已收房' : '未收房',
            deliveryDate: moment().subtract(2 + Math.floor(Math.random() * 3), 'years').toDate()
          };

          houses.push(house);
        }
      }
    }
  }

  try {
    logger.info(`开始初始化数据...`);
    logger.info(`房屋数据: ${houses.length} 条`);

    await House.deleteMany({});
    await Resident.deleteMany({});
    await PropertyFee.deleteMany({});

    const insertedHouses = await House.insertMany(houses);
    logger.info(`✅ 房屋数据插入完成: ${insertedHouses.length} 条`);

    const occupiedHouses = insertedHouses.filter(h => h.status === '已收房');
    logger.info(`已收房房屋: ${occupiedHouses.length} 条`);

    for (const house of occupiedHouses) {
      const isBlacklist = Math.random() < 0.02;
      const isInComplaintHandling = Math.random() < 0.05;
      const hasPromise = Math.random() < 0.1;

      const resident = {
        residentNo: generateNo('RES'),
        houseId: house._id,
        name: house.ownerName,
        phone: house.ownerPhone,
        idCard: `110101${moment().subtract(30 + Math.floor(Math.random() * 30), 'years').format('YYYYMMDD')}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
        isBlacklist,
        blacklistReason: isBlacklist ? '恶意拖欠物业费' : null,
        complaintCount: Math.floor(Math.random() * 3),
        isInComplaintHandling,
        customerRemark: Math.random() < 0.3 ? '该住户对物业服务有特殊要求' : null,
        promisedPaymentDate: hasPromise ? moment().add(Math.floor(Math.random() * 30), 'days').toDate() : null
      };
      residents.push(resident);
    }

    const insertedResidents = await Resident.insertMany(residents);
    logger.info(`✅ 住户数据插入完成: ${insertedResidents.length} 条`);

    for (let i = 0; i < insertedResidents.length; i++) {
      const resident = insertedResidents[i];
      const house = occupiedHouses[i];
      if (house) {
        await House.findByIdAndUpdate(house._id, { residentId: resident._id });
      }
    }
    logger.info(`✅ 房屋-住户关联完成`);

    const residentMap = {};
    for (const r of insertedResidents) {
      residentMap[r.houseId.toString()] = r;
    }

    const feeMonths = 12;
    for (const house of occupiedHouses) {
      const resident = residentMap[house._id.toString()];
      if (!resident) continue;

      const unitPrice = house.propertyType === '住宅' ? 2.5 : 5.0;
      const unpaidMonths = Math.floor(Math.random() * 8);

      for (let m = feeMonths - 1; m >= 0; m--) {
        const feeMonth = moment().subtract(m, 'months').startOf('month');
        const totalAmount = Number((house.area * unitPrice).toFixed(2));
        const isUnpaid = m < unpaidMonths;
        const paidAmount = isUnpaid
          ? (Math.random() > 0.7 ? Number((totalAmount * 0.3).toFixed(2)) : 0)
          : totalAmount;
        const unpaidAmount = Number((totalAmount - paidAmount).toFixed(2));

        const dueDate = feeMonth.clone().add(1, 'month').date(15);
        const overdueDays = isUnpaid && unpaidAmount > 0 ? Math.max(0, moment().diff(dueDate, 'days')) : 0;

        let overdueLevel = '正常';
        if (overdueDays > 180) overdueLevel = '三级';
        else if (overdueDays > 90) overdueLevel = '二级';
        else if (overdueDays > 30) overdueLevel = '一级';

        let dunningStage = '提醒期';
        if (overdueDays >= 365) dunningStage = '法律期';
        else if (overdueDays >= 180) dunningStage = '严厉期';
        else if (overdueDays >= 90) dunningStage = '催告期';

        fees.push({
          feeNo: generateNo('FEE'),
          houseId: house._id,
          houseNo: house.houseNo,
          residentId: resident._id,
          feeYear: feeMonth.year(),
          feeMonth: feeMonth.month() + 1,
          feePeriod: `${feeMonth.format('YYYY-MM')}`,
          feeType: '物业费',
          billingArea: house.area,
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
          dunningStage,
          recalculated: false,
          recalculationHistory: []
        });
      }
    }

    const insertedFees = await PropertyFee.insertMany(fees);
    logger.info(`✅ 费用数据插入完成: ${insertedFees.length} 条`);

    const unpaidFees = insertedFees.filter(f => f.unpaidAmount > 0);
    const totalUnpaidAmount = unpaidFees.reduce((sum, f) => sum + f.unpaidAmount, 0);
    const overdueHouses = new Set(unpaidFees.map(f => f.houseId.toString())).size;

    logger.info(`----------------------------------------`);
    logger.info(`欠费统计:`);
    logger.info(`  欠费笔数: ${unpaidFees.length}`);
    logger.info(`  欠费户数: ${overdueHouses}`);
    logger.info(`  欠费总额: ¥${totalUnpaidAmount.toFixed(2)}`);
    logger.info(`  逾期等级分布:`);
    for (const level of ['正常', '一级', '二级', '三级']) {
      const count = unpaidFees.filter(f => f.overdueLevel === level).length;
      logger.info(`    ${level}: ${count} 笔`);
    }

    return {
      houses: insertedHouses.length,
      residents: insertedResidents.length,
      fees: insertedFees.length,
      sampleHouseNo: occupiedHouses.length > 0 ? occupiedHouses[0].houseNo : null,
      sampleHouse: occupiedHouses.length > 0 ? occupiedHouses[0] : null
    };
  } catch (error) {
    logger.error('初始化数据失败:', error);
    throw error;
  }
};

const initTemplates = async () => {
  const templates = [
    {
      templateCode: 'SMS_REMIND_L1',
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
      templateCode: 'SMS_REMIND_L2',
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
      templateCode: 'SMS_REMIND_L3',
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
      templateCode: 'SMS_REMIND_NORMAL',
      templateName: '常规短信提醒',
      channel: '短信',
      dunningStage: '提醒期',
      overdueLevel: '正常',
      content: '【XX物业】尊敬的{业主姓名}您好，您的{房屋地址}本期物业费{欠费金额}元，缴费截止日{截止日期}，请您及时缴纳。',
      variables: ['业主姓名', '房屋地址', '欠费金额', '截止日期'],
      priority: 4,
      isEnabled: true
    },
    {
      templateCode: 'CALL_REMIND_L1',
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
      templateCode: 'CALL_REMIND_L2',
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
      templateCode: 'LETTER_REMIND_L3',
      templateName: '三级逾期催缴函',
      channel: '信函',
      dunningStage: '严厉期',
      overdueLevel: '三级',
      content: '催缴函：{业主姓名}您好，您所居住的{房屋地址}物业费已逾期{逾期天数}天，累计欠费{欠费金额}元。请于收到本函7日内完成缴费，否则我司将依法追究违约责任。',
      variables: ['业主姓名', '房屋地址', '逾期天数', '欠费金额'],
      priority: 1,
      isEnabled: true
    },
    {
      templateCode: 'VISIT_REMIND_L3',
      templateName: '上门催缴记录',
      channel: '上门',
      dunningStage: '严厉期',
      overdueLevel: '三级',
      content: '上门催缴：{房屋地址}业主{业主姓名}，已逾期{逾期天数}天，欠费{欠费金额}元。{上门记录}',
      variables: ['房屋地址', '业主姓名', '逾期天数', '欠费金额', '上门记录'],
      priority: 1,
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
    }
  ];

  try {
    await DunningTemplate.deleteMany({});
    const templatesWithNo = templates.map(t => ({
      ...t,
      templateNo: generateNo('TPL')
    }));
    const result = await DunningTemplate.insertMany(templatesWithNo);
    logger.info(`✅ 催缴模板初始化完成，共 ${result.length} 条`);

    const channels = [...new Set(result.map(t => t.channel))];
    for (const ch of channels) {
      const list = result.filter(t => t.channel === ch);
      logger.info(`  ${ch}: ${list.map(t => t.templateName).join(', ')}`);
    }

    return result.length;
  } catch (error) {
    logger.error('初始化催缴模板失败:', error);
    throw error;
  }
};

const initAll = async () => {
  try {
    await connectDB();
    logger.info('========================================');
    logger.info('数据库连接成功，开始初始化数据...');
    logger.info('========================================\n');

    const counts = await initHouses();
    logger.info('');
    const templateCount = await initTemplates();

    logger.info('\n========================================');
    logger.info('🎉 数据初始化完成！');
    logger.info('========================================');
    logger.info(`房屋数据:   ${counts.houses} 条`);
    logger.info(`住户数据:   ${counts.residents} 条`);
    logger.info(`费用数据:   ${counts.fees} 条`);
    logger.info(`催缴模板:   ${templateCount} 条`);
    logger.info('========================================');
    if (counts.sampleHouseNo) {
      logger.info(`💡 测试房号示例: ${counts.sampleHouseNo}`);
      logger.info(`   该房号已关联住户和欠费记录，可用于接口测试`);
    }
    logger.info('========================================\n');

    return { ...counts, templateCount };
  } catch (error) {
    logger.error('数据初始化失败:', error);
    throw error;
  }
};

if (require.main === module) {
  initAll()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { initAll, initHouses, initTemplates };
