const moment = require('moment');
const ReductionApplication = require('../models/ReductionApplication');
const PropertyFee = require('../models/PropertyFee');
const House = require('../models/House');
const Resident = require('../models/Resident');
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

const createReductionApplication = async (params, operator) => {
  const {
    houseNo,
    applicantName,
    applicantPhone,
    feeIds,
    reductionType,
    reductionAmount,
    reductionReason,
    reasonCategory,
    supportingDocuments,
    installmentPlan,
    remark
  } = params;

  const house = await House.findOne({ houseNo }).populate('residentId');
  if (!house) {
    throw new NotFoundError('房屋不存在');
  }

  const fees = await PropertyFee.find({
    _id: { $in: feeIds },
    houseId: house._id,
    paymentStatus: { $in: ['未缴', '部分缴'] }
  });

  if (fees.length === 0) {
    throw new BusinessError('未找到有效的欠费记录');
  }

  const totalAmount = fees.reduce((sum, fee) => sum + fee.unpaidAmount, 0);

  if (reductionAmount > totalAmount) {
    throw new BusinessError('减免金额不能大于欠费总额');
  }

  if (reductionType === '全额减免' && reductionAmount !== totalAmount) {
    throw new BusinessError('全额减免金额必须等于欠费总额');
  }

  const actualPayAmount = totalAmount - reductionAmount;

  const applicationNo = generateNo('RED');

  const maxApprovalLevel = reductionAmount >= 10000 ? 3 : reductionAmount >= 5000 ? 2 : 1;

  const application = new ReductionApplication({
    applicationNo,
    houseId: house._id,
    houseNo,
    residentId: house.residentId ? house.residentId._id : null,
    residentName: house.residentId ? house.residentId.name : house.ownerName,
    applicantName,
    applicantPhone,
    feeIds,
    reductionType,
    totalAmount,
    reductionAmount,
    actualPayAmount,
    reductionReason,
    reasonCategory,
    supportingDocuments: supportingDocuments || [],
    installmentPlan,
    status: '待审批',
    currentApprovalLevel: 1,
    maxApprovalLevel,
    applicant: operator,
    applicationTime: new Date()
  });

  await application.save();

  await logOperation({
    operator,
    operationType: '创建',
    operationModule: '减免申请',
    targetType: 'ReductionApplication',
    targetId: application._id,
    targetNo: applicationNo,
    operationContent: `提交减免申请，金额: ${reductionAmount}元`,
    afterData: application.toObject(),
    operationResult: '成功'
  });

  return application;
};

const getReductionApplications = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.applicationNo) {
    query.applicationNo = params.applicationNo;
  }
  if (params.houseNo) {
    query.houseNo = params.houseNo;
  }
  if (params.reductionType) {
    query.reductionType = params.reductionType;
  }
  if (params.status) {
    query.status = params.status;
  }
  if (params.applicant) {
    query.applicant = params.applicant;
  }
  if (params.currentApprovalLevel) {
    query.currentApprovalLevel = params.currentApprovalLevel;
  }
  if (params.startDate && params.endDate) {
    query.applicationTime = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }

  const [applications, total] = await Promise.all([
    ReductionApplication.find(query).sort(sort).skip(skip).limit(pageSize),
    ReductionApplication.countDocuments(query)
  ]);

  return buildPaginationResult(applications, total, page, pageSize);
};

const getReductionApplicationDetail = async (applicationId) => {
  const application = await ReductionApplication.findById(applicationId);
  if (!application) {
    throw new NotFoundError('减免申请不存在');
  }

  const fees = await PropertyFee.find({
    _id: { $in: application.feeIds }
  });

  const house = await House.findById(application.houseId);

  return {
    application,
    house,
    fees
  };
};

const approveReductionApplication = async (applicationId, params, operator) => {
  const { action, approvalRemark } = params;

  const application = await ReductionApplication.findById(applicationId);
  if (!application) {
    throw new NotFoundError('减免申请不存在');
  }

  if (application.status !== '待审批') {
    throw new BusinessError(`申请状态为${application.status}，不能审批`);
  }

  const oldData = application.toObject();

  const approvalRecord = {
    level: application.currentApprovalLevel,
    role: `第${application.currentApprovalLevel}级审批人`,
    approver: operator,
    action,
    approvalRemark,
    approvalTime: new Date()
  };

  if (!application.approvalWorkflow) {
    application.approvalWorkflow = [];
  }
  application.approvalWorkflow.push(approvalRecord);

  if (action === '拒绝') {
    application.status = '已拒绝';
    application.finalApprover = operator;
    application.finalApprovalTime = new Date();
    application.finalApprovalRemark = approvalRemark;
  } else if (action === '批准') {
    if (application.currentApprovalLevel >= application.maxApprovalLevel) {
      application.status = '已批准';
      application.finalApprover = operator;
      application.finalApprovalTime = new Date();
      application.finalApprovalRemark = approvalRemark;
      application.executionStatus = '待执行';
    } else {
      application.currentApprovalLevel++;
    }
  } else if (action === '转审') {
    application.maxApprovalLevel++;
  }

  await application.save();

  const newData = application.toObject();
  const changes = getObjectDiff(oldData, newData, ['approvalWorkflow', 'updatedAt']);

  await logOperation({
    operator,
    operationType: '审批',
    operationModule: '减免申请',
    targetType: 'ReductionApplication',
    targetId: application._id,
    targetNo: application.applicationNo,
    operationContent: `${action}减免申请 ${application.applicationNo}`,
    beforeData: oldData,
    afterData: newData,
    changeFields: changes,
    operationResult: '成功'
  });

  if (application.status === '已批准' && application.executionStatus === '待执行') {
    await executeReduction(application, operator);
  }

  return application;
};

