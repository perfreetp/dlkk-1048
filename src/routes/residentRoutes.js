const express = require('express');
const router = express.Router();
const residentController = require('../controllers/residentController');

router.get('/search/:houseNo', residentController.searchByHouseNo);

router.post('/complaints', residentController.createComplaint);
router.get('/complaints', residentController.getComplaints);
router.put('/complaints/:complaintId/status', residentController.updateComplaintStatus);

router.post('/blacklist/:residentId/add', residentController.addToBlacklist);
router.post('/blacklist/:residentId/remove', residentController.removeFromBlacklist);
router.get('/blacklist', residentController.getBlacklist);

router.get('/list', residentController.getResidents);
router.get('/:residentId', residentController.getResidentDetail);

module.exports = router;
