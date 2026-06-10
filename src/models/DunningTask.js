const mongoose = require('mongoose');

const dunningTaskSchema = new mongoose.Schema({
  taskNo: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  taskName: {
    type: String,
    required: true
  },
  taskType: {
    type: String,
    enum: ['手动', '自动', '批量'],
    default: '手动',
    index: true
  },
  dunningType: {
    type: String,
    enum: ['短信', '电话', '信函', '上门'],
    required: true,
    index: true
  },
  dunningStage: {
    type: String,
    enum: ['提醒期', '催告期', '严厉期', '法律期'],
    required: true,
    index: true
  },
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DunningTemplate',
    required: true
  },
  templateNo: {
    type: String
  },
  filters: {
    houseNos: [{ type: String }],
    buildings: [{ type: String }],
    units: [{ type: String }],
    residentIds: [{ type: mongoose.Schema.Types.ObjectId }],
    feeTypes: [{ type: String }],
    overdueLevels: [{ type: String }],
    minOverdueDays: Number,
    maxOverdueDays: Number,
    minArrearsAmount: Number,
    maxArrearsAmount: Number,
    excludeBlacklist: { type: Boolean, default: true },
    excludeComplaint: { type: Boolean, default: false },
    excludePromised: { type: Boolean, default: false },
    excludeRecentDunning: { type: Boolean, default: true }
  },
  items: [{
    houseId: { type: mongoose.Schema.Types.ObjectId, ref: 'House', required: true },
    houseNo: { type: String, required: true },
    residentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident' },
    residentName: { type: String },
    residentPhone: { type: String },
    feeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PropertyFee' }],
    totalArrears: { type: Number, required: true },
    overdueDays: { type: Number },
    overdueLevel: { type: String },
    status: {
      type: String,
      enum: ['待处理', '已发送', '已读', '已回复', '已承诺', '已关闭', '失败'],
      default: '待处理'
    },
    sentAt: Date,
    smsMsgId: String,
    callRecordId: String,
    responseContent: String,
    operator: String,
    remark: String
  }],
  totalCount: {
    type: Number,
    default: 0
  },
  successCount: {
    type: Number,
    default: 0
  },
  failedCount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['待执行', '执行中', '已完成', '已取消', '部分成功'],
    default: '待执行',
    index: true
  },
  scheduledAt: {
    type: Date,
    index: true
  },
  executedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  approvalStatus: {
    type: String,
    enum: ['无需审批', '待审批', '已批准', '已拒绝'],
    default: '无需审批',
    index: true
  },
  approver: {
    type: String
  },
  approvalRemark: {
    type: String
  },
  approvedAt: {
    type: Date
  },
  requiresApproval: {
    type: Boolean,
    default: false
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

dunningTaskSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

dunningTaskSchema.index({ createdBy: 1, createdAt: -1 });
dunningTaskSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('DunningTask', dunningTaskSchema);
