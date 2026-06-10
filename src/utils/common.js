const moment = require('moment');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const generateNo = (prefix) => {
  const dateStr = moment().format('YYYYMMDDHHmmss');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}${dateStr}${random}`;
};

const generateRequestId = () => {
  return uuidv4();
};

const calculateOverdueLevel = (overdueDays) => {
  const { overdueLevel1Days, overdueLevel2Days, overdueLevel3Days } = config.dunning;
  if (overdueDays >= overdueLevel3Days) return '三级';
  if (overdueDays >= overdueLevel2Days) return '二级';
  if (overdueDays >= overdueLevel1Days) return '一级';
  return '正常';
};

const calculateOverdueDays = (dueDate) => {
  const today = moment().startOf('day');
  const due = moment(dueDate).startOf('day');
  const days = today.diff(due, 'days');
  return days > 0 ? days : 0;
};

const calculateDunningStage = (overdueDays) => {
  if (overdueDays >= 365) return '法律期';
  if (overdueDays >= 180) return '严厉期';
  if (overdueDays >= 90) return '催告期';
  return '提醒期';
};

const formatCurrency = (amount) => {
  return Number(amount || 0).toFixed(2);
};

const maskPhone = (phone) => {
  if (!phone || phone.length < 7) return phone;
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
};

const maskIdCard = (idCard) => {
  if (!idCard || idCard.length < 8) return idCard;
  return idCard.replace(/(\d{6})\d{8,11}(\d{3}[\dXx])/, '$1********$2');
};

const parsePageParams = (query) => {
  const page = parseInt(query.page) || 1;
  const pageSize = parseInt(query.pageSize) || 20;
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
};

const buildPaginationResult = (data, total, page, pageSize) => {
  return {
    list: data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  };
};

const buildSortParams = (sortBy, sortOrder = 'desc') => {
  if (!sortBy) return { createdAt: -1 };
  return { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
};

const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

const getObjectDiff = (oldObj, newObj, excludeFields = []) => {
  const changes = [];
  const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);
  
  for (const key of allKeys) {
    if (excludeFields.includes(key)) continue;
    const oldVal = oldObj ? oldObj[key] : undefined;
    const newVal = newObj ? newObj[key] : undefined;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({
        field: key,
        oldValue: oldVal,
        newValue: newVal
      });
    }
  }
  return changes;
};

module.exports = {
  generateNo,
  generateRequestId,
  calculateOverdueLevel,
  calculateOverdueDays,
  calculateDunningStage,
  formatCurrency,
  maskPhone,
  maskIdCard,
  parsePageParams,
  buildPaginationResult,
  buildSortParams,
  deepClone,
  getObjectDiff
};
