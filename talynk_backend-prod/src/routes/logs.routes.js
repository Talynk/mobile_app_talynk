/**
 * Public logs routes: client event ingestion.
 * Admin log viewing is under /api/admin/logs/* (see admin.routes.js).
 */

const express = require('express');
const router = express.Router();
const logsController = require('../controllers/logsController');
const { optionalAuthenticate } = require('../middleware/auth');

router.post('/client-events', optionalAuthenticate, logsController.postClientEvent);

module.exports = router;
