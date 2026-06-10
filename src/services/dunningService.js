const moment = require('moment');
const DunningTask = require('../models/DunningTask');
const DunningTemplate = require('../models/DunningTemplate');
const MessageQueue = require('../models/MessageQueue');
const PropertyFee = require('../models/PropertyFee');
const House = require('../models/House');
const Resident = require('../models/Resident');
const Complaint = require('../models/Complaint');
const config = require('../config');
const logger = require('../utils/logger');
const {
  generateNo,
  calculateOverdueLevel,
  calculateOverdueDays,
  calculateDunningStage,
  parsePageParams,
  buildPaginationResult,
  buildSortParams,
  getObjectDiff
} = require('../utils/common');
const { NotFoundError, BusinessError } = require('../utils/errors');
const { logOperation } = require('../middleware');

const getTemplates = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = { isEnabled: true };

  if (params.channel || params.templateType) {
    query.$or = [
      { channel: params.channel || params.templateType },
      { templateType: params.channel || params.templateType }
    ];
  }
  if (params.dunningStage) {
    query.dunningStage = params.dunningStage;
  }
  if (params.overdueLevel) {
    query.overdueLevel = params.overdueLevel;
  }
  if (params.isEnabled !== undefined) {
    query.isEnabled = params.isEnabled;
  }
  if (params.keyword) {
    query.$or = [
      { templateName: { $regex: params.keyword, $options: 'i' } },
      { templateCode: { $regex: params.keyword, $options: 'i' } },
      { title: { $regex: params.keyword, $options: 'i' } }
    ];
  }

  const [templates, total] = await Promise.all([
    DunningTemplate.find(query).sort(sort).skip(skip).limit(pageSize),
    DunningTemplate.countDocuments(query)
  ]);

  return buildPaginationResult(templates, total, page, pageSize);
};

const getTemplateById = async (templateId) => {
  const template = await DunningTemplate.findById(templateId);
  if (!template) {
    throw new NotFoundError('模板不存在');
  }
  return template;
};

const selectTemplate = async (dunningType, dunningStage, overdueLevel) => {
  const query = {
    dunningStage,
    isEnabled: true,
    $or: [
      { channel: dunningType },
      { templateType: dunningType }
    ]
  };

  if (overdueLevel) {
    query.overdueLevel = overdueLevel;
  }

  let templates = await DunningTemplate.find(query).sort({ priority: -1, isDefault: -1 });

  if (templates.length === 0 && overdueLevel) {
    delete query.overdueLevel;
    templates = await DunningTemplate.find(query).sort({ priority: -1, isDefault: -1 });
  }

  if (templates.length === 0) {
    throw new NotFoundError(`未找到匹配的催缴模板（${dunningType} / ${dunningStage} / ${overdueLevel || '任意等级'}）`);
  }

  return templates[0];
};

const renderTemplate = (template, data) => {
  let content = template.content || '';
  let title = template.title || template.templateName || '';

  const varMap = {};
  if (template.variables && Array.isArray(template.variables)) {
    for (const v of template.variables) {
      const name = typeof v === 'string' ? v : v.name;
      varMap[name] = name;
    }
  }

  for (const [key, value] of Object.entries(data)) {
    const displayValue = value === null || value === undefined ? '' : String(value);
    const regex1 = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    const regex2 = new RegExp(`\\{${key}\\}`, 'g');
    content = content.replace(regex1, displayValue).replace(regex2, displayValue);
    title = title.replace(regex1, displayValue).replace(regex2, displayValue);

    if (varMap[key]) {
      const regex3 = new RegExp(`\\{${varMap[key]}\\}`, 'g');
      content = content.replace(regex3, displayValue);
      title = title.replace(regex3, displayValue);
    }
  }

  return { title, content };
};

