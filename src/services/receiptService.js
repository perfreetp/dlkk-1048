const Receipt = require('../models/Receipt');
const MessageQueue = require('../models/MessageQueue');
const DunningTask = require('../models/DunningTask');
const House = require('../models/House');
const logger = require('../utils/logger');
const {
  generateNo,
  parsePageParams,
  buildPaginationResult,
  buildSortParams
} = require('../utils/common');
const { NotFoundError, BusinessError } = require('../utils/errors');
const { logOperation } = require('../middleware');

const registerReceipt = async (params, operator) => {
  const {
    platformMsgId,
    receiptType,
    status,
    statusCode,
    statusMessage,
    responseContent,
    receivedAt,
    callRecord
  } = params;

  let queueItem = null;
  if (platformMsgId) {
    queueItem = await MessageQueue.findOne({ platformMsgId });
  }

  if (!queueItem && params.queueId) {
    queueItem = await MessageQueue.findById(params.queueId);
  }

  if (!queueItem) {
    throw new NotFoundError('未找到对应的消息记录');
  }

  const existingReceipt = await Receipt.findOne({
    platformMsgId,
    receiptType
  });

  if (existingReceipt) {
    throw new BusinessError('该回执已登记，不能重复登记');
  }

  const receiptNo = generateNo('RCP');

  const receipt = new Receipt({
    receiptNo,
    queueId: queueItem._id,
    queueNo: queueItem.queueNo,
    taskId: queueItem.taskId,
    houseId: queueItem.houseId,
    houseNo: queueItem.houseNo,
    residentId: queueItem.residentId,
    messageType: queueItem.messageType,
    receiptType,
    platformMsgId,
    status,
    statusCode,
    statusMessage,
    responseContent,
    callRecord,
    receivedAt: receivedAt || new Date(),
    registeredBy: operator
  });

  await receipt.save();

  const updateData = {};
  if (receiptType === '发送回执') {
    updateData.status = status === '成功' ? '已发送' : '失败';
    updateData.sentAt = receivedAt || new Date();
    if (status !== '成功') {
      updateData.errorCode = statusCode;
      updateData.errorMessage = statusMessage;
    }
  } else if (receiptType === '送达回执') {
    updateData.status = '已送达';
    updateData.deliveredAt = receivedAt || new Date();
  } else if (receiptType === '阅读回执') {
    updateData.status = '已读';
    updateData.readAt = receivedAt || new Date();
  } else if (receiptType === '回复回执') {
    updateData.status = '已回复';
    updateData.responseContent = responseContent;
    updateData.responseAt = receivedAt || new Date();
  } else if (receiptType === '通话回执') {
    updateData.status = '已回复';
    updateData.callRecord = callRecord;
    updateData.responseAt = receivedAt || new Date();
  }

  await MessageQueue.findByIdAndUpdate(queueItem._id, updateData);

  if (queueItem.taskId && queueItem.taskItemId) {
    await DunningTask.updateOne(
      { _id: queueItem.taskId, 'items._id': queueItem.taskItemId },
      {
        $set: {
          'items.$.status': updateData.status,
          'items.$.responseContent': responseContent
        }
      }
    );
  }

  await logOperation({
    operator,
    operationType: '创建',
    operationModule: '回执登记',
    targetType: 'Receipt',
    targetId: receipt._id,
    targetNo: receiptNo,
    operationContent: `登记${receiptType}，消息ID: ${platformMsgId}`,
    afterData: receipt.toObject(),
    operationResult: '成功'
  });

  return receipt;
};

const getReceipts = async (params) => {
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.receiptNo) {
    query.receiptNo = params.receiptNo;
  }
  if (params.queueNo) {
    query.queueNo = params.queueNo;
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
  if (params.receiptType) {
    query.receiptType = params.receiptType;
  }
  if (params.platformMsgId) {
    query.platformMsgId = params.platformMsgId;
  }
  if (params.status) {
    query.status = params.status;
  }
  if (params.startDate && params.endDate) {
    query.receivedAt = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }

  const [receipts, total] = await Promise.all([
    Receipt.find(query).sort(sort).skip(skip).limit(pageSize),
    Receipt.countDocuments(query)
  ]);

  return buildPaginationResult(receipts, total, page, pageSize);
};

