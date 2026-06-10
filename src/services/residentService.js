const moment = require('moment');
const Resident = require('../models/Resident');
const House = require('../models/House');
const Complaint = require('../models/Complaint');
const logger = require('../utils/logger');
const {
  generateNo,
  parsePageParams,
  buildPaginationResult,
  buildSortParams,
  getObjectDiff
} = require('../utils/common');
const { NotFoundError, BusinessError } = require('../utils/errors');
const { logOperation } = require('../middleware');

const searchByHouseNo = async (houseNo, params = {}) => {
  const query = {};
  
  if (houseNo) {
    query.houseNo = { $regex: houseNo, $options: 'i' };
  }

  if (params.building) {
    query.building = params.building;
  }
  if (params.unit) {
    query.unit = params.unit;
  }

  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);

  const [houses, total] = await Promise.all([
    House.find(query)
      .populate('residentId')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    House.countDocuments(query)
  ]);

  const results = houses.map(house => ({
    house: {
      id: house._id,
      houseNo: house.houseNo,
      building: house.building,
      unit: house.unit,
      roomNo: house.roomNo,
      area: house.area,
      houseType: house.houseType,
      status: house.status,
      ownerName: house.ownerName,
      ownerPhone: house.ownerPhone
    },
    resident: house.residentId ? {
      id: house.residentId._id,
      residentNo: house.residentId.residentNo,
      name: house.residentId.name,
      phone: house.residentId.phone,
      isBlacklist: house.residentId.isBlacklist,
      complaintCount: house.residentId.complaintCount,
      customerRemark: house.residentId.customerRemark,
      overdueLevel: house.residentId.overdueLevel,
      totalArrears: house.residentId.totalArrears
    } : null
  }));

  return buildPaginationResult(results, total, page, pageSize);
};

const createComplaint = async (params, operator) => {
  const {
    houseNo,
    complainantName,
    complainantPhone,
    complaintType,
    complaintContent,
    complaintTime,
    complaintChannel,
    isDunningRelated,
    dunningTaskIds,
    excludeFromDunning,
    excludeReason,
    excludeDays
  } = params;

  const house = await House.findOne({ houseNo });
  if (!house) {
    throw new NotFoundError('房屋不存在');
  }

  const complaintNo = generateNo('CMP');

  let excludeEndTime = null;
  if (excludeFromDunning && excludeDays) {
    excludeEndTime = moment().add(excludeDays, 'days').toDate();
  }

  const complaint = new Complaint({
    complaintNo,
    houseId: house._id,
    houseNo,
    residentId: house.residentId,
    complainantName,
    complainantPhone,
    complaintType,
    complaintContent,
    complaintTime: complaintTime || new Date(),
    complaintChannel,
    isDunningRelated: isDunningRelated || false,
    dunningTaskIds: dunningTaskIds || [],
    excludeFromDunning: excludeFromDunning || false,
    excludeReason,
    excludeEndTime,
    createdBy: operator
  });

  await complaint.save();

  if (house.residentId) {
    await Resident.findByIdAndUpdate(house.residentId, {
      $inc: { complaintCount: 1 },
      $set: { lastComplaintTime: new Date() }
    });
  }

  await logOperation({
    operator,
    operationType: '创建',
    operationModule: '住户管理',
    targetType: 'Complaint',
    targetId: complaint._id,
    targetNo: complaintNo,
    operationContent: `登记投诉: ${complaintType}`,
    afterData: complaint.toObject(),
    operationResult: '成功'
  });

  return complaint;
};

const getComplaints = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.complaintNo) {
    query.complaintNo = params.complaintNo;
  }
  if (params.houseNo) {
    query.houseNo = params.houseNo;
  }
  if (params.complaintType) {
    query.complaintType = params.complaintType;
  }
  if (params.status) {
    query.status = params.status;
  }
  if (params.isDunningRelated !== undefined) {
    query.isDunningRelated = params.isDunningRelated;
  }
  if (params.excludeFromDunning !== undefined) {
    query.excludeFromDunning = params.excludeFromDunning;
  }
  if (params.startDate && params.endDate) {
    query.complaintTime = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }

  const [complaints, total] = await Promise.all([
    Complaint.find(query).sort(sort).skip(skip).limit(pageSize),
    Complaint.countDocuments(query)
  ]);

  return buildPaginationResult(complaints, total, page, pageSize);
};

