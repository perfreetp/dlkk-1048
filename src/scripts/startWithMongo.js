require('dotenv').config();
const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(color, msg) {
  console.log(`${color}${msg}${COLORS.reset}`);
}

async function main() {
  const mode = process.argv[2] || 'both';

  log(COLORS.bold + COLORS.cyan, '\n╔════════════════════════════════════════════╗');
  log(COLORS.bold + COLORS.cyan, '║     物业费催缴服务 - 启动中              ║');
  log(COLORS.bold + COLORS.cyan, '╚════════════════════════════════════════════╝\n');

  log(COLORS.blue, '🚀 启动内存 MongoDB...');
  const mongod = await MongoMemoryServer.create({
    instance: {
      port: 27017,
      dbName: 'property_fee_dunning'
    }
  });

  const uri = mongod.getUri();
  const dbName = mongod.instanceInfo.dbName;
  process.env.DATABASE_URL = uri;
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URL = uri;

  log(COLORS.green, `  ✅ 内存 MongoDB 已启动: ${uri}${dbName}`);
  log(COLORS.yellow, `  ⚠️  注意：内存数据库重启后数据会丢失，仅供测试体验`);

  if (mode === 'init') {
    log(COLORS.blue, '\n📥 执行数据初始化...');
    const { initAll } = require('./initData');
    try {
      await initAll();
      log(COLORS.green, '\n✅ 数据初始化完成');
      log(COLORS.yellow, '   💡 提示：内存数据库无法持久化，请使用 npm run init:db 配合本地 MongoDB 使用');
      process.exit(0);
    } catch (e) {
      log(COLORS.red, `❌ 数据初始化失败: ${e.message}`);
      console.error(e.stack);
      process.exit(1);
    }
  } else if (mode === 'server') {
    log(COLORS.blue, '\n🌐 启动 Express 服务...');
    const { startServer } = require(path.join(__dirname, '..', 'app'));
    try {
      const server = await startServer();
      const port = server.address().port;
      printServerInfo(port);

      process.on('SIGINT', async () => shutdown(mongod, server));
      process.on('SIGTERM', async () => shutdown(mongod, server));
    } catch (e) {
      log(COLORS.red, `❌ 服务启动失败: ${e.message}`);
      console.error(e.stack);
      try { await mongod.stop(); } catch (err) {}
      process.exit(1);
    }
  } else if (mode === 'both') {
    log(COLORS.blue, '\n📥 初始化测试数据...');
    const { initAll } = require('./initData');
    try {
      await initAll();
      log(COLORS.green, '  ✅ 数据初始化完成');
    } catch (e) {
      log(COLORS.red, `❌ 数据初始化失败: ${e.message}`);
      console.error(e.stack);
      try { await mongod.stop(); } catch (err) {}
      process.exit(1);
    }

    log(COLORS.blue, '\n🌐 启动 Express 服务...');
    const { startServer } = require(path.join(__dirname, '..', 'app'));
    try {
      const server = await startServer();
      const port = server.address().port;
      printServerInfo(port);

      process.on('SIGINT', async () => shutdown(mongod, server));
      process.on('SIGTERM', async () => shutdown(mongod, server));
    } catch (e) {
      log(COLORS.red, `❌ 服务启动失败: ${e.message}`);
      console.error(e.stack);
      try { await mongod.stop(); } catch (err) {}
      process.exit(1);
    }
  } else {
    log(COLORS.red, `❌ 未知模式: ${mode}`);
    console.log('');
    console.log('用法: node startWithMongo.js [模式]');
    console.log('');
    console.log('模式:');
    console.log('  both   (默认)  初始化数据 + 启动服务（开箱即用）');
    console.log('  server         仅启动服务（不初始化数据）');
    console.log('  init           仅初始化数据（仅验证数据导入）');
    console.log('');
    console.log('其他命令:');
    console.log('  npm run start:db   使用本地 MongoDB 启动服务');
    console.log('  npm run init:db    给本地 MongoDB 初始化数据');
    console.log('  npm run verify     验证运行中的服务 API');
    console.log('  npm test           一键端到端测试');
    console.log('');
    process.exit(1);
  }
}

function printServerInfo(port) {
  log(COLORS.bold + COLORS.green, '\n╔════════════════════════════════════════════╗');
  log(COLORS.bold + COLORS.green, '║        🎉 服务启动成功！                  ║');
  log(COLORS.bold + COLORS.green, '╚════════════════════════════════════════════╝\n');
  log(COLORS.cyan, `  🌐 服务地址:   http://localhost:${port}`);
  log(COLORS.cyan, `  💓 健康检查:   http://localhost:${port}/api/v1/health`);
  log(COLORS.cyan, `  📚 API 前缀:   http://localhost:${port}/api/v1`);
  log(COLORS.cyan, `  📖 API 文档:   见 routes 目录下的路由定义`);
  console.log('');
  log(COLORS.yellow, '  💡 快速体验：');
  log(COLORS.yellow, '     新开一个终端执行: npm run verify');
  log(COLORS.yellow, '     可验证健康检查、欠费查询、模板选择、创建任务、付款同步等');
  console.log('');
  log(COLORS.bold + COLORS.cyan, '  ⏹️  按 Ctrl+C 停止服务');
  console.log('');
}

async function shutdown(mongod, server) {
  console.log('');
  log(COLORS.yellow, '🛑 正在停止服务...');
  try { if (server) server.close(); } catch (e) {}
  try { if (mongod) await mongod.stop(); } catch (e) {}
  log(COLORS.green, '✅ 服务已停止');
  process.exit(0);
}

main().catch(e => {
  log(COLORS.red, `❌ 启动失败: ${e.message}`);
  console.error(e);
  process.exit(1);
});
