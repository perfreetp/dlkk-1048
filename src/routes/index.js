const express = require('express');
const router = express.Router();

const arrearsRoutes = require('./arrearsRoutes');
const dunningRoutes = require('./dunningRoutes');
const receiptRoutes = require('./receiptRoutes');
const reductionRoutes = require('./reductionRoutes');
const residentRoutes = require('./residentRoutes');
const statisticsRoutes = require('./statisticsRoutes');

router.get('/health', (req, res) => {
  res.success({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  }, '服务运行正常');
});

router.use('/arrears', arrearsRoutes);
router.use('/dunning', dunningRoutes);
router.use('/receipt', receiptRoutes);
router.use('/reduction', reductionRoutes);
router.use('/resident', residentRoutes);
router.use('/statistics', statisticsRoutes);

module.exports = router;