const checkDunningEligibility = async (houseId, filters = {}) => {
  const house = await House.findById(houseId);
  if (!house) {
    return { eligible: false, reason: '房屋不存在' };
  }

  const resident = await Resident.findOne({ houseId: house._id });

  if (filters.excludeBlacklist !== false && resident && resident.isBlacklist) {
    return { eligible: false, reason: '黑名单用户' };
  }

  if (filters.excludeComplaint) {
    const activeComplaints = await Complaint.find({
      houseId,
      status: { $in: ['待处理', '处理中'] },
      excludeFromDunning: true
    });
    if (activeComplaints.length > 0) {
      return { eligible: false, reason: '存在未处理投诉' };
    }
  }
  if (resident && resident.isInComplaintHandling) {
    return { eligible: false, reason: '投诉处理中' };
  }

  if (filters.excludePromised && resident && resident.promisedPaymentDate) {
    if (moment(resident.promisedPaymentDate).isAfter(moment())) {
      return { eligible: false, reason: '已承诺付款' };
    }
  }

  if (filters.excludeRecentDunning !== false) {
    const cooldownHours = config.dunning.cooldownHours || 24;
    const cutoffTime = moment().subtract(cooldownHours, 'hours').toDate();
    const recentMessages = await MessageQueue.findOne({
      houseId,
      createdAt: { $gte: cutoffTime },
      status: { $in: ['已发送', '已送达', '已读', '已回复'] }
    }).sort({ createdAt: -1 });

    if (recentMessages) {
      return {
        eligible: false,
        reason: `催缴冷却期内（上次催缴：${moment(recentMessages.createdAt).format('YYYY-MM-DD HH:mm')}）`
      };
    }
  }

  return { eligible: true, house, resident };
};

const buildTaskFilters = async (filters) => {
  const feeQuery = {
    unpaidAmount: { $gt: 0 },
    paymentStatus: { $in: ['未结清', '部分缴', '未缴'] }
  };

  if (filters.houseNos && filters.houseNos.length > 0) {
    feeQuery.houseNo = { $in: filters.houseNos };
  }

  if (filters.feeTypes && filters.feeTypes.length > 0) {
    feeQuery.feeType = { $in: filters.feeTypes };
  }

  if (filters.overdueLevels && filters.overdueLevels.length > 0) {
    feeQuery.overdueLevel = { $in: filters.overdueLevels };
  }

  if (filters.minOverdueDays !== undefined) {
    feeQuery.overdueDays = { $gte: filters.minOverdueDays };
  }
  if (filters.maxOverdueDays !== undefined) {
    feeQuery.overdueDays = { ...(feeQuery.overdueDays || {}), $lte: filters.maxOverdueDays };
  }

  if (filters.minArrearsAmount !== undefined) {
    feeQuery.unpaidAmount = { $gte: filters.minArrearsAmount };
  }
  if (filters.maxArrearsAmount !== undefined) {
    feeQuery.unpaidAmount = { ...(feeQuery.unpaidAmount || {}), $lte: filters.maxArrearsAmount };
  }

  const fees = await PropertyFee.find(feeQuery).populate('houseId');

  const houseFeeMap = new Map();
  for (const fee of fees) {
    const house = fee.houseId;
    if (!house) continue;
    const houseId = house._id.toString();

    if (!houseFeeMap.has(houseId)) {
      const resident = await Resident.findOne({ houseId: house._id });
      houseFeeMap.set(houseId, {
        house,
        resident,
        fees: [],
        totalArrears: 0,
        maxOverdueDays: 0
      });
    }
    const entry = houseFeeMap.get(houseId);
    entry.fees.push(fee);
    entry.totalArrears = Number((entry.totalArrears + fee.unpaidAmount).toFixed(2));
    entry.maxOverdueDays = Math.max(entry.maxOverdueDays, fee.overdueDays || 0);
  }

  const eligibleItems = [];
  for (const [houseId, entry] of houseFeeMap) {
    if (!entry.house) continue;

    const eligibility = await checkDunningEligibility(entry.house._id, filters);
    if (!eligibility.eligible) continue;

    if (filters.buildings && filters.buildings.length > 0) {
      if (!filters.buildings.includes(entry.house.building)) continue;
    }

    if (filters.units && filters.units.length > 0) {
      if (!filters.units.includes(entry.house.unit)) continue;
    }

    if (filters.residentIds && filters.residentIds.length > 0) {
      if (!entry.resident || !filters.residentIds.includes(entry.resident._id.toString())) continue;
    }

    eligibleItems.push({
      houseId: entry.house._id,
      houseNo: entry.house.houseNo,
      residentId: entry.resident ? entry.resident._id : null,
      residentName: entry.resident ? entry.resident.name : entry.house.ownerName,
      residentPhone: entry.resident ? entry.resident.phone : entry.house.ownerPhone,
      feeIds: entry.fees.map(f => f._id),
      totalArrears: entry.totalArrears,
      overdueDays: entry.maxOverdueDays,
      overdueLevel: calculateOverdueLevel(entry.maxOverdueDays),
      status: '待处理'
    });
  }

  return eligibleItems;
};

