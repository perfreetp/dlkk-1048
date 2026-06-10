const receiptService = require('../services/receiptService');
const { BusinessError } = require('../utils/errors');

const registerReceipt = async (req, res, next) => {
  try {
    const operator = req.get('X-Operator') || 'system';
    const result = await receiptService.registerReceipt(req.body, operator);
    res.success(result, '回执登记成功');
  } catch (error) {
    next(error);
  }
};

const getReceipts = async (req, res, next) => {
  try {
    const result = await receiptService.getReceipts(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const syncPayment = async (req, res, next) => {
  try {
    const operator = req.get('X-Operator') || 'system';
    const result = await receiptService.syncPayment(req.body, operator);
    res.success(result, '付款同步成功');
  } catch (error) {
    next(error);
  }
};

const getPaymentRecords = async (req, res, next) => {
  try {
    const result = await receiptService.getPaymentRecords(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const batchSyncPayments = async (req, res, next) => {
  try {
    const { payments } = req.body;
    const operator = req.get('X-Operator') || 'system';
    
    if (!payments || !Array.isArray(payments)) {
      throw new BusinessError('付款记录数组不能为空');
    }
    
    const results = [];
    for (const payment of payments) {
      try {
        const result = await receiptService.syncPayment(payment, operator);
        results.push({
          success: true,
          sourceOrderNo: payment.sourceOrderNo,
          ...result
        });
      } catch (error) {
        results.push({
          success: false,
          sourceOrderNo: payment.sourceOrderNo,
          error: error.message
        });
      }
    }
    
    res.success({
      total: payments.length,
      successCount: results.filter(r => r.success).length,
      failedCount: results.filter(r => !r.success).length,
      results
    }, '批量同步完成');
  } catch (error) {
    next(error);
  }
};

const batchRegisterReceipts = async (req, res, next) => {
  try {
    const { receipts } = req.body;
    const operator = req.get('X-Operator') || 'system';
    
    if (!receipts || !Array.isArray(receipts)) {
      throw new BusinessError('回执记录数组不能为空');
    }
    
    const results = [];
    for (const receipt of receipts) {
      try {
        const result = await receiptService.registerReceipt(receipt, operator);
        results.push({
          success: true,
          platformMsgId: receipt.platformMsgId,
          receiptNo: result.receiptNo
        });
      } catch (error) {
        results.push({
          success: false,
          platformMsgId: receipt.platformMsgId,
          error: error.message
        });
      }
    }
    
    res.success({
      total: receipts.length,
      successCount: results.filter(r => r.success).length,
      failedCount: results.filter(r => !r.success).length,
      results
    }, '批量登记完成');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerReceipt,
  getReceipts,
  syncPayment,
  getPaymentRecords,
  batchSyncPayments,
  batchRegisterReceipts
};
