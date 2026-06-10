const reductionService = require('../services/reductionService');
const { BusinessError } = require('../utils/errors');

const createReductionApplication = async (req, res, next) => {
  try {
    const operator = req.get('X-Operator') || 'system';
    const result = await reductionService.createReductionApplication(req.body, operator);
    res.success(result, '减免申请提交成功');
  } catch (error) {
    next(error);
  }
};

const getReductionApplications = async (req, res, next) => {
  try {
    const result = await reductionService.getReductionApplications(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getReductionApplicationDetail = async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    const result = await reductionService.getReductionApplicationDetail(applicationId);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const approveReductionApplication = async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    const operator = req.get('X-Operator') || 'system';
    const result = await reductionService.approveReductionApplication(applicationId, req.body, operator);
    res.success(result, '审批完成');
  } catch (error) {
    next(error);
  }
};

const getPendingApprovals = async (req, res, next) => {
  try {
    const operator = req.get('X-Operator') || 'system';
    const result = await reductionService.getPendingApprovals(req.query, operator);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getPromisedPaymentReminders = async (req, res, next) => {
  try {
    const result = await reductionService.getPromisedPaymentReminders();
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const updateCustomerRemark = async (req, res, next) => {
  try {
    const { residentId } = req.params;
    const { remark } = req.body;
    const operator = req.get('X-Operator') || 'system';
    
    if (!residentId) {
      throw new BusinessError('住户ID不能为空');
    }
    
    const result = await reductionService.updateCustomerRemark(residentId, remark, operator);
    res.success(result, '客服备注更新成功');
  } catch (error) {
    next(error);
  }
};

const setPromisedPaymentDate = async (req, res, next) => {
  try {
    const { residentId } = req.params;
    const { promisedDate } = req.body;
    const operator = req.get('X-Operator') || 'system';
    
    if (!residentId) {
      throw new BusinessError('住户ID不能为空');
    }
    
    const result = await reductionService.setPromisedPaymentDate(residentId, promisedDate, operator);
    res.success(result, '承诺付款日期设置成功');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createReductionApplication,
  getReductionApplications,
  getReductionApplicationDetail,
  approveReductionApplication,
  getPendingApprovals,
  getPromisedPaymentReminders,
  updateCustomerRemark,
  setPromisedPaymentDate
};
