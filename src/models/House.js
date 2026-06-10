const mongoose = require('mongoose');

const houseSchema = new mongoose.Schema({
  houseNo: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  building: {
    type: String,
    required: true,
    index: true
  },
  unit: {
    type: String,
    required: true
  },
  roomNo: {
    type: String,
    required: true
  },
  area: {
    type: Number,
    required: true
  },
  houseType: {
    type: String,
    enum: ['住宅', '商铺', '写字楼', '车位'],
    default: '住宅'
  },
  residentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resident'
  },
  ownerName: {
    type: String
  },
  ownerPhone: {
    type: String
  },
  status: {
    type: String,
    enum: ['已收房', '未收房', '空置', '已转让'],
    default: '已收房'
  },
  propertyFeeStandard: {
    type: Number,
    required: true
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

houseSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

houseSchema.index({ building: 1, unit: 1, roomNo: 1 }, { unique: true });

module.exports = mongoose.model('House', houseSchema);
