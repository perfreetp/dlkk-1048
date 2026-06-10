const mongoose = require('mongoose');

const propertyFeeSchema = new mongoose.Schema({
  feeNo: {
    type: String,
    required: true,
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
    required: true,
    index: true
  },
  residentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resident',
    index: true
  },
  feeType: {
    type: String,
    enum: ['物业费', '车位费', '能耗费', '滞纳金', '其他'],
    default: '物业费'
  },
  feePeriod: {
    year: { type: Number, required: true },
    month: { type: Number, required: true }
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  area: {
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
    required: true,
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
    enum: ['未缴', '部分缴', '已缴', '减免', '坏账'],
    default: '未缴',
    index: true
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
  lastPaymentDate: {
    type: Date
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

propertyFeeSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

propertyFeeSchema.index({ houseId: 1, 'feePeriod.year': 1, 'feePeriod.month': 1, feeType: 1 }, { unique: true });

module.exports = mongoose.model('PropertyFee', propertyFeeSchema);
