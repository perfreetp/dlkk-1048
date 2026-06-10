const PropertyFee = require('../models/PropertyFee');
const House = require('../models/House');
const Resident = require('../models/Resident');
const Complaint = require('../models/Complaint');
const config = require('../config');
const logger = require('../utils/logger');
const {
  calculateOverdueDays,
  calculateOverdueLevel,
  parsePageParams,
  buildPaginationResult,
  buildSortParams,
  generateNo,
  getObjectDiff
} = require('../utils/common');
const { NotFoundError, BusinessError, ValidationError } = require('../utils/errors');
const { logOperation } = require('../middleware');

const updateFeeOverdueStatus = async (propertyFee) => {
  const overdueDays = calculateOverdueDays(propertyFee.dueDate);
  const overdueLevel = calculateOverdueLevel(overdueDays);
  const isOverdue = overdueDays > 0;

  if (propertyFee.overdueDays !== overdueDays ||
      propertyFee.overdueLevel !== overdueLevel ||
      propertyFee.isOverdue !== isOverdue) {
    propertyFee.overdueDays = overdueDays;
    propertyFee.overdueLevel = overdueLevel;
    propertyFee.isOverdue = isOverdue;
    await propertyFee.save();
  }

  return propertyFee;
};

const updateResidentArrearsInfo = async (residentId) => {
  const fees = await PropertyFee.find({
    residentId,
    unpaidAmount: { $gt: 0 },
    paymentStatus: { $in: ['未结清', '部分缴', '未缴'] }
  });

  const totalArrears = fees.reduce((sum, fee) => sum + fee.unpaidAmount, 0);
  const maxOverdueDays = Math.max(...fees.map(f => f.overdueDays || 0), 0);
  const overdueLevel = calculateOverdueLevel(maxOverdueDays);

  await Resident.findByIdAndUpdate(residentId, {
    totalArrears,
    overdueLevel
  });
};

const queryArrears = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);

  const query = {};

  if (params.houseNo) {
    query.houseNo = params.houseNo;
  }

  if (params.building) {
    query['$expr'] = { $eq: ['$building', params.building] };
  }

  if (params.residentName) {
    const residents = await Resident.find({ name: { $regex: params.residentName, $options: 'i' } }).select('_id');
    const residentIds = residents.map(r => r._id);
    if (residentIds.length > 0) {
      query.residentId = { $in: residentIds };
    } else {
      return buildPaginationResult([], 0, page, pageSize);
    }
  }

  if (params.residentPhone) {
    const residents = await Resident.find({ phone: params.residentPhone }).select('_id');
    const residentIds = residents.map(r => r._id);
    if (residentIds.length > 0) {
      query.residentId = { $in: residentIds };
    } else {
      return buildPaginationResult([], 0, page, pageSize);
    }
  }

  if (params.paymentStatus) {
    query.paymentStatus = params.paymentStatus;
  }

  if (params.overdueLevel) {
    query.overdueLevel = params.overdueLevel;
  }

  if (params.isOverdue !== undefined) {
    query.isOverdue = params.isOverdue;
  }

  if (params.minOverdueDays !== undefined) {
    query.overdueDays = { ...query.overdueDays, $gte: params.minOverdueDays };
  }

  if (params.maxOverdueDays !== undefined) {
    query.overdueDays = { ...query.overdueDays, $lte: params.maxOverdueDays };
  }

  if (params.minArrearsAmount !== undefined) {
    query.unpaidAmount = { ...query.unpaidAmount, $gte: params.minArrearsAmount };
  }

  if (params.maxArrearsAmount !== undefined) {
    query.unpaidAmount = { ...query.unpaidAmount, $lte: params.maxArrearsAmount };
  }

  if (params.feeType) {
    query.feeType = params.feeType;
  }

  if (params.feeYear) {
    query['feePeriod.year'] = params.feeYear;
  }

  if (params.feeMonth) {
    query['feePeriod.month'] = params.feeMonth;
  }

  const [fees, total] = await Promise.all([
    PropertyFee.find(query)
      .populate('houseId', 'houseNo building unit roomNo area ownerName ownerPhone')
      .populate('residentId', 'name phone customerRemark isBlacklist complaintCount promisedPaymentDate')
      .sort(sort)
      .skip(skip)
      .limit(pageSize)
      .lean(),
    PropertyFee.countDocuments(query)
  ]);

  for (const fee of fees) {
    if (fee.houseId) {
      fee.house = fee.houseId;
      delete fee.houseId;
    }
    if (fee.residentId) {
      fee.resident = fee.residentId;
      delete fee.residentId;
    }
  }

  return buildPaginationResult(fees, total, page, pageSize);
};

