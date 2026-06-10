const mongoose = require('mongoose');
const { generateNo } = require('../utils/common');

const propertyFeeSchema = new mongoose.Schema({
  feeNo: {
    type: String,
    unique: true,
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
    index: true
  },
  residentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resident',
    index: true
  },
  feeYear: {
    type: Number,
    required: true
  },
  feeMonth: {
    type: Number,
    required: true
  },
  feePeriod: {
    type: String,
    required: true,
    index: true
  },
  feeType: {
    type: String,
    enum: ['物业费', '车位费', '能耗费', '滞纳金', '其他'],
    default: '物业费'
  },
  billingArea: {
    type: Number,
    required: true
  },
  unitPrice: {
    type: Number,
    required: true
  },
  totalAmount: {
    type: Number,
    required: true
  },
  paidAmount: {
    type: Number,
    default: 0
  },
  unpaidAmount: {
    type: Number,
    default: 0,
    index: true
  },
  lateFee: {
    type: Number,
    default: 0
  },
  discountAmount: {
    type: Number,
    default: 0
  },
  paymentStatus: {
    type: String,
    enum: ['未结清', '已结清', '部分缴', '减免', '坏账'],
    default: '未结清',
    index: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  actualPaymentDate: {
    type: Date
  },
  isOverdue: {
    type: Boolean,
    default: false,
    index: true
  },
  overdueDays: {
    type: Number,
    default: 0
  },
  overdueLevel: {
    type: String,
    enum: ['正常', '一级', '二级', '三级'],
    default: '正常'
  },
  dunningStage: {
    type: String,
    enum: ['提醒期', '催告期', '严厉期', '法律期'],
    default: '提醒期'
  },
  lastPaymentDate: {
    type: Date
  },
  recalculated: {
    type: Boolean,
    default: false
  },
  recalculationHistory: [{
    recalculatedAt: Date,
    recalculatedBy: String,
    oldAmount: Number,
    newAmount: Number,
    reason: String
  }],
  createdBy: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

propertyFeeSchema.pre('save', function (next) {
  if (!this.feeNo) {
    this.feeNo = generateNo('FEE');
  }
  this.updatedAt = Date.now();
  next();
});

propertyFeeSchema.index({ houseId: 1, feePeriod: 1, feeType: 1 }, { unique: true });

module.exports = mongoose.model('PropertyFee', propertyFeeSchema);