const createDunningTask = async (params, operator) => {
  const {
    taskName,
    taskType = '手动',
    dunningType = '短信',
    dunningStage = '提醒期',
    templateId,
    filters = {},
    scheduledAt,
    requiresApproval = false
  } = params;

  let template;
  if (templateId) {
    template = await DunningTemplate.findById(templateId);
    if (!template) {
      throw new NotFoundError('模板不存在');
    }
  } else {
    const overdueLv = filters.overdueLevels && filters.overdueLevels.length > 0 ? filters.overdueLevels[0] : null;
    template = await selectTemplate(dunningType, dunningStage, overdueLv);
  }

  if (!template.isEnabled) {
    throw new BusinessError('所选模板已禁用');
  }

  const items = await buildTaskFilters(filters);

  if (items.length === 0) {
    throw new BusinessError('没有符合条件的催缴对象（可能已全部催缴、被拉黑或在冷却期）');
  }

  const taskNo = generateNo('TASK');
  const finalStage = dunningStage || template.dunningStage || '提醒期';

  const task = new DunningTask({
    taskNo,
    taskName,
    taskType,
    dunningType,
    dunningStage: finalStage,
    templateId: template._id,
    templateNo: template.templateNo,
    filters,
    items,
    totalCount: items.length,
    status: scheduledAt ? '待执行' : '待执行',
    scheduledAt,
    requiresApproval,
    approvalStatus: requiresApproval ? '待审批' : '无需审批',
    createdBy: operator
  });

  await task.save();

  await logOperation({
    operator,
    operationType: '创建',
    operationModule: '催缴任务',
    targetType: 'DunningTask',
    targetId: task._id,
    targetNo: taskNo,
    operationContent: `创建催缴任务 ${taskName}，匹配 ${items.length} 户`,
    afterData: task.toObject(),
    operationResult: '成功'
  });

  return {
    task,
    matchedCount: items.length,
    template
  };
};

const getDunningTasks = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.taskNo) query.taskNo = params.taskNo;
  if (params.taskType) query.taskType = params.taskType;
  if (params.dunningType) query.dunningType = params.dunningType;
  if (params.dunningStage) query.dunningStage = params.dunningStage;
  if (params.status) query.status = params.status;
  if (params.approvalStatus) query.approvalStatus = params.approvalStatus;
  if (params.createdBy) query.createdBy = params.createdBy;
  if (params.startDate && params.endDate) {
    query.createdAt = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }

  const [tasks, total] = await Promise.all([
    DunningTask.find(query)
      .populate('templateId', 'templateName channel templateType')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    DunningTask.countDocuments(query)
  ]);

  return buildPaginationResult(tasks, total, page, pageSize);
};

const getDunningTaskDetail = async (taskId) => {
  const task = await DunningTask.findById(taskId).populate('templateId');
  if (!task) {
    throw new NotFoundError('催缴任务不存在');
  }
  return task;
};

