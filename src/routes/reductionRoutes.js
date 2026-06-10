const express = require('express');
const router = express.Router();
const reductionController = require('../controllers/reductionController');

router.post('/applications', reductionController.createReductionApplication);
router.get('/applications', reductionController.getReductionApplications);
router.get('/applications/:applicationId', reductionController.getReductionApplicationDetail);
router.post('/applications/:applicationId/approve', reductionController.approveReductionApplication);
router.get('/pending-approvals', reductionController.getPendingApprovals);

router.get('/promised-payment-reminders', reductionController.getPromisedPaymentReminders);

router.put('/resident/:residentId/remark', reductionController.updateCustomerRemark);
router.put('/resident/:residentId/promised-date', reductionController.setPromisedPaymentDate);

module.exports = router;
