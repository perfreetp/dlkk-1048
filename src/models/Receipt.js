const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema({
  receiptNo: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  queueId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MessageQueue',
    index: true
  },
  queueNo: {
    type: String
  },
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DunningTask'
  },
  houseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'House',
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
  messageType: {
    type: String,
    enum: ['短信', '电话', '信函', '上门'],
    required: true,
    index: true
  },
  receiptType: {
    type: String,
    enum: ['发送回执', '送达回执', '阅读回执', '回复回执', '通话回执'],
    required: true
  },
  platformMsgId: {
    type: String,
    index: true
  },
  status: {
    type: String,
    required: true
  },
  statusCode: {
    type: String
  },
  statusMessage: {
    type: String
  },
  responseContent: {
    type: String
  },
  callRecord: {
    callStartTime: Date,
    callEndTime: Date,
    callDuration: Number,
    callStatus: String,
    recordingUrl: String,
    transcript: String
  },
  receivedAt: {
    type: Date,
    required: true,
    index: true
  },
  registeredBy: {
    type: String
  },
  registeredAt: {
    type: Date,
    default: Date.now
  },
  remark: {
    type: String
  }
});

receiptSchema.index({ houseId: 1, receivedAt: -1 });
receiptSchema.index({ platformMsgId: 1, receiptType: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Receipt', receiptSchema);
