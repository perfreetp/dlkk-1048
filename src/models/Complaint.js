const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  complaintNo: {
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
  complainantName: {
    type: String,
    required: true
  },
  complainantPhone: {
    type: String,
    required: true
  },
  complaintType: {
    type: String,
    enum: ['服务态度', '收费问题', '物业服务', '房屋质量', '邻里纠纷', '其他'],
    required: true
  },
  complaintContent: {
    type: String,
    required: true
  },
  complaintTime: {
    type: Date,
    required: true,
    index: true
  },
  complaintChannel: {
    type: String,
    enum: ['电话', '上门', '短信', '微信', '其他']
  },
  isDunningRelated: {
    type: Boolean,
    default: false
  },
  dunningTaskIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DunningTask'
  }],
  status: {
    type: String,
    enum: ['待处理', '处理中', '已解决', '已关闭'],
    default: '待处理',
    index: true
  },
  handler: {
    type: String
  },
  handleRemark: {
    type: String
  },
  handleTime: {
    type: Date
  },
  satisfaction: {
    type: String,
    enum: ['非常满意', '满意', '一般', '不满意', '非常不满意']
  },
  feedback: {
    type: String
  },
  excludeFromDunning: {
    type: Boolean,
    default: false
  },
  excludeReason: {
    type: String
  },
  excludeEndTime: {
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

complaintSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

complaintSchema.index({ houseId: 1, complaintTime: -1 });
complaintSchema.index({ residentId: 1, complaintTime: -1 });

module.exports = mongoose.model('Complaint', complaintSchema);
