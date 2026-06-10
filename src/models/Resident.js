const mongoose = require('mongoose');

const residentSchema = new mongoose.Schema({
  residentNo: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
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
  houseIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'House'
  }],
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

residentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Resident', residentSchema);
