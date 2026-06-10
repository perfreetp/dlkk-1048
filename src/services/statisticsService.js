const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv');
const PropertyFee = require('../models/PropertyFee');
const House = require('../models/House');
const Resident = require('../models/Resident');
const DunningTask = require('../models/DunningTask');
const MessageQueue = require('../models/MessageQueue');
const PaymentRecord = require('../models/PaymentRecord');
const ReductionApplication = require('../models/ReductionApplication');
const Complaint = require('../models/Complaint');
const config = require('../config');
const logger = require('../utils/logger');
const { generateNo } = require('../utils/common');
const { logOperation } = require('../middleware');

const getDunningEffectStatistics = async (params) => {
  const { startDate, endDate } = params;
  
  const startTime = startDate ? new Date(startDate) : moment().subtract(30, 'days').toDate();
  const endTime = endDate ? new Date(endDate + ' 23:59:59') : new Date();

  const [
    totalTasks,
    totalMessagesSent,
    totalMessagesDelivered,
    totalMessagesRead,
    totalMessagesReplied,
    totalPayments,
    totalPaymentAmount,
    totalReductions,
    totalReductionAmount,
    tasksByStatus,
    messagesByType,
    paymentsByMethod
  ] = await Promise.all([
    DunningTask.countDocuments({ createdAt: { $gte: startTime, $lte: endTime } }),
    MessageQueue.countDocuments({ createdAt: { $gte: startTime, $lte: endTime }, status: { $in: ['已发送', '已送达', '已读', '已回复'] } }),
    MessageQueue.countDocuments({ createdAt: { $gte: startTime, $lte: endTime }, status: { $in: ['已送达', '已读', '已回复'] } }),
    MessageQueue.countDocuments({ createdAt: { $gte: startTime, $lte: endTime }, status: { $in: ['已读', '已回复'] } }),
    MessageQueue.countDocuments({ createdAt: { $gte: startTime, $lte: endTime }, status: '已回复' }),
    PaymentRecord.countDocuments({ paymentDate: { $gte: startTime, $lte: endTime } }),
    PaymentRecord.aggregate([
      { $match: { paymentDate: { $gte: startTime, $lte: endTime } } },
      { $group: { _id: null, total: { $sum: '$paidAmount' } } }
    ]),
    ReductionApplication.countDocuments({ applicationTime: { $gte: startTime, $lte: endTime }, status: '已完成' }),
    ReductionApplication.aggregate([
      { $match: { applicationTime: { $gte: startTime, $lte: endTime }, status: '已完成' } },
      { $group: { _id: null, total: { $sum: '$reductionAmount' } } }
    ]),
    DunningTask.aggregate([
      { $match: { createdAt: { $gte: startTime, $lte: endTime } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    MessageQueue.aggregate([
      { $match: { createdAt: { $gte: startTime, $lte: endTime } } },
      { $group: { _id: '$messageType', count: { $sum: 1 } } }
    ]),
    PaymentRecord.aggregate([
      { $match: { paymentDate: { $gte: startTime, $lte: endTime } } },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, amount: { $sum: '$paidAmount' } } }
    ])
  ]);

  const statusMap = {};
  tasksByStatus.forEach(item => { statusMap[item._id] = item.count; });

  const typeMap = {};
  messagesByType.forEach(item => { typeMap[item._id] = item.count; });

  const paymentMethodMap = {};
  paymentsByMethod.forEach(item => {
    paymentMethodMap[item._id] = { count: item.count, amount: item.amount };
  });

  const deliveryRate = totalMessagesSent > 0 ? (totalMessagesDelivered / totalMessagesSent * 100).toFixed(2) : 0;
  const readRate = totalMessagesDelivered > 0 ? (totalMessagesRead / totalMessagesDelivered * 100).toFixed(2) : 0;
  const replyRate = totalMessagesSent > 0 ? (totalMessagesReplied / totalMessagesSent * 100).toFixed(2) : 0;
  const conversionRate = totalMessagesSent > 0 ? (totalPayments / totalMessagesSent * 100).toFixed(2) : 0;

  return {
    period: { startDate: startTime, endDate: endTime },
    overview: {
      totalTasks,
      totalMessagesSent,
      totalMessagesDelivered,
      totalMessagesRead,
      totalMessagesReplied,
      totalPayments,
      totalPaymentAmount: totalPaymentAmount.length > 0 ? totalPaymentAmount[0].total : 0,
      totalReductions,
      totalReductionAmount: totalReductionAmount[0]?.total || 0
    },
    rates: {
      deliveryRate: `${deliveryRate}%`,
      readRate: `${readRate}%`,
      replyRate: `${replyRate}%`,
      conversionRate: `${conversionRate}%`
    },
    tasksByStatus: statusMap,
    messagesByType: typeMap,
    paymentsByMethod: paymentMethodMap
  };
};

const getBuildingRanking = async (params) => {
  const { startDate, endDate, limit = 10 } = params;
  
  const startTime = startDate ? new Date(startDate) : moment().subtract(30, 'days').toDate();
  const endTime = endDate ? new Date(endDate + ' 23:59:59') : new Date();

  const houses = await House.find({});
  const buildingMap = {};

  for (const house of houses) {
    if (!buildingMap[house.building]) {
      buildingMap[house.building] = {
        building: house.building,
        totalHouses: 0,
        totalArrears: 0,
        arrearsCount: 0,
        paidAmount: 0,
        paymentCount: 0,
        dunningCount: 0
      };
    }
    buildingMap[house.building].totalHouses++;
  }

  const [arrearsData, paymentData, dunningData] = await Promise.all([
    PropertyFee.aggregate([
      {
        $lookup: {
          from: 'houses',
          localField: 'houseId',
          foreignField: '_id',
          as: 'house'
        }
      },
      { $unwind: '$house' },
      {
        $match: {
          unpaidAmount: { $gt: 0 },
          createdAt: { $gte: startTime, $lte: endTime }
        }
      },
      {
        $group: {
          _id: '$house.building',
          totalArrears: { $sum: '$unpaidAmount' },
          arrearsCount: { $sum: 1 }
        }
      }
    ]),
    PaymentRecord.aggregate([
      {
        $lookup: {
          from: 'houses',
          localField: 'houseId',
          foreignField: '_id',
          as: 'house'
        }
      },
      { $unwind: '$house' },
      {
        $match: {
          paymentDate: { $gte: startTime, $lte: endTime }
        }
      },
      {
        $group: {
          _id: '$house.building',
          paidAmount: { $sum: '$paidAmount' },
          paymentCount: { $sum: 1 }
        }
      }
    ]),
    MessageQueue.aggregate([
      {
        $lookup: {
          from: 'houses',
          localField: 'houseId',
          foreignField: '_id',
          as: 'house'
        }
      },
      { $unwind: '$house' },
      {
        $match: {
          createdAt: { $gte: startTime, $lte: endTime },
          status: { $in: ['已发送', '已送达', '已读', '已回复'] }
        }
      },
      {
        $group: {
          _id: '$house.building',
          dunningCount: { $sum: 1 }
        }
      }
    ])
  ]);

  arrearsData.forEach(item => {
    if (buildingMap[item._id]) {
      buildingMap[item._id].totalArrears = item.totalArrears;
      buildingMap[item._id].arrearsCount = item.arrearsCount;
    }
  });

  paymentData.forEach(item => {
    if (buildingMap[item._id]) {
      buildingMap[item._id].paidAmount = item.paidAmount;
      buildingMap[item._id].paymentCount = item.paymentCount;
    }
  });

  dunningData.forEach(item => {
    if (buildingMap[item._id]) {
      buildingMap[item._id].dunningCount = item.dunningCount;
    }
  });

  const rankings = Object.values(buildingMap)
    .map(item => ({
      ...item,
      arrearsRate: item.totalHouses > 0 ? (item.arrearsCount / item.totalHouses * 100).toFixed(2) : 0,
      paymentEfficiency: item.dunningCount > 0 ? (item.paymentCount / item.dunningCount * 100).toFixed(2) : 0
    }))
    .sort((a, b) => b.totalArrears - a.totalArrears)
    .slice(0, limit);

  return {
    period: { startDate: startTime, endDate: endTime },
    totalBuildings: Object.keys(buildingMap).length,
    rankings
  };
};

const getOverdueDistribution = async () => {
  const levels = ['正常', '一级', '二级', '三级'];
  const result = {};

  for (const level of levels) {
    const [count, totalAmount] = await Promise.all([
      PropertyFee.countDocuments({ overdueLevel: level, unpaidAmount: { $gt: 0 } }),
      PropertyFee.aggregate([
        { $match: { overdueLevel: level, unpaidAmount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$unpaidAmount' } } }
      ])
    ]);
    result[level] = {
      count,
      amount: totalAmount[0]?.total || 0
    };
  }

  const totalCount = Object.values(result).reduce((sum, item) => sum + item.count, 0);
  const totalAmount = Object.values(result).reduce((sum, item) => sum + item.amount, 0);

  return {
    distribution: result,
    total: {
      count: totalCount,
      amount: totalAmount
    }
  };
};

const exportData = async (exportType, params, operator) => {
  const exportPath = config.export.path;
  if (!fs.existsSync(exportPath)) {
    fs.mkdirSync(exportPath, { recursive: true });
  }

  let data = [];
  let fields = [];
  let fileName = '';

  switch (exportType) {
    case 'arrears':
      data = await exportArrears(params);
      fields = ['houseNo', 'building', 'unit', 'roomNo', 'ownerName', 'ownerPhone', 'feeType', 'feePeriod', 'totalAmount', 'paidAmount', 'unpaidAmount', 'overdueDays', 'overdueLevel', 'dueDate'];
      fileName = `欠费明细_${moment().format('YYYYMMDDHHmmss')}.csv`;
      break;
    case 'dunning':
      data = await exportDunning(params);
      fields = ['taskNo', 'taskName', 'dunningType', 'dunningStage', 'houseNo', 'residentName', 'residentPhone', 'status', 'sentAt', 'totalArrears'];
      fileName = `催缴记录_${moment().format('YYYYMMDDHHmmss')}.csv`;
      break;
    case 'payment':
      data = await exportPayments(params);
      fields = ['paymentNo', 'houseNo', 'payerName', 'paymentMethod', 'totalAmount', 'paidAmount', 'paymentDate', 'syncSource', 'remark'];
      fileName = `付款记录_${moment().format('YYYYMMDDHHmmss')}.csv`;
      break;
    case 'reduction':
      data = await exportReductions(params);
      fields = ['applicationNo', 'houseNo', 'applicantName', 'reductionType', 'totalAmount', 'reductionAmount', 'actualPayAmount', 'status', 'applicationTime'];
      fileName = `减免申请_${moment().format('YYYYMMDDHHmmss')}.csv`;
      break;
    default:
      throw new Error('不支持的导出类型');
  }

  const json2csvParser = new Parser({ fields });
  const csv = json2csvParser.parse(data);

  const filePath = path.join(exportPath, fileName);
  fs.writeFileSync(filePath, '\ufeff' + csv, 'utf8');

  await logOperation({
    operator,
    operationType: '导出',
    operationModule: '统计分析',
    operationContent: `导出${exportType}数据，共${data.length}条`,
    operationResult: '成功'
  });

  return {
    fileName,
    filePath,
    recordCount: data.length
  };
};

const exportArrears = async (params) => {
  const query = { unpaidAmount: { $gt: 0 } };
  
  if (params.startDate && params.endDate) {
    query.createdAt = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }
  if (params.building) {
    const houses = await House.find({ building: params.building }).select('_id');
    query.houseId = { $in: houses.map(h => h._id) };
  }
  if (params.overdueLevel) {
    query.overdueLevel = params.overdueLevel;
  }

  const fees = await PropertyFee.find(query)
    .populate('houseId', 'houseNo building unit roomNo ownerName ownerPhone')
    .lean();

  return fees.map(fee => ({
    houseNo: fee.houseId?.houseNo || '',
    building: fee.houseId?.building || '',
    unit: fee.houseId?.unit || '',
    roomNo: fee.houseId?.roomNo || '',
    ownerName: fee.houseId?.ownerName || '',
    ownerPhone: fee.houseId?.ownerPhone || '',
    feeType: fee.feeType,
    feePeriod: `${fee.feePeriod.year}-${fee.feePeriod.month}`,
    totalAmount: fee.totalAmount,
    paidAmount: fee.paidAmount,
    unpaidAmount: fee.unpaidAmount,
    overdueDays: fee.overdueDays,
    overdueLevel: fee.overdueLevel,
    dueDate: moment(fee.dueDate).format('YYYY-MM-DD')
  }));
};

const exportDunning = async (params) => {
  const query = {};
  
  if (params.startDate && params.endDate) {
    query.createdAt = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }
  if (params.status) {
    query.status = params.status;
  }

  const tasks = await DunningTask.find(query).populate('templateId').lean();
  const result = [];

  for (const task of tasks) {
    for (const item of task.items) {
      result.push({
        taskNo: task.taskNo,
        taskName: task.taskName,
        dunningType: task.dunningType,
        dunningStage: task.dunningStage,
        houseNo: item.houseNo,
        residentName: item.residentName,
        residentPhone: item.residentPhone,
        status: item.status,
        sentAt: item.sentAt ? moment(item.sentAt).format('YYYY-MM-DD HH:mm:ss') : '',
        totalArrears: item.totalArrears
      });
    }
  }

  return result;
};

const exportPayments = async (params) => {
  const query = {};
  
  if (params.startDate && params.endDate) {
    query.paymentDate = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }
  if (params.syncSource) {
    query.syncSource = params.syncSource;
  }

  const payments = await PaymentRecord.find(query).lean();

  return payments.map(payment => ({
    paymentNo: payment.paymentNo,
    houseNo: payment.houseNo,
    payerName: payment.payerName || '',
    paymentMethod: payment.paymentMethod,
    totalAmount: payment.totalAmount,
    paidAmount: payment.paidAmount,
    paymentDate: moment(payment.paymentDate).format('YYYY-MM-DD'),
    syncSource: payment.syncSource,
    remark: payment.remark || ''
  }));
};

const exportReductions = async (params) => {
  const query = {};
  
  if (params.startDate && params.endDate) {
    query.applicationTime = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }
  if (params.status) {
    query.status = params.status;
  }

  const reductions = await ReductionApplication.find(query).lean();

  return reductions.map(red => ({
    applicationNo: red.applicationNo,
    houseNo: red.houseNo,
    applicantName: red.applicantName,
    reductionType: red.reductionType,
    totalAmount: red.totalAmount,
    reductionAmount: red.reductionAmount,
    actualPayAmount: red.actualPayAmount,
    status: red.status,
    applicationTime: moment(red.applicationTime).format('YYYY-MM-DD HH:mm:ss')
  }));
};

const getOperationLogs = async (params) => {
  const OperationLog = require('../models/OperationLog');
  
  const { page, pageSize, skip } = require('../utils/common').parsePageParams(params);
  const sort = require('../utils/common').buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.operator) {
    query.operator = params.operator;
  }
  if (params.operationType) {
    query.operationType = params.operationType;
  }
  if (params.operationModule) {
    query.operationModule = params.operationModule;
  }
  if (params.targetNo) {
    query.targetNo = params.targetNo;
  }
  if (params.operationResult) {
    query.operationResult = params.operationResult;
  }
  if (params.startDate && params.endDate) {
    query.operationTime = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }

  const [logs, total] = await Promise.all([
    OperationLog.find(query).sort(sort).skip(skip).limit(pageSize),
    OperationLog.countDocuments(query)
  ]);

  return require('../utils/common').buildPaginationResult(logs, total, page, pageSize);
};

const getApiCallLogs = async (params) => {
  const ApiCallLog = require('../models/ApiCallLog');
  
  const { page, pageSize, skip } = require('../utils/common').parsePageParams(params);
  const sort = require('../utils/common').buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.requestId) {
    query.requestId = params.requestId;
  }
  if (params.caller) {
    query.caller = params.caller;
  }
  if (params.apiName) {
    query.apiName = params.apiName;
  }
  if (params.success !== undefined) {
    query.success = params.success;
  }
  if (params.responseCode) {
    query.responseCode = params.responseCode;
  }
  if (params.relatedHouseNo) {
    query.relatedHouseNo = params.relatedHouseNo;
  }
  if (params.relatedTaskNo) {
    query.relatedTaskNo = params.relatedTaskNo;
  }
  if (params.startDate && params.endDate) {
    query.callStartTime = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }

  const [logs, total] = await Promise.all([
    ApiCallLog.find(query).sort(sort).skip(skip).limit(pageSize),
    ApiCallLog.countDocuments(query)
  ]);

  return require('../utils/common').buildPaginationResult(logs, total, page, pageSize);
};

const getApiCallResult = async (requestId) => {
  const ApiCallLog = require('../models/ApiCallLog');
  
  const log = await ApiCallLog.findOne({ requestId });
  if (!log) {
    throw new Error('调用记录不存在');
  }

  return {
    requestId: log.requestId,
    caller: log.caller,
    apiName: log.apiName,
    httpMethod: log.httpMethod,
    httpPath: log.httpPath,
    success: log.success,
    responseStatus: log.responseStatus,
    responseCode: log.responseCode,
    responseMessage: log.responseMessage,
    responseData: log.responseData,
    callStartTime: log.callStartTime,
    callEndTime: log.callEndTime,
    duration: log.duration,
    errorMessage: log.errorMessage,
    relatedHouseNo: log.relatedHouseNo,
    relatedTaskNo: log.relatedTaskNo
  };
};

const approveTask = async (taskId, params, operator) => {
  const { action, approvalRemark } = params;

  const task = await DunningTask.findById(taskId);
  if (!task) {
    throw new Error('催缴任务不存在');
  }

  if (!task.requiresApproval) {
    throw new Error('该任务不需要审批');
  }

  if (task.approvalStatus !== '待审批') {
    throw new Error(`任务审批状态为${task.approvalStatus}，不能重复审批`);
  }

  const oldData = task.toObject();

  task.approvalStatus = action === '批准' ? '已批准' : '已拒绝';
  task.approver = operator;
  task.approvalRemark = approvalRemark;
  task.approvedAt = new Date();

  await task.save();

  const changes = require('../utils/common').getObjectDiff(oldData, task.toObject());

  await logOperation({
    operator,
    operationType: '审批',
    operationModule: '催缴任务',
    targetType: 'DunningTask',
    targetId: task._id,
    targetNo: task.taskNo,
    operationContent: `${action}催缴任务 ${task.taskName}`,
    beforeData: oldData,
    afterData: task.toObject(),
    changeFields: changes,
    operationResult: '成功'
  });

  return task;
};

const getPendingTasksForApproval = async (params) => {
  const query = {
    requiresApproval: true,
    approvalStatus: '待审批'
  };

  return DunningTask.find(query)
    .populate('templateId', 'templateName')
    .sort({ createdAt: -1 });
};

module.exports = {
  getDunningEffectStatistics,
  getBuildingRanking,
  getOverdueDistribution,
  exportData,
  getOperationLogs,
  getApiCallLogs,
  getApiCallResult,
  approveTask,
  getPendingTasksForApproval
};
