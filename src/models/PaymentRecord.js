const mongoose = require('mongoose');

const PAYMENT_METHOD_MAP = {
  '现金': '现金', 'cash': '现金',
  '刷卡': '刷卡', 'card': '刷卡', 'bankcard': '刷卡',
  '微信': '微信', '微信支付': '微信', 'wechat': '微信', 'wechatpay': '微信',
  '支付宝': '支付宝', 'alipay': '支付宝',
  '银行转账': '银行转账', '银行': '银行转账', 'transfer': '银行转账', 'bank': '银行转账',
  '抵扣': '抵扣', 'discount': '抵扣',
  '其他': '其他', 'other': '其他'
};

function normalizePaymentMethod(method) {
  if (!method) return '其他';
  if (['现金', '刷卡', '微信', '支付宝', '银行转账', '抵扣', '其他'].includes(method)) return method;
  const key = String(method).toLowerCase().replace(/[-_\s]/g, '');
  return PAYMENT_METHOD_MAP[key] || PAYMENT_METHOD_MAP[method] || '其他';
}

const paymentRecordSchema = new mongoose.Schema({
  paymentNo: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  syncSource: {
    type: String,
    enum: ['收费系统', '手动登记', '批量导入'],
    required: true
  },
  sourceOrderNo: {
    type: String,
    index: true
  },
  houseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'House',
    required: true,
    index: true
  },
  houseNo: {
    type: String,
    required: true,
    index: true
  },
  residentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resident',
    index: true
  },
  feeIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PropertyFee'
  }],
  paymentMethod: {
    type: String,
    enum: ['现金', '刷卡', '微信', '支付宝', '银行转账', '抵扣', '其他'],
    required: true,
    set: normalizePaymentMethod
  },
  totalAmount: {
    type: Number,
    required: true
  },
  paidAmount: {
    type: Number,
    required: true
  },
  lateFee: {
    type: Number,
    default: 0
  },
  discountAmount: {
    type: Number,
    default: 0
  },
  paymentDate: {
    type: Date,
    required: true,
    index: true
  },
  payerName: {
    type: String
  },
  payerPhone: {
    type: String
  },
  remark: {
    type: String
  },
  receiptNo: {
    type: String
  },
  syncStatus: {
    type: String,
    enum: ['已同步', '同步中', '同步失败'],
    default: '已同步',
    index: true
  },
  syncTime: {
    type: Date
  },
  syncErrorMessage: {
    type: String
  },
  createdBy: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

paymentRecordSchema.index({ houseId: 1, paymentDate: -1 });
paymentRecordSchema.index({ sourceOrderNo: 1, syncSource: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('PaymentRecord', paymentRecordSchema);
