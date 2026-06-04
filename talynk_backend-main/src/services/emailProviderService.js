const { Resend } = require('resend');

let resendClient = null;

function getResendClient() {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Resend] RESEND_API_KEY is not set; email receiving API will be disabled.');
    return null;
  }
  resendClient = new Resend(apiKey);
  return resendClient;
}

async function getReceivedEmail(emailId) {
  const client = getResendClient();
  if (!client) {
    throw new Error('Resend client not configured (missing RESEND_API_KEY)');
  }
  const { data, error } = await client.emails.receiving.get(emailId);
  if (error) {
    throw new Error(error.message || 'Failed to fetch received email from Resend');
  }
  return data;
}

module.exports = {
  getReceivedEmail,
};

