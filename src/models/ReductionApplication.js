const mongoose = require('mongoose');

const reductionApplicationSchema = new mongoose.Schema({
  applicationNo: {
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
  residentName: {
    type: String
  },
  applicantName: {
    type: String,
    required: true
  },
  applicantPhone: {
    type: String,
    required: true
  },
  feeIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PropertyFee',
    required: true
  }],
  reductionType: {
    type: String,
    enum: ['全额减免', '部分减免', '滞纳金减免', '分期缴纳'],
    required: true
  },
  totalAmount: {
    type: Number,
    required: true
  },
  reductionAmount: {
    type: Number,
    required: true
  },
  actualPayAmount: {
    type: Number,
    required: true
  },
  reductionReason: {
    type: String,
    required: true
  },
  reasonCategory: {
    type: String,
    enum: ['经济困难', '房屋质量问题', '物业服务问题', '其他特殊情况', '历史遗留问题']
  },
  supportingDocuments: [{
    name: String,
    url: String,
    uploadedAt: Date
  }],
  installmentPlan: {
    installmentCount: Number,
    firstPaymentAmount: Number,
    firstPaymentDate: Date,
    installments: [{
      period: Number,
      amount: Number,
      dueDate: Date
    }]
  },
  status: {
    type: String,
    enum: ['待提交', '待审批', '已批准', '已拒绝', '已撤回', '已完成'],
    default: '待提交',
    index: true
  },
  approvalWorkflow: [{
    level: Number,
    role: String,
    approver: String,
    action: { type: String, enum: ['批准', '拒绝', '转审'] },
    approvalRemark: String,
    approvalTime: Date
  }],
  currentApprovalLevel: {
    type: Number,
    default: 1
  },
  maxApprovalLevel: {
    type: Number,
    default: 2
  },
  finalApprover: {
    type: String
  },
  finalApprovalTime: {
    type: Date
  },
  finalApprovalRemark: {
    type: String
  },
  executionStatus: {
    type: String,
    enum: ['待执行', '执行中', '已执行', '执行失败'],
    index: true
  },
  executedAt: {
    type: Date
  },
  applicant: {
    type: String
  },
  applicationTime: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedBy: {
    type: String
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

reductionApplicationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

reductionApplicationSchema.index({ houseId: 1, applicationTime: -1 });
reductionApplicationSchema.index({ status: 1, applicationTime: -1 });

module.exports = mongoose.model('ReductionApplication', reductionApplicationSchema);
