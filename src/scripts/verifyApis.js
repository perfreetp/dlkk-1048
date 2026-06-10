require('dotenv').config();
const http = require('http');

const BASE_URL = 'localhost';
const PORT = process.env.PORT || 3000;
const API_PREFIX = '/api/v1';

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

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: `${API_PREFIX}${path}`,
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

let testHouseNo = null;
let testFeeIds = [];
let testTaskId = null;
let testTemplateId = null;
let paymentAmount = 0;

async function runTests() {
  log(COLORS.bold + COLORS.cyan, '\n╔══════════════════════════════════════════════════╗');
  log(COLORS.bold + COLORS.cyan, '║        物业费催缴服务 API 端到端验证           ║');
  log(COLORS.bold + COLORS.cyan, '╚══════════════════════════════════════════════════╝\n');

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

  // ===== 1. Health Check =====
  log(COLORS.bold + COLORS.blue, '\n【1/7】服务健康检查');
  try {
    const res = await request('GET', '/health');
    assert('服务响应状态 200', res.status === 200, `实际: ${res.status}`);
    assert('success 字段为 true', res.body && res.body.success === true);
    assert('data.status === ok', res.body && res.body.data && res.body.data.status === 'ok');
    log(COLORS.cyan, `    请求ID: ${res.body && res.body.requestId}`);
  } catch (e) {
    assert('服务可访问', false, e.message);
    log(COLORS.red, '\n  无法连接到服务，请先执行: npm start\n');
    process.exit(1);
  }

  // ===== 2. 模板查询 =====
  log(COLORS.bold + COLORS.blue, '\n【2/7】催缴模板查询');
  try {
    const res = await request('GET', '/dunning/templates?pageSize=20');
    assert('模板列表查询成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
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

  // ===== 3. 欠费查询 =====
  log(COLORS.bold + COLORS.blue, '\n【3/7】欠费查询 & 房号检索');
  try {
    const res = await request('GET', '/arrears/query?pageSize=5&isOverdue=true');
    assert('欠费列表查询成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
    const list = res.body && res.body.data && res.body.data.list;
    assert('欠费记录数量 > 0', list && list.length > 0, `实际: ${list ? list.length : 0}`);
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
      assert('房屋欠费详情查询成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
      const d = res.body && res.body.data;
      assert('欠费详情包含 summary', d && d.summary, `字段: ${d ? Object.keys(d) : 'null'}`);
      if (d && d.arrearsFees) {
        testFeeIds = d.arrearsFees.slice(0, 2).map(f => f._id);
        log(COLORS.cyan, `    欠费笔数: ${d.arrearsFees.length}, 总额: ¥${d.summary && d.summary.totalArrears}`);
        log(COLORS.cyan, `    选中费用ID: ${testFeeIds.length}`);
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
        log(COLORS.cyan, `    业主姓名: ${list[0].resident ? list[0].resident.name : (list[0].house && list[0].house.ownerName)}`);
      }
    } catch (e) {
      assert('房号检索', false, e.message);
    }
  }

  // ===== 4. 创建催缴任务 & 批量生成 =====
  log(COLORS.bold + COLORS.blue, '\n【4/7】创建催缴任务 & 批量生成提醒');
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
    assert('返回 matchedCount > 0', d && d.matchedCount > 0, `实际: ${d && d.matchedCount}`);
    if (d && d.task) {
      testTaskId = d.task._id;
      log(COLORS.cyan, `    任务ID: ${testTaskId}`);
      log(COLORS.cyan, `    任务编号: ${d.task.taskNo}`);
      log(COLORS.cyan, `    匹配户数: ${d.matchedCount}`);
    }
  } catch (e) {
    assert('创建催缴任务', false, e.message);
  }

  // 批量生成提醒（分阶段，自动入队）
  try {
    const res = await request('POST', '/dunning/batch-generate', {
      dunningType: '短信',
      filters: { excludeRecentDunning: false, excludeBlacklist: false }
    });
    assert('批量生成提醒成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
    const data = res.body && res.body.data;
    assert('返回 stages 数组', data && Array.isArray(data.stages), `类型: ${data && typeof data}`);
    if (data && Array.isArray(data.stages)) {
      const total = data.stages.reduce((s, r) => s + (r.matchedCount || 0), 0);
      const totalQueued = data.totalQueued || 0;
      log(COLORS.cyan, `    分阶段结果: ${data.stages.map(r => `${r.stage}:${r.matchedCount || 0}户/${r.queuedCount || 0}条入队`).join(', ')}`);
      log(COLORS.cyan, `    总计匹配: ${total} 户, 入队: ${totalQueued} 条`);
      assert('批量生成后有入队记录', totalQueued > 0, `实际入队: ${totalQueued}`);
    }
  } catch (e) {
    assert('批量生成提醒', false, e.message);
  }

  // ===== 5. 发送队列验证 =====
  log(COLORS.bold + COLORS.blue, '\n【5/7】发送队列验证');
  try {
    const res = await request('GET', '/dunning/queue?pageSize=10&status=' + encodeURIComponent('待发送'));
    assert('发送队列查询成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
    const list = res.body && res.body.data && res.body.data.list;
    if (list) {
      assert('队列包含待发送记录', list.length > 0, `实际: ${list.length}`);
      log(COLORS.cyan, `    待发送消息: ${list.length} 条`);
      if (list.length > 0) {
        log(COLORS.cyan, `    第一条: ${list[0].houseNo} - ${list[0].title || '(无标题)'}`);
        log(COLORS.cyan, `    内容预览: ${list[0].content && list[0].content.substring(0, 40)}...`);
        assert('消息内容已渲染', list[0].content && list[0].content.length > 10);
      }
    }
  } catch (e) {
    assert('发送队列查询', false, e.message);
  }

  // ===== 6. 付款同步 =====
  log(COLORS.bold + COLORS.blue, '\n【6/7】付款同步');
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
        paymentAmount = d.paymentRecord && d.paymentRecord.paidAmount || 0;
        log(COLORS.cyan, `    付款编号: ${d.paymentRecord && d.paymentRecord.paymentNo}`);
        log(COLORS.cyan, `    付款金额: ¥${paymentAmount}`);
        log(COLORS.cyan, `    更新费用: ${d.updatedFees} 笔`);
      }
    } catch (e) {
      assert('付款同步', false, e.message);
    }
  } else {
    log(COLORS.yellow, '  ⚠️  跳过付款同步（缺少测试房号或费用ID）');
  }

  // ===== 7. 催缴效果统计 & 付款后验证 =====
  log(COLORS.bold + COLORS.blue, '\n【7/7】催缴效果统计 & 付款后验证');
  try {
    const res = await request('GET', '/statistics/dunning-effect');
    assert('催缴效果统计成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
    const d = res.body && res.body.data;
    assert('包含 overview 字段', d && d.overview);
    if (d && d.overview) {
      log(COLORS.cyan, `    总任务数: ${d.overview.totalTasks}`);
      log(COLORS.cyan, `    已发送消息: ${d.overview.totalMessagesSent}`);
      log(COLORS.cyan, `    付款笔数: ${d.overview.totalPayments}`);
      log(COLORS.cyan, `    付款金额: ¥${d.overview.totalPaymentAmount}`);
      if (paymentAmount > 0) {
        assert('付款金额统计正确', d.overview.totalPaymentAmount >= paymentAmount,
          `统计: ¥${d.overview.totalPaymentAmount}, 期望: >= ¥${paymentAmount}`);
      }
    }
    assert('包含 rates 字段', d && d.rates);
  } catch (e) {
    assert('催缴效果统计', false, e.message);
  }

  if (testHouseNo && paymentAmount > 0) {
    try {
      const res = await request('GET', `/arrears/house/${encodeURIComponent(testHouseNo)}`);
      assert('付款后欠费详情查询成功', res.status === 200 && res.body.success, `状态: ${res.status}`);
      const d = res.body && res.body.data;
      if (d && d.arrearsFees && d.arrearsFees.length > 0) {
        const firstFee = d.arrearsFees[0];
        log(COLORS.cyan, `    第一笔欠费: ¥${firstFee.unpaidAmount} (已付: ¥${firstFee.paidAmount})`);
        assert('欠费金额已更新', firstFee.paidAmount > 0,
          `已付金额: ¥${firstFee.paidAmount}, 未付: ¥${firstFee.unpaidAmount}`);
      }
      if (d && d.summary) {
        log(COLORS.cyan, `    当前总欠费: ¥${d.summary.totalArrears}`);
      }
    } catch (e) {
      assert('付款后欠费详情', false, e.message);
    }
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

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
