const express = require('express');
const router = express.Router();
const statisticsController = require('../controllers/statisticsController');

router.get('/dashboard', statisticsController.getDashboardSummary);
router.get('/dunning-effect', statisticsController.getDunningEffectStatistics);
router.get('/building-ranking', statisticsController.getBuildingRanking);
router.get('/overdue-distribution', statisticsController.getOverdueDistribution);

router.post('/export/:type', statisticsController.exportData);
router.get('/export/download/:fileName', statisticsController.downloadExport);

router.get('/operation-logs', statisticsController.getOperationLogs);
router.get('/api-call-logs', statisticsController.getApiCallLogs);
router.get('/api-call-result/:requestId', statisticsController.getApiCallResult);

router.get('/pending-tasks-approval', statisticsController.getPendingTasksForApproval);
router.post('/approve-task/:taskId', statisticsController.approveTask);

module.exports = router;
