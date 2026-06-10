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

const securityMiddleware = [
  helmet(),
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: ['X-Request-Id']
  }),
  apiLimiter
];

const requestIdMiddleware = (req, res, next) => {
  req.requestId = generateRequestId();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

const requestLoggerMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  logger.info({
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    params: req.params,
    query: req.query
  });
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info({
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });
  
  next();
};

const callerIdentifyMiddleware = (req, res, next) => {
  const callerHeader = req.get('X-Caller');
  const apiNameHeader = req.get('X-Api-Name');
  
  req.caller = callerHeader || '其他';
  req.apiName = apiNameHeader || `${req.method} ${req.path}`;
  
  next();
};

const bodyParserMiddleware = (req, res, next) => {
  const express = require('express');
  express.json({ limit: '10mb' })(req, res, (err) => {
    if (err) {
      const { AppError } = require('../utils/errors');
      return next(new AppError('请求体解析失败，请检查JSON格式', 400, 'INVALID_JSON'));
    }
    express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
  });
};

const apiCallLogMiddleware = async (req, res, next) => {
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
        caller: req.caller,
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
  
  next();
};

const responseWrapperMiddleware = (req, res, next) => {
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

module.exports = {
  securityMiddleware,
  requestIdMiddleware,
  requestLoggerMiddleware,
  callerIdentifyMiddleware,
  bodyParserMiddleware,
  apiCallLogMiddleware,
  responseWrapperMiddleware,
  logOperation
};
