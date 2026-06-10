const mongoose = require('mongoose');
const { generateNo } = require('../utils/common');

const residentSchema = new mongoose.Schema({
  residentNo: {
    type: String,
    unique: true,
    index: true
  },
  houseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'House',
    index: true
  },
  houseIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'House'
  }],
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true,
    index: true
  },
  idCard: {
    type: String
  },
  email: {
    type: String
  },
  address: {
    type: String
  },
  isBlacklist: {
    type: Boolean,
    default: false,
    index: true
  },
  blacklistReason: {
    type: String
  },
  blacklistTime: {
    type: Date
  },
  complaintCount: {
    type: Number,
    default: 0
  },
  isInComplaintHandling: {
    type: Boolean,
    default: false
  },
  lastComplaintTime: {
    type: Date
  },
  customerRemark: {
    type: String
  },
  promisedPaymentDate: {
    type: Date
  },
  overdueLevel: {
    type: String,
    enum: ['正常', '一级', '二级', '三级'],
    default: '正常'
  },
  totalArrears: {
    type: Number,
    default: 0
  },
  lastDunningTime: {
    type: Date
  },
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

residentSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  if (!this.residentNo) {
    this.residentNo = generateNo('RES');
  }
  if (this.houseId && (!this.houseIds || this.houseIds.length === 0)) {
    this.houseIds = [this.houseId];
  }
  next();
});

module.exports = mongoose.model('Resident', residentSchema);
