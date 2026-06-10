const statisticsService = require('../services/statisticsService');
const { BusinessError } = require('../utils/errors');
const fs = require('fs');
const path = require('path');

const getDunningEffectStatistics = async (req, res, next) => {
  try {
    const result = await statisticsService.getDunningEffectStatistics(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getBuildingRanking = async (req, res, next) => {
  try {
    const result = await statisticsService.getBuildingRanking(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getOverdueDistribution = async (req, res, next) => {
  try {
    const result = await statisticsService.getOverdueDistribution();
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const exportData = async (req, res, next) => {
  try {
    const { type } = req.params;
    const operator = req.get('X-Operator') || 'system';
    
    if (!type) {
      throw new BusinessError('导出类型不能为空');
    }
    
    const result = await statisticsService.exportData(type, req.body, operator);
    res.success(result, '导出成功');
  } catch (error) {
    next(error);
  }
};

const downloadExport = async (req, res, next) => {
  try {
    const { fileName } = req.params;
    const config = require('../config');
    const filePath = path.join(config.export.path, fileName);
    
    if (!fs.existsSync(filePath)) {
      throw new BusinessError('文件不存在');
    }
    
    res.download(filePath, fileName, (err) => {
      if (err) {
        next(err);
      }
    });
  } catch (error) {
    next(error);
  }
};

const getOperationLogs = async (req, res, next) => {
  try {
    const result = await statisticsService.getOperationLogs(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getApiCallLogs = async (req, res, next) => {
  try {
    const result = await statisticsService.getApiCallLogs(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getApiCallResult = async (req, res, next) => {
  try {
    const { requestId } = req.params;
    if (!requestId) {
      throw new BusinessError('请求ID不能为空');
    }
    const result = await statisticsService.getApiCallResult(requestId);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const approveTask = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const operator = req.get('X-Operator') || 'system';
    const result = await statisticsService.approveTask(taskId, req.body, operator);
    res.success(result, '审批完成');
  } catch (error) {
    next(error);
  }
};

const getPendingTasksForApproval = async (req, res, next) => {
  try {
    const result = await statisticsService.getPendingTasksForApproval(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getDashboardSummary = async (req, res, next) => {
  try {
    const PropertyFee = require('../models/PropertyFee');
    const House = require('../models/House');
    const DunningTask = require('../models/DunningTask');
    const MessageQueue = require('../models/MessageQueue');
    const PaymentRecord = require('../models/PaymentRecord');
    const moment = require('moment');

    const today = moment().startOf('day');
    const thirtyDaysAgo = moment().subtract(30, 'days').toDate();

    const [
      totalHouses,
      totalArrearsCount,
      totalArrearsAmount,
      totalArrearsHouses,
      tasksToday,
      tasksThirtyDays,
      messagesSentToday,
      paymentsToday,
      paymentsAmountToday,
      overdueDistribution
    ] = await Promise.all([
      House.countDocuments({ status: '已收房' }),
      PropertyFee.countDocuments({ unpaidAmount: { $gt: 0 } }),
      PropertyFee.aggregate([
        { $match: { unpaidAmount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$unpaidAmount' } } }
      ]),
      PropertyFee.aggregate([
        { $match: { unpaidAmount: { $gt: 0 } } },
        { $group: { _id: '$houseId' } },
        { $count: 'count' }
      ]),
      DunningTask.countDocuments({ createdAt: { $gte: today.toDate() } }),
      DunningTask.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      MessageQueue.countDocuments({
        createdAt: { $gte: today.toDate() },
        status: { $in: ['已发送', '已送达', '已读', '已回复'] }
      }),
      PaymentRecord.countDocuments({ paymentDate: { $gte: today.toDate() } }),
      PaymentRecord.aggregate([
        { $match: { paymentDate: { $gte: today.toDate() } } },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } }
      ]),
      statisticsService.getOverdueDistribution()
    ]);

    const dunningEffect = await statisticsService.getDunningEffectStatistics({
      startDate: moment().subtract(30, 'days').format('YYYY-MM-DD'),
      endDate: moment().format('YYYY-MM-DD')
    });

    const buildingRanking = await statisticsService.getBuildingRanking({
      startDate: moment().subtract(30, 'days').format('YYYY-MM-DD'),
      endDate: moment().format('YYYY-MM-DD'),
      limit: 5
    });

    res.success({
      overview: {
        totalHouses,
        totalArrearsCount,
        totalArrearsAmount: totalArrearsAmount[0]?.total || 0,
        totalArrearsHouses: totalArrearsHouses[0]?.count || 0,
        arrearsRate: totalHouses > 0 ? ((totalArrearsHouses[0]?.count || 0) / totalHouses * 100).toFixed(2) + '%' : '0%'
      },
      todayStats: {
        tasks: tasksToday,
        messagesSent: messagesSentToday,
        payments: paymentsToday,
        paymentsAmount: paymentsAmountToday[0]?.total || 0
      },
      thirtyDaysStats: {
        tasks: tasksThirtyDays,
        ...dunningEffect
      },
      overdueDistribution,
      buildingRanking: buildingRanking.rankings
    }, '查询成功');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDunningEffectStatistics,
  getBuildingRanking,
  getOverdueDistribution,
  exportData,
  downloadExport,
  getOperationLogs,
  getApiCallLogs,
  getApiCallResult,
  approveTask,
  getPendingTasksForApproval,
  getDashboardSummary
};
