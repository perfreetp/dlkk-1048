const mongoose = require('mongoose');

const apiCallLogSchema = new mongoose.Schema({
  callNo: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  requestId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  caller: {
    type: String,
    enum: ['收费系统', '短信平台', '客服工具', '管理后台', '其他'],
    required: true,
    index: true
  },
  apiName: {
    type: String,
    required: true,
    index: true
  },
  httpMethod: {
    type: String,
    required: true
  },
  httpPath: {
    type: String,
    required: true
  },
  requestParams: {
    type: mongoose.Schema.Types.Mixed
  },
  requestBody: {
    type: mongoose.Schema.Types.Mixed
  },
  requestHeaders: {
    type: mongoose.Schema.Types.Mixed
  },
  responseStatus: {
    type: Number,
    index: true
  },
  responseCode: {
    type: String,
    index: true
  },
  responseMessage: {
    type: String
  },
  responseData: {
    type: mongoose.Schema.Types.Mixed
  },
  callStartTime: {
    type: Date,
    required: true
  },
  callEndTime: {
    type: Date,
    required: true
  },
  duration: {
    type: Number,
    required: true
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  success: {
    type: Boolean,
    required: true,
    index: true
  },
  errorMessage: {
    type: String
  },
  errorStack: {
    type: String
  },
  relatedTaskNo: {
    type: String,
    index: true
  },
  relatedHouseNo: {
    type: String,
    index: true
  }
});

apiCallLogSchema.index({ caller: 1, apiName: 1, callStartTime: -1 });
apiCallLogSchema.index({ callStartTime: -1, success: 1 });
apiCallLogSchema.index({ relatedHouseNo: 1, callStartTime: -1 });

module.exports = mongoose.model('ApiCallLog', apiCallLogSchema);
