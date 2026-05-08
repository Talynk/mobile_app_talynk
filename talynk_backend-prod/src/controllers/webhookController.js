const prisma = require('../lib/prisma');
const { getReceivedEmail } = require('../services/emailProviderService');
const { emitEvent } = require('../lib/realtime');

/**
 * Resend webhook handler: capture email.received events and persist via Receiving API.
 */
exports.handleResendWebhook = async (req, res) => {
  try {
    const event = req.body;

    if (!event || !event.type) {
      return res.status(400).json({ status: 'error', message: 'Invalid webhook payload' });
    }

    // Optional simple secret check (?secret=...) for basic protection
    const expectedSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (expectedSecret && req.query.secret !== expectedSecret) {
      return res.status(401).json({ status: 'error', message: 'Invalid webhook secret' });
    }

    if (event.type === 'email.received') {
      const data = event.data || {};
      const emailId = data.email_id || data.id;

      if (!emailId) {
        console.warn('[Resend webhook] email.received event without email_id');
      } else {
        try {
          const email = await getReceivedEmail(emailId);

          const from = Array.isArray(email.from) ? email.from.join(', ') : email.from;
          const to = Array.isArray(email.to) ? email.to.join(', ') : email.to;

          const record = await prisma.supportEmail.upsert({
            where: { providerEmailId: email.id },
            update: {
              from,
              to,
              subject: email.subject || null,
              text: email.text || null,
              html: email.html || null,
              headers: email.headers || undefined,
              receivedAt: email.created_at ? new Date(email.created_at) : new Date(),
            },
            create: {
              providerEmailId: email.id,
              from,
              to,
              subject: email.subject || null,
              text: email.text || null,
              html: email.html || null,
              headers: email.headers || undefined,
              receivedAt: email.created_at ? new Date(email.created_at) : new Date(),
            },
          });

          // Optional real-time event for admin inbox
          emitEvent('admin:support_email', {
            id: record.id,
            from: record.from,
            to: record.to,
            subject: record.subject,
            receivedAt: record.receivedAt,
            isRead: record.isRead,
          });
        } catch (err) {
          console.error('[Resend webhook] Failed to fetch/store received email:', err);
        }
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('[Resend webhook] Error handling webhook:', error);
    // Always return 200 to avoid retries storms; log for investigation.
    res.status(200).json({ status: 'ok' });
  }
};

