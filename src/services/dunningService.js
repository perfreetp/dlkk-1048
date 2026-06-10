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
  const query = {};

  if (params.templateType) {
    query.templateType = params.templateType;
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
    templateType: dunningType,
    dunningStage,
    isEnabled: true
  };

  if (overdueLevel) {
    query.$or = [
      { overdueLevel },
      { overdueLevel: { $exists: false } }
    ];
  }

  const templates = await DunningTemplate.find(query).sort({ priority: -1, isDefault: -1 });

  if (templates.length === 0) {
    throw new NotFoundError('未找到匹配的催缴模板');
  }

  return templates[0];
};

const renderTemplate = (template, data) => {
  let content = template.content;
  const variables = template.variables || [];

  for (const variable of variables) {
    const value = data[variable.name] || '';
    const regex = new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`, 'g');
    content = content.replace(regex, value);
  }

  let title = template.title;
  for (const variable of variables) {
    const value = data[variable.name] || '';
    const regex = new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`, 'g');
    title = title.replace(regex, value);
  }

  return { title, content };
};

const checkDunningEligibility = async (houseId, filters = {}) => {
  const house = await House.findById(houseId).populate('residentId');
  if (!house) {
    return { eligible: false, reason: '房屋不存在' };
  }

  const resident = house.residentId;

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

  if (filters.excludePromised && resident && resident.promisedPaymentDate) {
    if (moment(resident.promisedPaymentDate).isAfter(moment())) {
      return { eligible: false, reason: '已承诺付款' };
    }
  }

  if (filters.excludeRecentDunning !== false) {
    const cooldownHours = config.dunning.cooldownHours;
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
    paymentStatus: { $in: ['未缴', '部分缴'] }
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
    feeQuery.overdueDays = { ...feeQuery.overdueDays, $lte: filters.maxOverdueDays };
  }

  if (filters.minArrearsAmount !== undefined) {
    feeQuery.unpaidAmount = { $gte: filters.minArrearsAmount };
  }
  if (filters.maxArrearsAmount !== undefined) {
    feeQuery.unpaidAmount = { ...feeQuery.unpaidAmount, $lte: filters.maxArrearsAmount };
  }

  const fees = await PropertyFee.find(feeQuery).populate('houseId').populate('residentId');

  const houseFeeMap = new Map();
  for (const fee of fees) {
    const houseId = fee.houseId ? fee.houseId._id.toString() : fee.houseId;
    if (!houseFeeMap.has(houseId)) {
      houseFeeMap.set(houseId, {
        house: fee.houseId,
        resident: fee.residentId,
        fees: [],
        totalArrears: 0,
        maxOverdueDays: 0
      });
    }
    const entry = houseFeeMap.get(houseId);
    entry.fees.push(fee);
    entry.totalArrears += fee.unpaidAmount;
    entry.maxOverdueDays = Math.max(entry.maxOverdueDays, fee.overdueDays || 0);
  }

  const eligibleItems = [];
  for (const [houseId, entry] of houseFeeMap) {
    if (!entry.house) continue;

    const eligibility = await checkDunningEligibility(houseId, filters);
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
    dunningType,
    dunningStage,
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
    template = await selectTemplate(dunningType, dunningStage, filters.overdueLevels ? filters.overdueLevels[0] : null);
  }

  if (!template.isEnabled) {
    throw new BusinessError('所选模板已禁用');
  }

  const items = await buildTaskFilters(filters);

  if (items.length === 0) {
    throw new BusinessError('没有符合条件的催缴对象');
  }

  const taskNo = generateNo('TASK');

  const task = new DunningTask({
    taskNo,
    taskName,
    taskType,
    dunningType,
    dunningStage,
    templateId: template._id,
    templateNo: template.templateNo,
    filters,
    items,
    totalCount: items.length,
    status: scheduledAt ? '待执行' : (requiresApproval ? '待执行' : '待执行'),
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
    operationContent: `创建催缴任务 ${taskName}`,
    afterData: task.toObject(),
    operationResult: '成功'
  });

  return {
    task,
    matchedCount: items.length
  };
};

const getDunningTasks = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.taskNo) {
    query.taskNo = params.taskNo;
  }
  if (params.taskType) {
    query.taskType = params.taskType;
  }
  if (params.dunningType) {
    query.dunningType = params.dunningType;
  }
  if (params.dunningStage) {
    query.dunningStage = params.dunningStage;
  }
  if (params.status) {
    query.status = params.status;
  }
  if (params.approvalStatus) {
    query.approvalStatus = params.approvalStatus;
  }
  if (params.createdBy) {
    query.createdBy = params.createdBy;
  }
  if (params.startDate && params.endDate) {
    query.createdAt = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }

  const [tasks, total] = await Promise.all([
    DunningTask.find(query)
      .populate('templateId', 'templateName templateType')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    DunningTask.countDocuments(query)
  ]);

  return buildPaginationResult(tasks, total, page, pageSize);
};

const getDunningTaskDetail = async (taskId) => {
  const task = await DunningTask.findById(taskId)
    .populate('templateId');

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
        residentName: item.residentName,
        houseNo: item.houseNo,
        building: house ? house.building : '',
        unit: house ? house.unit : '',
        roomNo: house ? house.roomNo : '',
        totalArrears: item.totalArrears.toFixed(2),
        overdueDays: item.overdueDays,
        overdueLevel: item.overdueLevel,
        currentDate: moment().format('YYYY年MM月DD日')
      };

      const { title, content } = renderTemplate(template, renderData);

      const queueNo = generateNo('MSG');
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
        phone: item.residentPhone,
        title,
        content,
        feeIds: item.feeIds,
        totalArrears: item.totalArrears,
        priority: task.dunningStage === '法律期' ? 3 : task.dunningStage === '严厉期' ? 2 : task.dunningStage === '催告期' ? 1 : 0,
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
      logger.error(`创建催缴消息失败: ${error.message}`, error);
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
    operationContent: `执行催缴任务 ${task.taskName}`,
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
    { name: '提醒期', minDays: 1, maxDays: 89 },
    { name: '催告期', minDays: 90, maxDays: 179 },
    { name: '严厉期', minDays: 180, maxDays: 364 },
    { name: '法律期', minDays: 365, maxDays: 9999 }
  ];

  const results = [];

  for (const stage of stageFilters) {
    try {
      const template = await selectTemplate(dunningType, stage.name, null);
      if (!template) continue;

      const result = await createDunningTask({
        taskName: `${stage.name}批量催缴-${moment().format('YYYY-MM-DD')}`,
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

      results.push({
        stage: stage.name,
        taskNo: result.task.taskNo,
        matchedCount: result.matchedCount,
        success: true
      });
    } catch (error) {
      if (error.code !== 'NOT_FOUND') {
        results.push({
          stage: stage.name,
          success: false,
          error: error.message
        });
      }
    }
  }

  return results;
};

const getMessageQueue = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.queueNo) {
    query.queueNo = params.queueNo;
  }
  if (params.taskId) {
    query.taskId = params.taskId;
  }
  if (params.taskNo) {
    query.taskNo = params.taskNo;
  }
  if (params.houseNo) {
    query.houseNo = params.houseNo;
  }
  if (params.messageType) {
    query.messageType = params.messageType;
  }
  if (params.status) {
    query.status = params.status;
  }
  if (params.platformMsgId) {
    query.platformMsgId = params.platformMsgId;
  }
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
