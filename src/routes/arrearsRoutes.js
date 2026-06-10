const express = require('express');
const router = express.Router();
const arrearsController = require('../controllers/arrearsController');

router.get('/query', arrearsController.queryArrears);
router.get('/house/:houseNo', arrearsController.getHouseArrearsDetail);
router.get('/resident/:residentId', arrearsController.getResidentArrearsDetail);
router.post('/recalculate/:feeId', arrearsController.recalculateFee);
router.post('/batch-recalculate', arrearsController.batchRecalculateFees);
router.post('/refresh-overdue-status', arrearsController.batchRefreshOverdueStatus);

module.exports = router;
