const mongoose = require('mongoose');

const operationLogSchema = new mongoose.Schema({
  logNo: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  operator: {
    type: String,
    required: true,
    index: true
  },
  operationType: {
    type: String,
    enum: ['创建', '修改', '删除', '查询', '导出', '审批', '发送', '同步', '其他'],
    required: true,
    index: true
  },
  operationModule: {
    type: String,
    enum: ['住户管理', '房屋管理', '费用管理', '催缴任务', '模板管理', '发送队列', '回执登记', '付款同步', '减免申请', '统计分析', '系统管理'],
    required: true
  },
  targetType: {
    type: String
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId
  },
  targetNo: {
    type: String,
    index: true
  },
  operationContent: {
    type: String,
    required: true
  },
  beforeData: {
    type: mongoose.Schema.Types.Mixed
  },
  afterData: {
    type: mongoose.Schema.Types.Mixed
  },
  changeFields: [{
    field: String,
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed
  }],
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  operationResult: {
    type: String,
    enum: ['成功', '失败'],
    required: true
  },
  errorMessage: {
    type: String
  },
  operationTime: {
    type: Date,
    default: Date.now,
    index: true
  },
  remark: {
    type: String
  }
});

operationLogSchema.index({ operator: 1, operationTime: -1 });
operationLogSchema.index({ operationModule: 1, operationTime: -1 });
operationLogSchema.index({ targetNo: 1, operationTime: -1 });

module.exports = mongoose.model('OperationLog', operationLogSchema);
