const express = require('express');
const router = express.Router();

const webhookController = require('../controllers/webhookController');

// Resend inbound email webhook
router.post('/resend', express.json({ type: '*/*' }), webhookController.handleResendWebhook);

module.exports = router;

