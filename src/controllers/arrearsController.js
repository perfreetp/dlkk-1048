const arrearsService = require('../services/arrearsService');
const { BusinessError } = require('../utils/errors');

const queryArrears = async (req, res, next) => {
  try {
    const operator = req.get('X-Operator') || 'system';
    const result = await arrearsService.queryArrears(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getHouseArrearsDetail = async (req, res, next) => {
  try {
    const { houseNo } = req.params;
    if (!houseNo) {
      throw new BusinessError('房号不能为空');
    }
    const result = await arrearsService.getHouseArrearsDetail(houseNo);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getResidentArrearsDetail = async (req, res, next) => {
  try {
    const { residentId } = req.params;
    if (!residentId) {
      throw new BusinessError('住户ID不能为空');
    }
    const result = await arrearsService.getResidentArrearsDetail(residentId);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const recalculateFee = async (req, res, next) => {
  try {
    const { feeId } = req.params;
    const operator = req.get('X-Operator') || 'system';
    
    if (!feeId) {
      throw new BusinessError('费用ID不能为空');
    }
    
    const result = await arrearsService.recalculateFee(feeId, req.body, operator);
    res.success(result, '费用重算成功');
  } catch (error) {
    next(error);
  }
};

const batchRecalculateFees = async (req, res, next) => {
  try {
    const { filters, params } = req.body;
    const operator = req.get('X-Operator') || 'system';
    
    const result = await arrearsService.batchRecalculateFees(filters, params, operator);
    res.success(result, '批量重算完成');
  } catch (error) {
    next(error);
  }
};

const batchRefreshOverdueStatus = async (req, res, next) => {
  try {
    const result = await arrearsService.batchRefreshOverdueStatus();
    res.success(result, '批量更新逾期状态完成');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  queryArrears,
  getHouseArrearsDetail,
  getResidentArrearsDetail,
  recalculateFee,
  batchRecalculateFees,
  batchRefreshOverdueStatus
};
