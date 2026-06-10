const residentService = require('../services/residentService');
const { BusinessError } = require('../utils/errors');

const searchByHouseNo = async (req, res, next) => {
  try {
    const { houseNo } = req.params;
    const result = await residentService.searchByHouseNo(houseNo, req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const createComplaint = async (req, res, next) => {
  try {
    const operator = req.get('X-Operator') || 'system';
    const result = await residentService.createComplaint(req.body, operator);
    res.success(result, '投诉登记成功');
  } catch (error) {
    next(error);
  }
};

const getComplaints = async (req, res, next) => {
  try {
    const result = await residentService.getComplaints(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const updateComplaintStatus = async (req, res, next) => {
  try {
    const { complaintId } = req.params;
    const operator = req.get('X-Operator') || 'system';
    const result = await residentService.updateComplaintStatus(complaintId, req.body, operator);
    res.success(result, '投诉状态更新成功');
  } catch (error) {
    next(error);
  }
};

const addToBlacklist = async (req, res, next) => {
  try {
    const { residentId } = req.params;
    const { reason } = req.body;
    const operator = req.get('X-Operator') || 'system';
    
    if (!residentId) {
      throw new BusinessError('住户ID不能为空');
    }
    if (!reason) {
      throw new BusinessError('加入黑名单原因不能为空');
    }
    
    const result = await residentService.addToBlacklist(residentId, reason, operator);
    res.success(result, '已加入黑名单');
  } catch (error) {
    next(error);
  }
};

const removeFromBlacklist = async (req, res, next) => {
  try {
    const { residentId } = req.params;
    const operator = req.get('X-Operator') || 'system';
    
    if (!residentId) {
      throw new BusinessError('住户ID不能为空');
    }
    
    const result = await residentService.removeFromBlacklist(residentId, operator);
    res.success(result, '已移出黑名单');
  } catch (error) {
    next(error);
  }
};

const getBlacklist = async (req, res, next) => {
  try {
    const result = await residentService.getBlacklist(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getResidents = async (req, res, next) => {
  try {
    const result = await residentService.getResidents(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getResidentDetail = async (req, res, next) => {
  try {
    const { residentId } = req.params;
    const result = await residentService.getResidentDetail(residentId);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  searchByHouseNo,
  createComplaint,
  getComplaints,
  updateComplaintStatus,
  addToBlacklist,
  removeFromBlacklist,
  getBlacklist,
  getResidents,
  getResidentDetail
};