const updateComplaintStatus = async (complaintId, params, operator) => {
  const { status, handler, handleRemark, satisfaction, feedback } = params;

  const complaint = await Complaint.findById(complaintId);
  if (!complaint) {
    throw new NotFoundError('投诉记录不存在');
  }

  const oldData = complaint.toObject();

  if (status) {
    complaint.status = status;
  }
  if (handler) {
    complaint.handler = handler;
  }
  if (handleRemark) {
    complaint.handleRemark = handleRemark;
  }
  if (satisfaction) {
    complaint.satisfaction = satisfaction;
  }
  if (feedback) {
    complaint.feedback = feedback;
  }
  if (status === '已解决' || status === '已关闭') {
    complaint.handleTime = new Date();
    complaint.excludeFromDunning = false;
    complaint.excludeEndTime = null;
  }

  await complaint.save();

  const newData = complaint.toObject();
  const changes = getObjectDiff(oldData, newData);

  await logOperation({
    operator,
    operationType: '修改',
    operationModule: '住户管理',
    targetType: 'Complaint',
    targetId: complaint._id,
    targetNo: complaint.complaintNo,
    operationContent: `更新投诉状态为: ${status}`,
    beforeData: oldData,
    afterData: newData,
    changeFields: changes,
    operationResult: '成功'
  });

  return complaint;
};

const addToBlacklist = async (residentId, reason, operator) => {
  const resident = await Resident.findById(residentId);
  if (!resident) {
    throw new NotFoundError('住户不存在');
  }

  if (resident.isBlacklist) {
    throw new BusinessError('该住户已在黑名单中');
  }

  const oldData = resident.toObject();

  resident.isBlacklist = true;
  resident.blacklistReason = reason;
  resident.blacklistTime = new Date();

  await resident.save();

  const newData = resident.toObject();
  const changes = getObjectDiff(oldData, newData);

  await logOperation({
    operator,
    operationType: '修改',
    operationModule: '住户管理',
    targetType: 'Resident',
    targetId: resident._id,
    targetNo: resident.residentNo,
    operationContent: '加入黑名单',
    beforeData: oldData,
    afterData: newData,
    changeFields: changes,
    operationResult: '成功'
  });

  return resident;
};

const removeFromBlacklist = async (residentId, operator) => {
  const resident = await Resident.findById(residentId);
  if (!resident) {
    throw new NotFoundError('住户不存在');
  }

  if (!resident.isBlacklist) {
    throw new BusinessError('该住户不在黑名单中');
  }

  const oldData = resident.toObject();

  resident.isBlacklist = false;
  resident.blacklistReason = null;
  resident.blacklistTime = null;

  await resident.save();

  const newData = resident.toObject();
  const changes = getObjectDiff(oldData, newData);

  await logOperation({
    operator,
    operationType: '修改',
    operationModule: '住户管理',
    targetType: 'Resident',
    targetId: resident._id,
    targetNo: resident.residentNo,
    operationContent: '移出黑名单',
    beforeData: oldData,
    afterData: newData,
    changeFields: changes,
    operationResult: '成功'
  });

  return resident;
};

const getBlacklist = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = { isBlacklist: true };

  if (params.keyword) {
    query.$or = [
      { name: { $regex: params.keyword, $options: 'i' } },
      { phone: { $regex: params.keyword } }
    ];
  }

  const [residents, total] = await Promise.all([
    Resident.find(query).sort(sort).skip(skip).limit(pageSize),
    Resident.countDocuments(query)
  ]);

  return buildPaginationResult(residents, total, page, pageSize);
};

const getResidents = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.residentNo) {
    query.residentNo = params.residentNo;
  }
  if (params.name) {
    query.name = { $regex: params.name, $options: 'i' };
  }
  if (params.phone) {
    query.phone = params.phone;
  }
  if (params.isBlacklist !== undefined) {
    query.isBlacklist = params.isBlacklist;
  }
  if (params.overdueLevel) {
    query.overdueLevel = params.overdueLevel;
  }

  const [residents, total] = await Promise.all([
    Resident.find(query).sort(sort).skip(skip).limit(pageSize),
    Resident.countDocuments(query)
  ]);

  return buildPaginationResult(residents, total, page, pageSize);
};

const getResidentDetail = async (residentId) => {
  const resident = await Resident.findById(residentId);
  if (!resident) {
    throw new NotFoundError('住户不存在');
  }

  const houses = await House.find({ residentId });
  const complaints = await Complaint.find({ residentId }).sort({ complaintTime: -1 }).limit(10);

  return {
    resident,
    houses,
    recentComplaints: complaints
  };
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
