require('dotenv').config();
const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');

async function main() {
  const mode = process.argv[2] || 'server';

  console.log('🚀 启动内存 MongoDB...');
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

  console.log(`✅ 内存 MongoDB 已启动: ${uri}${dbName}`);
  console.log(`   数据目录: ${mongod.instanceInfo.dbPath}`);

  if (mode === 'init') {
    console.log('\n📥 执行数据初始化脚本...');
    const { initAll } = require('./initData');
    try {
      const result = await initAll();
      console.log('\n✅ 数据初始化完成');
      console.log('   按 Ctrl+C 停止内存 MongoDB');
      process.exit(0);
    } catch (e) {
      console.error('❌ 数据初始化失败:', e.message);
      console.error(e.stack);
      process.exit(1);
    }
  } else if (mode === 'server') {
    console.log('\n🌐 启动 Express 服务...');
    const { startServer } = require(path.join(__dirname, '..', 'app'));
    try {
      const server = await startServer();
      const port = server.address().port;
      console.log(`\n✅ 服务已启动: http://localhost:${port}`);
      console.log(`   健康检查: http://localhost:${port}/api/v1/health`);
      console.log('   按 Ctrl+C 停止服务');

      process.on('SIGINT', async () => {
        console.log('\n🛑 正在停止服务...');
        try { server.close(); } catch (e) {}
        try { await mongod.stop(); } catch (e) {}
        process.exit(0);
      });
    } catch (e) {
      console.error('❌ 服务启动失败:', e.message);
      console.error(e.stack);
      try { await mongod.stop(); } catch (err) {}
      process.exit(1);
    }
  } else if (mode === 'both') {
    console.log('\n📥 先执行数据初始化...');
    const { initAll } = require('./initData');
    try {
      await initAll();
      console.log('\n✅ 数据初始化完成');
    } catch (e) {
      console.error('❌ 数据初始化失败:', e.message);
      console.error(e.stack);
      try { await mongod.stop(); } catch (err) {}
      process.exit(1);
    }

    console.log('\n🌐 启动 Express 服务...');
    const { startServer } = require(path.join(__dirname, '..', 'app'));
    try {
      const server = await startServer();
      const port = server.address().port;
      console.log(`\n✅ 服务已启动: http://localhost:${port}`);
      console.log(`   健康检查: http://localhost:${port}/api/v1/health`);
      console.log('   现在可以新开一个终端运行: npm run verify');
      console.log('   按 Ctrl+C 停止服务');

      process.on('SIGINT', async () => {
        console.log('\n🛑 正在停止服务...');
        try { server.close(); } catch (e) {}
        try { await mongod.stop(); } catch (e) {}
        process.exit(0);
      });
    } catch (e) {
      console.error('❌ 服务启动失败:', e.message);
      console.error(e.stack);
      try { await mongod.stop(); } catch (err) {}
      process.exit(1);
    }
  } else {
    console.error(`未知模式: ${mode}`);
    console.log('用法: node startWithMongo.js [server|init|both]');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('启动失败:', e);
  process.exit(1);
});