const getHouseArrearsDetail = async (houseNo) => {
  const house = await House.findOne({ houseNo });
  if (!house) {
    throw new NotFoundError('房屋不存在');
  }

  const fees = await PropertyFee.find({
    houseId: house._id,
    unpaidAmount: { $gt: 0 },
    paymentStatus: { $in: ['未结清', '部分缴', '未缴'] }
  }).sort({ dueDate: 1 });

  for (const fee of fees) {
    await updateFeeOverdueStatus(fee);
  }

  const totalArrears = fees.reduce((sum, fee) => sum + fee.unpaidAmount, 0);
  const totalLateFee = fees.reduce((sum, fee) => sum + fee.lateFee, 0);
  const maxOverdueDays = Math.max(...fees.map(f => f.overdueDays), 0);

  const resident = house.residentId ? await Resident.findById(house.residentId) : null;
  const complaints = resident ? await Complaint.find({
    residentId: resident._id,
    status: { $in: ['待处理', '处理中'] },
    excludeFromDunning: true
  }) : [];

  const dunningExcluded = complaints.length > 0 || (resident && resident.isBlacklist);
  const exclusionReasons = [];
  if (resident && resident.isBlacklist) {
    exclusionReasons.push('黑名单用户');
  }
  if (complaints.length > 0) {
    exclusionReasons.push('存在未处理投诉');
  }

  return {
    house: {
      houseNo: house.houseNo,
      building: house.building,
      unit: house.unit,
      roomNo: house.roomNo,
      area: house.area,
      ownerName: house.ownerName,
      ownerPhone: house.ownerPhone
    },
    resident: resident ? {
      id: resident._id,
      name: resident.name,
      phone: resident.phone,
      isBlacklist: resident.isBlacklist,
      complaintCount: resident.complaintCount,
      customerRemark: resident.customerRemark,
      promisedPaymentDate: resident.promisedPaymentDate
    } : null,
    arrearsFees: fees,
    summary: {
      totalArrears,
      totalLateFee,
      overdueCount: fees.length,
      maxOverdueDays,
      overdueLevel: calculateOverdueLevel(maxOverdueDays)
    },
    dunningRestriction: {
      excluded: dunningExcluded,
      reasons: exclusionReasons
    }
  };
};

const getResidentArrearsDetail = async (residentId) => {
  const resident = await Resident.findById(residentId);
  if (!resident) {
    throw new NotFoundError('住户不存在');
  }

  const houses = await House.find({ residentId });
  const houseIds = houses.map(h => h._id);

  const fees = await PropertyFee.find({
    houseId: { $in: houseIds },
    unpaidAmount: { $gt: 0 },
    paymentStatus: { $in: ['未结清', '部分缴', '未缴'] }
  }).populate('houseId', 'houseNo building unit roomNo');

  for (const fee of fees) {
    await updateFeeOverdueStatus(fee);
  }

  const houseArrearsMap = {};
  for (const fee of fees) {
    const houseNo = fee.houseId ? fee.houseId.houseNo : fee.houseNo;
    if (!houseArrearsMap[houseNo]) {
      houseArrearsMap[houseNo] = {
        house: fee.houseId,
        fees: [],
        totalArrears: 0
      };
    }
    houseArrearsMap[houseNo].fees.push(fee);
    houseArrearsMap[houseNo].totalArrears += fee.unpaidAmount;
  }

  const totalArrears = fees.reduce((sum, fee) => sum + fee.unpaidAmount, 0);

  return {
    resident: {
      id: resident._id,
      residentNo: resident.residentNo,
      name: resident.name,
      phone: resident.phone,
      isBlacklist: resident.isBlacklist,
      complaintCount: resident.complaintCount,
      customerRemark: resident.customerRemark,
      promisedPaymentDate: resident.promisedPaymentDate,
      overdueLevel: resident.overdueLevel,
      totalArrears: resident.totalArrears
    },
    houses: Object.values(houseArrearsMap),
    totalArrears
  };
};

