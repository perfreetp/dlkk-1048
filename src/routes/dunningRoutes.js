const express = require('express');
const router = express.Router();
const dunningController = require('../controllers/dunningController');

router.get('/templates', dunningController.getTemplates);
router.get('/templates/:templateId', dunningController.getTemplateById);
router.post('/templates/select', dunningController.selectTemplate);
router.post('/templates/render', dunningController.renderTemplate);

router.post('/tasks', dunningController.createDunningTask);
router.get('/tasks', dunningController.getDunningTasks);
router.get('/tasks/:taskId', dunningController.getDunningTaskDetail);
router.post('/tasks/:taskId/execute', dunningController.executeDunningTask);
router.post('/tasks/:taskId/cancel', dunningController.cancelDunningTask);

router.post('/batch-generate', dunningController.batchGenerateReminders);

router.get('/queue', dunningController.getMessageQueue);
router.get('/history/:houseNo', dunningController.getHouseDunningHistory);
router.get('/eligibility/:houseId', dunningController.checkDunningEligibility);

module.exports = router;
