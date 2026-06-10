require('dotenv').config();
const { MongoMemoryServer } = require('mongodb-memory-server');
const http = require('http');

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

let testHouseNo = null;
let testFeeIds = [];
let testTaskId = null;
let testTemplateId = null;
let BASE_PORT = 3000;
let mongod = null;
let server = null;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: BASE_PORT,
      path: `/api/v1${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Caller': 'FeeSystem',
        'X-Operator': 'tester',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cleanupAndExit(code) {
  try { if (server) server.close(); } catch (e) {}
  try { if (mongod) await mongod.stop(); } catch (e) {}
  process.exit(code);
}

process.on('uncaughtException', (e) => {
  console.error('uncaughtException:', e);
  cleanupAndExit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('unhandledRejection:', e);
  cleanupAndExit(1);
});

async function main() {
  log(COLORS.bold + COLORS.cyan, '\n╔══════════════════════════════════════════════════╗');
  log(COLORS.bold + COLORS.cyan, '║     物业费催缴服务 全链路端到端验证           ║');
  log(COLORS.bold + COLORS.cyan, '╚══════════════════════════════════════════════════╝\n');

  // 1. 启动内存 MongoDB
  log(COLORS.blue, '【步骤1】启动内存 MongoDB...');
  mongod = await MongoMemoryServer.create({
    instance: { port: 27017, dbName: 'property_fee_dunning' }
  });
  const uri = mongod.getUri();
  process.env.DATABASE_URL = uri;
  log(COLORS.green, `  ✅ MongoDB: ${uri}`);

  // 2. 初始化数据
  log(COLORS.blue, '\n【步骤2】初始化测试数据...');
  const { initAll } = require('./initData');
  await initAll();
  log(COLORS.green, '  ✅ 数据初始化完成');

  // 3. 启动 Express 服务
  log(COLORS.blue, '\n【步骤3】启动 Express 服务...');
  const appModule = require('../app');
  const startServer = appModule.startServer;
  if (!startServer) {
    throw new Error('startServer not exported from app.js');
  }
  server = await startServer();
  BASE_PORT = server.address().port;
  await wait(1500);
  log(COLORS.green, `  ✅ 服务已启动: http://localhost:${BASE_PORT}`);

  // 4. 开始 API 验证
  let passed = 0;
  let failed = 0;
  const failures = [];

  function assert(name, condition, detail = '') {
    if (condition) {
      passed++;
      log(COLORS.green, `  ✅ ${name}`);
    } else {
      failed++;
      failures.push({ name, detail });
      log(COLORS.red, `  ❌ ${name}`);
      if (detail) log(COLORS.yellow, `     ${detail}`);
    }
  }

  // ===== 4.1 Health Check =====
  log(COLORS.bold + COLORS.blue, '\n【4.1/6】服务健康检查');
  try {
    const res = await request('GET', '/health');
    assert('响应状态 200', res.status === 200, `实际: ${res.status}`);
    assert('success=true', res.body && res.body.success === true);
    assert('data.status=ok', res.body && res.body.data && res.body.data.status === 'ok');
    log(COLORS.cyan, `    requestId: ${res.body && res.body.requestId}`);
  } catch (e) {
    assert('服务可访问', false, e.message);
  }

  // ===== 4.2 欠费查询 =====
  log(COLORS.bold + COLORS.blue, '\n【4.2/6】欠费查询 & 房号检索');
  try {
    const res = await request('GET', '/arrears/query?pageSize=5&isOverdue=true');
    assert('欠费列表查询成功', res.status === 200 && res.body.success, `状态: ${res.status}, 消息: ${res.body && res.body.message}`);
    const list = res.body && res.body.data && res.body.data.list;
    assert('欠费记录 > 0', list && list.length > 0, `实际: ${list ? list.length : 0}`);
    if (list && list.length > 0) {
      const fee = list[0];
      testHouseNo = fee.houseNo || (fee.house && fee.house.houseNo);
      log(COLORS.cyan, `    测试房号: ${testHouseNo}`);
      log(COLORS.cyan, `    欠费金额: ¥${fee.unpaidAmount}`);
      log(COLORS.cyan, `    逾期等级: ${fee.overdueLevel} / ${fee.overdueDays}天`);
    }
  } catch (e) {
    assert('欠费查询', false, e.message);
  }

  if (testHouseNo) {
    try {
      const res = await request('GET', `/arrears/house/${encodeURIComponent(testHouseNo)}`);
      assert('房屋欠费详情成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
      const d = res.body && res.body.data;
      assert('包含 summary 字段', d && d.summary);
      if (d && d.arrearsFees) {
        testFeeIds = d.arrearsFees.slice(0, 2).map(f => f._id);
        log(COLORS.cyan, `    欠费笔数: ${d.arrearsFees.length}, 总额: ¥${d.summary && d.summary.totalArrears}`);
      }
    } catch (e) {
      assert('房屋欠费详情', false, e.message);
    }

    try {
      const res = await request('GET', `/resident/search/${encodeURIComponent(testHouseNo)}?pageSize=5`);
      assert('房号检索成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
      const list = res.body && res.body.data && res.body.data.list;
      assert('检索结果 > 0', list && list.length > 0);
      if (list && list.length > 0) {
        const r = list[0];
        const name = r.resident ? r.resident.name : (r.house && r.house.ownerName);
        log(COLORS.cyan, `    业主姓名: ${name}`);
      }
    } catch (e) {
      assert('房号检索', false, e.message);
    }
  }

  // ===== 4.3 模板查询 =====
  log(COLORS.bold + COLORS.blue, '\n【4.3/6】催缴模板查询');
  try {
    const res = await request('GET', '/dunning/templates?pageSize=20');
    assert('模板列表成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
    const list = res.body && res.body.data && res.body.data.list;
    assert('模板数量 > 0', list && list.length > 0, `实际: ${list ? list.length : 0}`);
    if (list && list.length > 0) {
      testTemplateId = list[0]._id;
      log(COLORS.cyan, `    可用模板: ${list.map(t => t.templateName).join(', ')}`);
      log(COLORS.cyan, `    选中模板ID: ${testTemplateId}`);
      assert('模板字段完整', list[0].content && list[0].variables && list[0].variables.length > 0);
    }
  } catch (e) {
    assert('模板查询', false, e.message);
  }

  // ===== 4.4 创建催缴任务 =====
  log(COLORS.bold + COLORS.blue, '\n【4.4/6】创建催缴任务 & 批量生成提醒');
  try {
    const createBody = {
      taskName: `测试催缴任务-${Date.now()}`,
      taskType: '手动',
      dunningType: '短信',
      dunningStage: '提醒期',
      templateId: testTemplateId,
      filters: {
        minOverdueDays: 1,
        excludeRecentDunning: false,
        excludeBlacklist: false
      }
    };
    const res = await request('POST', '/dunning/tasks', createBody);
    assert('催缴任务创建成功', res.status === 200 && res.body.success, `状态: ${res.status}, 消息: ${res.body && res.body.message}`);
    const d = res.body && res.body.data;
    assert('matchedCount > 0', d && d.matchedCount > 0, `实际: ${d && d.matchedCount}`);
    if (d && d.task) {
      testTaskId = d.task._id;
      log(COLORS.cyan, `    任务ID: ${testTaskId}`);
      log(COLORS.cyan, `    任务编号: ${d.task.taskNo}`);
      log(COLORS.cyan, `    匹配户数: ${d.matchedCount}`);
    }
  } catch (e) {
    assert('创建催缴任务', false, e.message);
  }

  // 批量生成提醒
  try {
    const res = await request('POST', '/dunning/batch-generate', {
      dunningType: '短信',
      filters: { excludeRecentDunning: false, excludeBlacklist: false }
    });
    assert('批量生成提醒成功', res.status === 200 && res.body.success, `状态: ${res.status}, 消息: ${res.body && res.body.message}`);
    const results = res.body && res.body.data;
    assert('返回分阶段结果', Array.isArray(results), `类型: ${typeof results}`);
    if (Array.isArray(results)) {
      const total = results.reduce((s, r) => s + (r.matchedCount || 0), 0);
      log(COLORS.cyan, `    分阶段结果: ${results.map(r => `${r.stage}:${r.matchedCount || 0}户`).join(', ')}`);
      log(COLORS.cyan, `    总计匹配: ${total} 户`);
      if (!testTaskId && results.length > 0 && results[0].taskId) {
        testTaskId = results[0].taskId;
      }
      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        log(COLORS.yellow, `    ⚠️ 部分阶段错误: ${errors.map(e => e.stage + ':' + e.error).join(', ')}`);
      }
    }
  } catch (e) {
    assert('批量生成提醒', false, e.message);
  }

  // ===== 4.5 执行催缴任务 & 发送队列 =====
  log(COLORS.bold + COLORS.blue, '\n【4.5/6】执行催缴任务 & 发送队列');
  if (testTaskId) {
    try {
      const res = await request('POST', `/dunning/tasks/${testTaskId}/execute`);
      assert('任务执行成功', res.status === 200 && res.body.success, `状态: ${res.status}, 消息: ${res.body && res.body.message}`);
      const d = res.body && res.body.data;
      assert('发送成功数 > 0 或入队 > 0', d && (d.successCount > 0 || d.queueCount > 0),
        `成功: ${d && d.successCount}, 队列: ${d && d.queueCount}`);
      log(COLORS.cyan, `    成功: ${d && d.successCount}, 失败: ${d && d.failedCount}, 入队: ${d && d.queueCount}`);
    } catch (e) {
      assert('执行任务', false, e.message);
    }
  }

  try {
    const res = await request('GET', '/dunning/queue?pageSize=10');
    assert('发送队列查询成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
    const list = res.body && res.body.data && res.body.data.list;
    if (list) {
      assert('队列包含记录', list.length > 0, `实际: ${list.length}`);
      log(COLORS.cyan, `    队列消息: ${list.length} 条`);
      if (list.length > 0) {
        log(COLORS.cyan, `    第一条: ${list[0].houseNo} - ${list[0].content && list[0].content.substring(0, 30)}...`);
        log(COLORS.cyan, `    状态: ${list[0].status}`);
      }
    }
  } catch (e) {
    assert('发送队列查询', false, e.message);
  }

  // ===== 4.6 付款同步 =====
  log(COLORS.bold + COLORS.blue, '\n【4.6/6】付款同步');
  if (testHouseNo && testFeeIds.length > 0) {
    try {
      const syncBody = {
        sourceOrderNo: `TEST-PAY-${Date.now()}`,
        syncSource: '收费系统',
        houseNo: testHouseNo,
        feeIds: testFeeIds,
        paymentMethod: '微信支付',
        totalAmount: 100,
        paidAmount: 50,
        lateFee: 0,
        discountAmount: 0,
        paymentDate: new Date().toISOString(),
        payerName: '测试业主',
        remark: 'API验证测试付款'
      };
      const res = await request('POST', '/receipt/payment/sync', syncBody);
      assert('付款同步成功', res.status === 200 && res.body.success, `状态: ${res.status}, 消息: ${res.body && res.body.message}`);
      const d = res.body && res.body.data;
      assert('返回付款记录', d && d.paymentRecord);
      if (d) {
        log(COLORS.cyan, `    付款编号: ${d.paymentRecord && d.paymentRecord.paymentNo}`);
        log(COLORS.cyan, `    付款金额: ¥${d.paymentRecord && d.paymentRecord.paidAmount}`);
        log(COLORS.cyan, `    更新费用: ${d.updatedFees} 笔`);
      }
    } catch (e) {
      assert('付款同步', false, e.message);
    }
  } else {
    log(COLORS.yellow, '  ⚠️  跳过付款同步（缺少测试房号或费用ID）');
  }

  // ===== Summary =====
  log(COLORS.bold + COLORS.cyan, '\n╔══════════════════════════════════════════════════╗');
  log(COLORS.bold + COLORS.cyan, '║                  验证结果汇总                    ║');
  log(COLORS.bold + COLORS.cyan, '╚══════════════════════════════════════════════════╝');

  log(COLORS.bold, `\n总用例数: ${passed + failed}`);
  log(COLORS.green, `通过: ${passed}`);
  log(COLORS.red, `失败: ${failed}`);

  if (failures.length > 0) {
    log(COLORS.bold + COLORS.red, '\n失败用例详情:');
    failures.forEach((f, i) => {
      log(COLORS.red, `  ${i + 1}. ${f.name}`);
      if (f.detail) log(COLORS.yellow, `     ${f.detail}`);
    });
  }

  log(COLORS.bold + COLORS.green, '\n✅ 测试完成!');
  console.log('');

  await cleanupAndExit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('验证失败:', e);
  cleanupAndExit(1);
});
