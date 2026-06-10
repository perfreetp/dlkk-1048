const mongoose = require('mongoose');

const messageQueueSchema = new mongoose.Schema({
  queueNo: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DunningTask',
    index: true
  },
  taskNo: {
    type: String
  },
  taskItemId: {
    type: mongoose.Schema.Types.ObjectId
  },
  messageType: {
    type: String,
    enum: ['短信', '电话', '信函', '上门'],
    required: true,
    index: true
  },
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DunningTemplate'
  },
  templateNo: {
    type: String
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
  residentName: {
    type: String
  },
  phone: {
    type: String,
    required: true
  },
  title: {
    type: String
  },
  content: {
    type: String,
    required: true
  },
  feeIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PropertyFee'
  }],
  totalArrears: {
    type: Number,
    default: 0
  },
  priority: {
    type: Number,
    default: 0,
    index: true
  },
  status: {
    type: String,
    enum: ['待发送', '发送中', '已发送', '已送达', '已读', '已回复', '失败', '已取消'],
    default: '待发送',
    index: true
  },
  scheduledAt: {
    type: Date,
    index: true
  },
  sentAt: {
    type: Date
  },
  deliveredAt: {
    type: Date
  },
  readAt: {
    type: Date
  },
  platformMsgId: {
    type: String,
    index: true
  },
  errorCode: {
    type: String
  },
  errorMessage: {
    type: String
  },
  retryCount: {
    type: Number,
    default: 0
  },
  maxRetryCount: {
    type: Number,
    default: 3
  },
  lastRetryAt: {
    type: Date
  },
  responseContent: {
    type: String
  },
  responseAt: {
    type: Date
  },
  callRecord: {
    callStartTime: Date,
    callEndTime: Date,
    callDuration: Number,
    callStatus: String,
    recordingUrl: String,
    transcript: String
  },
  createdBy: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

messageQueueSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

messageQueueSchema.index({ status: 1, scheduledAt: 1, priority: -1 });
messageQueueSchema.index({ houseId: 1, createdAt: -1 });

module.exports = mongoose.model('MessageQueue', messageQueueSchema);
