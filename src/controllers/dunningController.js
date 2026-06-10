const dunningService = require('../services/dunningService');
const { BusinessError } = require('../utils/errors');

const getTemplates = async (req, res, next) => {
  try {
    const result = await dunningService.getTemplates(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getTemplateById = async (req, res, next) => {
  try {
    const { templateId } = req.params;
    const result = await dunningService.getTemplateById(templateId);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const selectTemplate = async (req, res, next) => {
  try {
    const { dunningType, dunningStage, overdueLevel } = req.body;
    if (!dunningType || !dunningStage) {
      throw new BusinessError('催缴类型和催缴阶段不能为空');
    }
    const result = await dunningService.selectTemplate(dunningType, dunningStage, overdueLevel);
    res.success(result, '模板选择成功');
  } catch (error) {
    next(error);
  }
};

const createDunningTask = async (req, res, next) => {
  try {
    const operator = req.get('X-Operator') || 'system';
    const result = await dunningService.createDunningTask(req.body, operator);
    res.success(result, '催缴任务创建成功');
  } catch (error) {
    next(error);
  }
};

const getDunningTasks = async (req, res, next) => {
  try {
    const result = await dunningService.getDunningTasks(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getDunningTaskDetail = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const result = await dunningService.getDunningTaskDetail(taskId);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const executeDunningTask = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const operator = req.get('X-Operator') || 'system';
    const result = await dunningService.executeDunningTask(taskId, operator);
    res.success(result, '催缴任务执行成功');
  } catch (error) {
    next(error);
  }
};

const batchGenerateReminders = async (req, res, next) => {
  try {
    const { filters, dunningType } = req.body;
    const operator = req.get('X-Operator') || 'system';
    
    if (!dunningType) {
      throw new BusinessError('催缴类型不能为空');
    }
    
    const result = await dunningService.batchGenerateReminders(filters, dunningType, operator);
    res.success(result, '批量生成提醒成功');
  } catch (error) {
    next(error);
  }
};

const getMessageQueue = async (req, res, next) => {
  try {
    const result = await dunningService.getMessageQueue(req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const getHouseDunningHistory = async (req, res, next) => {
  try {
    const { houseNo } = req.params;
    if (!houseNo) {
      throw new BusinessError('房号不能为空');
    }
    const result = await dunningService.getHouseDunningHistory(houseNo, req.query);
    res.success(result, '查询成功');
  } catch (error) {
    next(error);
  }
};

const checkDunningEligibility = async (req, res, next) => {
  try {
    const { houseId } = req.params;
    const result = await dunningService.checkDunningEligibility(houseId, req.query);
    res.success(result, '检查完成');
  } catch (error) {
    next(error);
  }
};

const cancelDunningTask = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const operator = req.get('X-Operator') || 'system';
    const result = await dunningService.cancelDunningTask(taskId, operator);
    res.success(result, '催缴任务取消成功');
  } catch (error) {
    next(error);
  }
};

const renderTemplate = async (req, res, next) => {
  try {
    const { templateId, data } = req.body;
    const template = await dunningService.getTemplateById(templateId);
    const result = dunningService.renderTemplate(template, data);
    res.success(result, '模板渲染成功');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTemplates,
  getTemplateById,
  selectTemplate,
  createDunningTask,
  getDunningTasks,
  getDunningTaskDetail,
  executeDunningTask,
  batchGenerateReminders,
  getMessageQueue,
  getHouseDunningHistory,
  checkDunningEligibility,
  cancelDunningTask,
  renderTemplate
};
