const mongoose = require('mongoose');

const dunningTemplateSchema = new mongoose.Schema({
  templateNo: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  templateName: {
    type: String,
    required: true
  },
  templateType: {
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
  overdueLevel: {
    type: String,
    enum: ['正常', '一级', '二级', '三级'],
    index: true
  },
  title: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  variables: [{
    name: String,
    description: String,
    required: Boolean
  }],
  isEnabled: {
    type: Boolean,
    default: true,
    index: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  priority: {
    type: Number,
    default: 0
  },
  usageCount: {
    type: Number,
    default: 0
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

dunningTemplateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

dunningTemplateSchema.index({ templateType: 1, dunningStage: 1, isEnabled: 1 });

module.exports = mongoose.model('DunningTemplate', dunningTemplateSchema);
