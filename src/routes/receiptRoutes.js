const express = require('express');
const router = express.Router();
const receiptController = require('../controllers/receiptController');

router.post('/register', receiptController.registerReceipt);
router.post('/batch-register', receiptController.batchRegisterReceipts);
router.get('/list', receiptController.getReceipts);

router.post('/payment/sync', receiptController.syncPayment);
router.post('/payment/batch-sync', receiptController.batchSyncPayments);
router.get('/payment/list', receiptController.getPaymentRecords);

module.exports = router;
