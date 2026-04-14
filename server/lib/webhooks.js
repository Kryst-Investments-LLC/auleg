const crypto = require('crypto');
const prisma = require('./prisma');
const { normalizeAndValidateOutboundUrl } = require('./url-security');
const { decrypt } = require('./crypto');

async function dispatchWebhook(userId, event, payload) {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { userId, active: true }
    });

    for (const hook of webhooks) {
      const events = hook.events.split(',').map(e => e.trim());
      if (!events.includes(event)) continue;

      let safeUrl;
      try {
        safeUrl = await normalizeAndValidateOutboundUrl(hook.url);
      } catch (err) {
        console.error(`Webhook ${hook.id} blocked:`, err.message);
        continue;
      }

      let secret;
      try {
        secret = decrypt(hook.secretEncrypted, hook.secretIv, hook.secretTag);
      } catch (err) {
        console.error(`Webhook ${hook.id} secret decryption failed:`, err.message);
        continue;
      }

      const body = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        data: payload
      });

      const signature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      // Fire-and-forget with timeout
      fetch(safeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': event
        },
        body,
        signal: AbortSignal.timeout(10000)
      }).catch(err => {
        console.error(`Webhook ${hook.id} to ${hook.url} failed:`, err.message);
      });
    }
  } catch (err) {
    console.error('Webhook dispatch error:', err.message);
  }
}

module.exports = { dispatchWebhook };