const executeDunningTask = async (taskId, operator) => {
  const task = await DunningTask.findById(taskId).populate('templateId');
  if (!task) {
    throw new NotFoundError('催缴任务不存在');
  }

  if (task.requiresApproval && task.approvalStatus !== '已批准') {
    throw new BusinessError('任务需要审批后才能执行');
  }

  if (task.status !== '待执行') {
    throw new BusinessError(`任务状态为${task.status}，不能重复执行`);
  }

  const template = task.templateId;

  task.status = '执行中';
  task.executedAt = new Date();
  await task.save();

  const queueItems = [];
  let successCount = 0;
  let failedCount = 0;

  for (let i = 0; i < task.items.length; i++) {
    const item = task.items[i];

    try {
      const house = await House.findById(item.houseId);
      const resident = item.residentId ? await Resident.findById(item.residentId) : null;

      const renderData = {
        '业主姓名': item.residentName,
        '房屋地址': item.houseNo,
        '房屋信息': item.houseNo,
        '欠费金额': item.totalArrears.toFixed(2),
        '逾期天数': item.overdueDays,
        '逾期等级': item.overdueLevel,
        '当前日期': moment().format('YYYY年MM月DD日'),
        '截止日期': moment().add(7, 'days').format('YYYY年MM月DD日'),
        '承诺日期': resident && resident.promisedPaymentDate ? moment(resident.promisedPaymentDate).format('YYYY年MM月DD日') : '',
        '客服姓名': operator || '客服专员',
        '缴费金额': item.totalArrears.toFixed(2),
        '上门记录': '上门沟通，业主表示将尽快缴费'
      };

      const { title, content } = renderTemplate(template, renderData);

      const queueNo = generateNo('MSG');
      const priorityVal = task.dunningStage === '法律期' ? 3 : task.dunningStage === '严厉期' ? 2 : task.dunningStage === '催告期' ? 1 : 0;

      const queueItem = new MessageQueue({
        queueNo,
        taskId: task._id,
        taskNo: task.taskNo,
        taskItemId: item._id,
        messageType: task.dunningType,
        templateId: template._id,
        templateNo: template.templateNo,
        houseId: item.houseId,
        houseNo: item.houseNo,
        residentId: item.residentId,
        residentName: item.residentName,
        phone: item.residentPhone || '13800000000',
        title,
        content,
        feeIds: item.feeIds,
        totalArrears: item.totalArrears,
        priority: priorityVal,
        status: '待发送',
        scheduledAt: task.scheduledAt || new Date(),
        createdBy: operator
      });

      await queueItem.save();
      queueItems.push(queueItem);

      task.items[i].status = '已发送';
      task.items[i].sentAt = new Date();
      successCount++;

      if (resident) {
        resident.lastDunningTime = new Date();
        await resident.save();
      }

      await DunningTemplate.findByIdAndUpdate(template._id, {
        $inc: { usageCount: 1 }
      });

    } catch (error) {
      logger.error(`创建催缴消息失败 [${item.houseNo}]: ${error.message}`, error);
      task.items[i].status = '失败';
      task.items[i].remark = error.message;
      failedCount++;
    }
  }

  task.status = failedCount === 0 ? '已完成' : (successCount > 0 ? '部分成功' : '已完成');
  task.successCount = successCount;
  task.failedCount = failedCount;
  task.completedAt = new Date();
  await task.save();

  await logOperation({
    operator,
    operationType: '发送',
    operationModule: '催缴任务',
    targetType: 'DunningTask',
    targetId: task._id,
    targetNo: task.taskNo,
    operationContent: `执行催缴任务 ${task.taskName}，成功 ${successCount} 条，失败 ${failedCount} 条`,
    operationResult: '成功'
  });

  return {
    task,
    successCount,
    failedCount,
    queueCount: queueItems.length
  };
};

const batchGenerateReminders = async (filters, dunningType, operator) => {
  const stageFilters = [
    { name: '提醒期', minDays: 1, maxDays: 89, level: '一级' },
    { name: '催告期', minDays: 90, maxDays: 179, level: '二级' },
    { name: '严厉期', minDays: 180, maxDays: 364, level: '三级' },
    { name: '法律期', minDays: 365, maxDays: 99999, level: '三级' }
  ];

  const results = [];
  let totalQueued = 0;

  for (const stage of stageFilters) {
    try {
      let template;
      try {
        template = await selectTemplate(dunningType, stage.name, stage.level);
      } catch (e) {
        try {
          template = await selectTemplate(dunningType, stage.name, null);
        } catch (e2) {
          results.push({
            stage: stage.name,
            success: false,
            error: `未找到${stage.name}模板`
          });
          continue;
        }
      }

      const createResult = await createDunningTask({
        taskName: `${stage.name}${dunningType}批量催缴-${moment().format('YYYY-MM-DD HH:mm')}`,
        taskType: '自动',
        dunningType,
        dunningStage: stage.name,
        templateId: template._id,
        filters: {
          ...filters,
          minOverdueDays: stage.minDays,
          maxOverdueDays: stage.maxDays
        }
      }, operator);

      const task = createResult.task;
      let queuedCount = 0;

      try {
        const execResult = await executeDunningTask(task._id, operator);
        queuedCount = execResult.successCount || 0;
        totalQueued += queuedCount;
      } catch (execErr) {
        logger.warn(`批量催缴-${stage.name}任务执行失败: ${execErr.message}`);
      }

      results.push({
        stage: stage.name,
        taskNo: task.taskNo,
        taskId: task._id,
        matchedCount: createResult.matchedCount,
        queuedCount,
        templateName: template.templateName,
        success: true
      });
    } catch (error) {
      if (error.message && error.message.indexOf('没有符合条件') === -1) {
        results.push({
          stage: stage.name,
          success: false,
          error: error.message
        });
      } else {
        results.push({
          stage: stage.name,
          success: true,
          matchedCount: 0,
          queuedCount: 0,
          note: error.message || '无符合条件数据'
        });
      }
    }
  }

  return {
    stages: results,
    totalStages: results.length,
    successStages: results.filter(r => r.success).length,
    totalQueued
  };
};