const executeReduction = async (application, operator) => {
  const session = await PropertyFee.startSession();
  session.startTransaction();

  try {
    application.executionStatus = '执行中';
    await application.save({ session });

    const fees = await PropertyFee.find({
      _id: { $in: application.feeIds }
    }).session(session);

    let remainingReduction = application.reductionAmount;
    const sortedFees = fees.sort((a, b) => a.dueDate - b.dueDate);

    for (const fee of sortedFees) {
      if (remainingReduction <= 0) break;

      const reductionForThisFee = Math.min(remainingReduction, fee.unpaidAmount);
      fee.discountAmount += reductionForThisFee;
      fee.unpaidAmount -= reductionForThisFee;
      remainingReduction -= reductionForThisFee;

      if (fee.unpaidAmount <= 0) {
        fee.paymentStatus = '减免';
        fee.unpaidAmount = 0;
      }

      await fee.save({ session });
    }

    if (application.residentId) {
      const { updateResidentArrearsInfo } = require('./arrearsService');
      await updateResidentArrearsInfo(application.residentId);
    }

    application.executionStatus = '已执行';
    application.executedAt = new Date();
    application.status = '已完成';
    await application.save({ session });

    await session.commitTransaction();

    await logOperation({
      operator,
      operationType: '修改',
      operationModule: '减免申请',
      targetType: 'ReductionApplication',
      targetId: application._id,
      targetNo: application.applicationNo,
      operationContent: `执行减免 ${application.applicationNo}，金额: ${application.reductionAmount}元`,
      operationResult: '成功'
    });

    return application;

  } catch (error) {
    await session.abortTransaction();
    application.executionStatus = '执行失败';
    await application.save();
    logger.error('执行减免失败:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

const getPendingApprovals = async (params, operator) => {
  const query = {
    status: '待审批'
  };

  return getReductionApplications({ ...params, ...query });
};

const getPromisedPaymentReminders = async () => {
  const today = moment().startOf('day');
  const threeDaysLater = moment().add(3, 'days').endOf('day');

  const residents = await Resident.find({
    promisedPaymentDate: {
      $gte: today.toDate(),
      $lte: threeDaysLater.toDate()
    },
    totalArrears: { $gt: 0 }
  }).populate('houseIds');

  const reminders = residents.map(resident => {
    const daysUntilPromise = moment(resident.promisedPaymentDate).diff(today, 'days');
    return {
      residentId: resident._id,
      residentName: resident.name,
      residentPhone: resident.phone,
      promisedPaymentDate: resident.promisedPaymentDate,
      daysUntilPromise,
      totalArrears: resident.totalArrears,
      houses: resident.houseIds.map(h => ({
        houseNo: h.houseNo,
        building: h.building
      })),
      isExpiringSoon: daysUntilPromise <= 1
    };
  });

  return {
    total: reminders.length,
    expiringSoon: reminders.filter(r => r.isExpiringSoon).length,
    reminders
  };
};

const updateCustomerRemark = async (residentId, remark, operator) => {
  const resident = await Resident.findById(residentId);
  if (!resident) {
    throw new NotFoundError('住户不存在');
  }

  const oldData = resident.toObject();
  resident.customerRemark = remark;
  await resident.save();

  const changes = getObjectDiff(oldData, resident.toObject());

  await logOperation({
    operator,
    operationType: '修改',
    operationModule: '住户管理',
    targetType: 'Resident',
    targetId: resident._id,
    targetNo: resident.residentNo,
    operationContent: '更新客服备注',
    beforeData: oldData,
    afterData: resident.toObject(),
    changeFields: changes,
    operationResult: '成功'
  });

  return resident;
};

const setPromisedPaymentDate = async (residentId, promisedDate, operator) => {
  const resident = await Resident.findById(residentId);
  if (!resident) {
    throw new NotFoundError('住户不存在');
  }

  const oldData = resident.toObject();
  resident.promisedPaymentDate = promisedDate ? new Date(promisedDate) : null;
  await resident.save();

  const changes = getObjectDiff(oldData, resident.toObject());

  await logOperation({
    operator,
    operationType: '修改',
    operationModule: '住户管理',
    targetType: 'Resident',
    targetId: resident._id,
    targetNo: resident.residentNo,
    operationContent: `设置承诺付款日期: ${promisedDate || '清除'}`,
    beforeData: oldData,
    afterData: resident.toObject(),
    changeFields: changes,
    operationResult: '成功'
  });

  return resident;
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