const syncPayment = async (params, operator) => {
  const PaymentRecord = require('../models/PaymentRecord');
  const PropertyFee = require('../models/PropertyFee');
  const Resident = require('../models/Resident');
  const { updateResidentArrearsInfo } = require('./arrearsService');

  const {
    sourceOrderNo,
    syncSource = '收费系统',
    houseNo,
    feeIds,
    paymentMethod,
    totalAmount,
    paidAmount,
    lateFee = 0,
    discountAmount = 0,
    paymentDate,
    payerName,
    payerPhone,
    remark,
    receiptNo
  } = params;

  const house = await House.findOne({ houseNo });
  if (!house) {
    throw new NotFoundError('房屋不存在');
  }

  if (sourceOrderNo) {
    const existingPayment = await PaymentRecord.findOne({
      sourceOrderNo,
      syncSource
    });
    if (existingPayment) {
      throw new BusinessError('该付款记录已同步，不能重复同步');
    }
  }

  const fees = await PropertyFee.find({
    _id: { $in: feeIds },
    houseId: house._id
  });

  if (fees.length === 0) {
    throw new BusinessError('未找到对应的费用记录');
  }

  const paymentNo = generateNo('PAY');

  let session = null;
  let useTransaction = true;

  try {
    session = await PaymentRecord.startSession();
    session.startTransaction();
    const testRecord = new PaymentRecord({ paymentNo: `TEST-${Date.now()}` });
    try {
      await testRecord.save({ session });
      await session.abortTransaction();
      session = await PaymentRecord.startSession();
      session.startTransaction();
    } catch (txTestErr) {
      useTransaction = false;
      try { session.endSession(); } catch (e) {}
      session = null;
      logger.warn('MongoDB不支持事务（standalone模式），将以非事务模式执行');
    }
  } catch (e) {
    useTransaction = false;
    logger.warn('MongoDB不支持事务，将以非事务模式执行: ' + e.message);
  }

  try {
    const paymentRecord = new PaymentRecord({
      paymentNo,
      syncSource,
      sourceOrderNo,
      houseId: house._id,
      houseNo,
      residentId: house.residentId,
      feeIds: fees.map(f => f._id),
      paymentMethod,
      totalAmount,
      paidAmount,
      lateFee,
      discountAmount,
      paymentDate: paymentDate || new Date(),
      payerName,
      payerPhone,
      remark,
      receiptNo,
      createdBy: operator
    });

    try {
      if (useTransaction && session) {
        await paymentRecord.save({ session });
      } else {
        await paymentRecord.save();
      }
    } catch (saveErr) {
      if (useTransaction && saveErr && saveErr.code === 20) {
        useTransaction = false;
        try { session.abortTransaction(); } catch (e) {}
        try { session.endSession(); } catch (e) {}
        session = null;
        logger.warn('事务执行失败，降级为非事务模式');
        await paymentRecord.save();
      } else {
        throw saveErr;
      }
    }

    let remainingAmount = paidAmount;
    const sortedFees = fees.sort((a, b) => a.dueDate - b.dueDate);

    for (const fee of sortedFees) {
      if (remainingAmount <= 0) break;

      const paymentForThisFee = Math.min(remainingAmount, fee.unpaidAmount);
      fee.paidAmount = Number((fee.paidAmount + paymentForThisFee).toFixed(2));
      fee.unpaidAmount = Number((fee.totalAmount - fee.paidAmount).toFixed(2));
      fee.lastPaymentDate = paymentDate || new Date();

      if (fee.unpaidAmount <= 0) {
        fee.paymentStatus = '已结清';
        fee.unpaidAmount = 0;
      } else {
        fee.paymentStatus = '部分缴';
      }

      remainingAmount = Number((remainingAmount - paymentForThisFee).toFixed(2));
      if (useTransaction && session) {
        await fee.save({ session });
      } else {
        await fee.save();
      }
    }

    if (useTransaction && session) {
      try {
        await session.commitTransaction();
      } catch (commitErr) {
        if (commitErr && commitErr.code === 20) {
          logger.warn('事务提交不支持，已以非事务方式保存');
        } else {
          throw commitErr;
        }
      }
    }

    if (house.residentId) {
      await updateResidentArrearsInfo(house.residentId);
    }

    await logOperation({
      operator,
      operationType: '同步',
      operationModule: '付款同步',
      targetType: 'PaymentRecord',
      targetId: paymentRecord._id,
      targetNo: paymentNo,
      operationContent: `同步付款记录，金额: ${paidAmount}元`,
      afterData: paymentRecord.toObject(),
      operationResult: '成功'
    });

    return {
      paymentRecord,
      updatedFees: fees.length,
      remainingAmount
    };

  } catch (error) {
    if (useTransaction && session) {
      try { await session.abortTransaction(); } catch (e) {}
    }
    throw error;
  } finally {
    if (session) {
      try { session.endSession(); } catch (e) {}
    }
  }
};

const getPaymentRecords = async (params) => {
  const PaymentRecord = require('../models/PaymentRecord');
  
  const { page, pageSize, skip } = parsePageParams(params);
  const sort = buildSortParams(params.sortBy, params.sortOrder);
  const query = {};

  if (params.paymentNo) {
    query.paymentNo = params.paymentNo;
  }
  if (params.sourceOrderNo) {
    query.sourceOrderNo = params.sourceOrderNo;
  }
  if (params.houseNo) {
    query.houseNo = params.houseNo;
  }
  if (params.syncSource) {
    query.syncSource = params.syncSource;
  }
  if (params.paymentMethod) {
    query.paymentMethod = params.paymentMethod;
  }
  if (params.syncStatus) {
    query.syncStatus = params.syncStatus;
  }
  if (params.startDate && params.endDate) {
    query.paymentDate = {
      $gte: new Date(params.startDate),
      $lte: new Date(params.endDate + ' 23:59:59')
    };
  }

  const [records, total] = await Promise.all([
    PaymentRecord.find(query).sort(sort).skip(skip).limit(pageSize),
    PaymentRecord.countDocuments(query)
  ]);

  return buildPaginationResult(records, total, page, pageSize);
};

module.exports = {
  registerReceipt,
  getReceipts,
  syncPayment,
  getPaymentRecords
};