const getMessageQueue = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.queueNo) query.queueNo = params.queueNo;
  if (params.taskId) query.taskId = params.taskId;
  if (params.taskNo) query.taskNo = params.taskNo;
  if (params.houseNo) query.houseNo = params.houseNo;
  if (params.messageType) query.messageType = params.messageType;
  if (params.status) query.status = params.status;
  if (params.platformMsgId) query.platformMsgId = params.platformMsgId;
  if (params.startDate && params.endDate) {
    query.createdAt = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }

  const [messages, total] = await Promise.all([
    MessageQueue.find(query)
      .populate('taskId', 'taskName taskNo')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    MessageQueue.countDocuments(query)
  ]);

  return buildPaginationResult(messages, total, page, pageSize);
};

const getHouseDunningHistory = async (houseNo, params) => {
  const house = await House.findOne({ houseNo });
  if (!house) {
    throw new NotFoundError('房屋不存在');
  }

  const { page, pageSize, skip } = parsePageParams(params);

  const [messages, total] = await Promise.all([
    MessageQueue.find({ houseId: house._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    MessageQueue.countDocuments({ houseId: house._id })
  ]);

  const callRecords = messages.filter(m => m.messageType === '电话' && m.callRecord);
  const smsRecords = messages.filter(m => m.messageType === '短信');

  const mergedRecords = messages.map(m => ({
    ...m,
    type: m.messageType,
    hasCallRecord: !!(m.messageType === '电话' && m.callRecord),
    hasSmsRecord: m.messageType === '短信'
  }));

  return {
    house: {
      houseNo: house.houseNo,
      building: house.building,
      unit: house.unit,
      roomNo: house.roomNo
    },
    records: buildPaginationResult(mergedRecords, total, page, pageSize),
    summary: {
      totalCount: total,
      smsCount: smsRecords.length,
      callCount: callRecords.length
    }
  };
};

const cancelDunningTask = async (taskId, operator) => {
  const task = await DunningTask.findById(taskId);
  if (!task) {
    throw new NotFoundError('催缴任务不存在');
  }

  if (task.status !== '待执行') {
    throw new BusinessError(`任务状态为${task.status}，不能取消`);
  }

  const oldData = task.toObject();
  task.status = '已取消';
  await task.save();

  await MessageQueue.updateMany(
    { taskId, status: '待发送' },
    { $set: { status: '已取消' } }
  );

  const changes = getObjectDiff(oldData, task.toObject());

  await logOperation({
    operator,
    operationType: '修改',
    operationModule: '催缴任务',
    targetType: 'DunningTask',
    targetId: task._id,
    targetNo: task.taskNo,
    operationContent: `取消催缴任务 ${task.taskName}`,
    beforeData: oldData,
    afterData: task.toObject(),
    changeFields: changes,
    operationResult: '成功'
  });

  return task;
};

module.exports = {
  getTemplates,
  getTemplateById,
  selectTemplate,
  renderTemplate,
  checkDunningEligibility,
  createDunningTask,
  getDunningTasks,
  getDunningTaskDetail,
  executeDunningTask,
  batchGenerateReminders,
  getMessageQueue,
  getHouseDunningHistory,
  cancelDunningTask
};
