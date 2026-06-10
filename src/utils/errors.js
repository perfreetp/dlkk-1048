class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(message, 404, 'NOT_FOUND');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = '未授权访问') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = '禁止访问') {
    super(message, 403, 'FORBIDDEN');
  }
}

class ConflictError extends AppError {
  constructor(message = '资源冲突') {
    super(message, 409, 'CONFLICT');
  }
}

class BusinessError extends AppError {
  constructor(message, code = 'BUSINESS_ERROR') {
    super(message, 400, code);
  }
}

const errorHandler = (err, req, res, next) => {
  const logger = require('./logger');
  
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || '服务器内部错误';
  
  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = err.message;
  }
  
  if (err.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_PARAMETER';
    message = '无效的参数格式';
  }
  
  if (err.code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE_KEY';
    message = '数据已存在，不能重复创建';
  }
  
  if (!err.isOperational) {
    logger.error('未处理的异常:', err);
    message = '服务器内部错误';
  }
  
  const response = {
    success: false,
    code,
    message,
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  };
  
  if (err.errors) {
    response.errors = err.errors;
  }
  
  if (process.env.NODE_ENV === 'development' && err.stack) {
    response.stack = err.stack;
  }
  
  res.status(statusCode).json(response);
};

const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`请求的路径 ${req.originalUrl} 不存在`);
  next(error);
};

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  BusinessError,
  errorHandler,
  notFoundHandler
};
