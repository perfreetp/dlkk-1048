const express = require('express');
const config = require('./config');
const connectDB = require('./config/database');
const logger = require('./utils/logger');
const middleware = require('./middleware');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./utils/errors');

const app = express();

app.use(middleware.requestId);
app.use(middleware.callerIdentify);
app.use(middleware.security);
app.use(middleware.rateLimiter);
app.use(middleware.responseWrapper);
app.use(middleware.operationLogger);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(middleware.apiLogger);

app.use('/api/v1', routes);

app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async () => {
  try {
    await connectDB();

    const PORT = config.server.port || 3000;

    const server = app.listen(PORT, () => {
      logger.info(`========================================`);
      logger.info(`🚀 物业费催缴服务启动成功`);
      logger.info(`========================================`);
      logger.info(`📍 服务地址: http://localhost:${PORT}`);
      logger.info(`📡 API前缀:  http://localhost:${PORT}/api/v1`);
      logger.info(`💾 数据库:   ${config.database.url}`);
      logger.info(`⚙️  运行环境: ${config.server.env}`);
      logger.info(`========================================`);
    });

    const gracefulShutdown = (signal) => {
      logger.info(`收到 ${signal} 信号，开始优雅关闭服务...`);
      server.close(() => {
        logger.info('HTTP服务已关闭');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('强制关闭服务');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;
  } catch (error) {
    logger.error('服务启动失败:', error);
    throw error;
  }
};

process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝:', reason);
  process.exit(1);
});

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
