const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const config = require('../config');
const { generateRequestId } = require('../utils/common');
const logger = require('../utils/logger');
const ApiCallLog = require('../models/ApiCallLog');
const OperationLog = require('../models/OperationLog');

const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: '请求频率过高，请稍后再试'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const security = (req, res, next) => {
  helmet()(req, res, (err) => {
    if (err) return next(err);
    cors({
      origin: true,
      credentials: true,
      exposedHeaders: ['X-Request-Id']
    })(req, res, next);
  });
};

const rateLimiter = apiLimiter;

const VALID_CALLERS = ['收费系统', '短信平台', '客服工具', '管理后台', '其他'];

const CALLER_MAP = {
  'fee-system': '收费系统',
  'feesystem': '收费系统',
  'billing': '收费系统',
  'sms-platform': '短信平台',
  'smsplatform': '短信平台',
  'sms': '短信平台',
  'customer-service': '客服工具',
  'customerservice': '客服工具',
  'cs': '客服工具',
  'admin': '管理后台',
  'admin-console': '管理后台',
  'test': '其他',
  'testscript': '其他',
  'TestScript': '其他',
  'other': '其他'
};

function normalizeCaller(caller) {
  if (!caller) return '其他';
  if (VALID_CALLERS.includes(caller)) return caller;
  const lower = caller.toLowerCase().replace(/[-_\s]/g, '');
  if (CALLER_MAP[lower]) return CALLER_MAP[lower];
  if (CALLER_MAP[caller]) return CALLER_MAP[caller];
  return '其他';
}

const requestId = (req, res, next) => {
  req.requestId = generateRequestId();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

const callerIdentify = (req, res, next) => {
  const callerHeader = req.get('X-Caller');
  const apiNameHeader = req.get('X-Api-Name');

  req.caller = normalizeCaller(callerHeader);
  req.apiName = apiNameHeader || `${req.method} ${req.path}`;

  next();
};

const apiLogger = async (req, res, next) => {
  const startTime = new Date();
  const originalSend = res.send;
  let responseData = null;

  res.send = function(body) {
    try {
      responseData = typeof body === 'string' ? JSON.parse(body) : body;
    } catch (e) {
      responseData = body;
    }
    return originalSend.call(this, body);
  };

  res.on('finish', async () => {
    try {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      const { generateNo } = require('../utils/common');

      let relatedHouseNo = null;
      if (req.body && req.body.houseNo) relatedHouseNo = req.body.houseNo;
      if (req.query && req.query.houseNo) relatedHouseNo = req.query.houseNo;
      if (req.params && req.params.houseNo) relatedHouseNo = req.params.houseNo;

      let relatedTaskNo = null;
      if (req.body && req.body.taskNo) relatedTaskNo = req.body.taskNo;
      if (req.query && req.query.taskNo) relatedTaskNo = req.query.taskNo;
      if (req.params && req.params.taskNo) relatedTaskNo = req.params.taskNo;

      const apiCallLog = new ApiCallLog({
        callNo: generateNo('API'),
        requestId: req.requestId,
        caller: normalizeCaller(req.caller),
        apiName: req.apiName,
        httpMethod: req.method,
        httpPath: req.originalUrl,
        requestParams: req.query,
        requestBody: req.body,
        requestHeaders: {
          'Content-Type': req.get('Content-Type'),
          'X-Caller': req.caller
        },
        responseStatus: res.statusCode,
        responseCode: responseData ? responseData.code : null,
        responseMessage: responseData ? responseData.message : null,
        callStartTime: startTime,
        callEndTime: endTime,
        duration,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        success: res.statusCode >= 200 && res.statusCode < 400,
        errorMessage: responseData && !responseData.success ? responseData.message : null,
        relatedTaskNo,
        relatedHouseNo
      });

      await apiCallLog.save();
    } catch (error) {
      logger.error('保存API调用日志失败:', error);
    }
  });

  logger.info({
    requestId: req.requestId,
    caller: req.caller,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  });

  next();
};

const responseWrapper = (req, res, next) => {
  res.success = (data = null, message = '操作成功') => {
    res.json({
      success: true,
      code: 'SUCCESS',
      message,
      data,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  };

  res.fail = (message = '操作失败', code = 'FAIL', statusCode = 400) => {
    res.status(statusCode).json({
      success: false,
      code,
      message,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  };

  next();
};

const logOperation = async (options) => {
  try {
    const { generateNo } = require('../utils/common');
    const log = new OperationLog({
      logNo: generateNo('LOG'),
      ...options
    });
    await log.save();
  } catch (error) {
    logger.error('保存操作日志失败:', error);
  }
};

const operationLogger = (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'OPTIONS' && req.method !== 'HEAD') {
    req.logOperation = async (entityType, entityId, action, beforeData, afterData, operator) => {
      const { getObjectDiff } = require('../utils/common');
      const changedFields = getObjectDiff(beforeData || {}, afterData || {});

      await logOperation({
        entityType,
        entityId,
        action,
        operator: operator || req.get('X-Operator') || 'system',
        beforeData,
        afterData,
        changedFields,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    };
  }
  next();
};

module.exports = {
  security,
  rateLimiter,
  requestId,
  callerIdentify,
  apiLogger,
  responseWrapper,
  operationLogger,
  logOperation
};
