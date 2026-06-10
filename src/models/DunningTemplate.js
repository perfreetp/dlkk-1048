const mongoose = require('mongoose');
const { generateNo } = require('../utils/common');

function normalizeVariables(vars) {
  if (!vars) return vars;
  return vars.map(v => {
    if (typeof v === 'string') {
      return { name: v, description: v, required: true };
    }
    if (typeof v === 'object' && v !== null) {
      return {
        name: v.name || '',
        description: v.description || v.name || '',
        required: v.required !== undefined ? v.required : true
      };
    }
    return v;
  });
}

const dunningTemplateSchema = new mongoose.Schema({
  templateNo: {
    type: String,
    unique: true,
    index: true
  },
  templateCode: {
    type: String,
    unique: true,
    index: true
  },
  templateName: {
    type: String,
    required: true
  },
  templateType: {
    type: String,
    enum: ['短信', '电话', '信函', '上门']
  },
  channel: {
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
    default: '正常',
    index: true
  },
  title: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    required: true
  },
  variables: {
    type: [{
      name: String,
      description: String,
      required: Boolean
    }],
    set: normalizeVariables
  },
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

dunningTemplateSchema.pre('save', function (next) {
  if (!this.templateNo) {
    this.templateNo = generateNo('TPL');
  }
  if (!this.templateType && this.channel) {
    this.templateType = this.channel;
  }
  if (!this.channel && this.templateType) {
    this.channel = this.templateType;
  }
  if (!this.title) {
    this.title = this.templateName;
  }
  this.updatedAt = Date.now();
  next();
});

dunningTemplateSchema.index({ channel: 1, dunningStage: 1, isEnabled: 1 });
dunningTemplateSchema.index({ templateType: 1, dunningStage: 1, isEnabled: 1 });

module.exports = mongoose.model('DunningTemplate', dunningTemplateSchema);