const recalculateFee = async (feeId, params, operator) => {
  const fee = await PropertyFee.findById(feeId);
  if (!fee) {
    throw new NotFoundError('费用记录不存在');
  }

  if (fee.paymentStatus === '已缴' || fee.paymentStatus === '已结清') {
    throw new BusinessError('已缴费用不能重算');
  }

  const oldAmount = fee.totalAmount;
  const oldData = fee.toObject();

  if (params.billingArea !== undefined) {
    fee.billingArea = params.billingArea;
  }
  if (params.area !== undefined) {
    fee.billingArea = params.area;
  }
  if (params.unitPrice !== undefined) {
    fee.unitPrice = params.unitPrice;
  }
  if (params.lateFee !== undefined) {
    fee.lateFee = params.lateFee;
  }
  if (params.discountAmount !== undefined) {
    fee.discountAmount = params.discountAmount;
  }
  if (params.dueDate !== undefined) {
    fee.dueDate = params.dueDate;
  }

  fee.totalAmount = fee.billingArea * fee.unitPrice + (fee.lateFee || 0) - (fee.discountAmount || 0);
  fee.unpaidAmount = fee.totalAmount - fee.paidAmount;

  const recalculationRecord = {
    recalculatedAt: new Date(),
    recalculatedBy: operator,
    oldAmount,
    newAmount: fee.totalAmount,
    reason: params.reason || '费用重算'
  };

  if (!fee.recalculationHistory) {
    fee.recalculationHistory = [];
  }
  fee.recalculationHistory.push(recalculationRecord);

  await updateFeeOverdueStatus(fee);
  await fee.save();

  if (fee.residentId) {
    await updateResidentArrearsInfo(fee.residentId);
  }

  const newData = fee.toObject();
  const changes = getObjectDiff(oldData, newData, ['updatedAt', 'recalculationHistory']);

  await logOperation({
    operator,
    operationType: '修改',
    operationModule: '费用管理',
    targetType: 'PropertyFee',
    targetId: fee._id,
    targetNo: fee.feeNo,
    operationContent: `重算费用 ${fee.feeNo}`,
    beforeData: oldData,
    afterData: newData,
    changeFields: changes,
    operationResult: '成功'
  });

  return {
    fee,
    recalculationRecord
  };
};

const batchRecalculateFees = async (filters, params, operator) => {
  const query = {
    paymentStatus: { $in: ['未结清', '部分缴', '未缴'] }
  };

  if (filters.houseNos && filters.houseNos.length > 0) {
    query.houseNo = { $in: filters.houseNos };
  }

  if (filters.building) {
    const houses = await House.find({ building: filters.building }).select('_id');
    query.houseId = { $in: houses.map(h => h._id) };
  }

  if (filters.feeType) {
    query.feeType = filters.feeType;
  }

  if (filters.feeYear) {
    query['feePeriod.year'] = filters.feeYear;
  }

  const fees = await PropertyFee.find(query);
  const results = [];

  for (const fee of fees) {
    try {
      const result = await recalculateFee(fee._id, params, operator);
      results.push({
        feeId: fee._id,
        feeNo: fee.feeNo,
        success: true,
        oldAmount: result.recalculationRecord.oldAmount,
        newAmount: result.recalculationRecord.newAmount
      });
    } catch (error) {
      results.push({
        feeId: fee._id,
        feeNo: fee.feeNo,
        success: false,
        error: error.message
      });
    }
  }

  return {
    total: fees.length,
    successCount: results.filter(r => r.success).length,
    failedCount: results.filter(r => !r.success).length,
    results
  };
};

const batchRefreshOverdueStatus = async () => {
  const fees = await PropertyFee.find({
    paymentStatus: { $in: ['未结清', '部分缴', '未缴'] },
    unpaidAmount: { $gt: 0 }
  });

  let updatedCount = 0;
  for (const fee of fees) {
    const oldOverdueDays = fee.overdueDays;
    const oldOverdueLevel = fee.overdueLevel;
    const oldIsOverdue = fee.isOverdue;

    await updateFeeOverdueStatus(fee);

    if (oldOverdueDays !== fee.overdueDays ||
        oldOverdueLevel !== fee.overdueLevel ||
        oldIsOverdue !== fee.isOverdue) {
      updatedCount++;
      if (fee.residentId) {
        await updateResidentArrearsInfo(fee.residentId);
      }
    }
  }

  logger.info(`批量更新逾期状态完成，共更新 ${updatedCount} 条记录`);
  return { updatedCount, totalCount: fees.length };
};

module.exports = {
  queryArrears,
  getHouseArrearsDetail,
  getResidentArrearsDetail,
  recalculateFee,
  batchRecalculateFees,
  batchRefreshOverdueStatus,
  updateFeeOverdueStatus,
  updateResidentArrearsInfo
};
