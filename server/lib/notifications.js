const prisma = require('./prisma');
const email = require('./email');

/**
 * Create an in-app notification for a user.
 * Also sends an email if the user's preferences allow it and email service is configured.
 * @param {string} userId
 * @param {string} type - e.g. audit.complete, audit.failed, system, org.invite
 * @param {string} title
 * @param {string} message
 * @param {object} [data] - optional JSON-serializable payload
 */
async function notify(userId, type, title, message, data = null) {
  try {
    await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        data: data ? JSON.stringify(data) : null
      }
    });

    // Send email notification if configured
    if (email.isLive()) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const prefs = await prisma.userPreference.findUnique({ where: { userId } });
        if (user && user.email) {
          // Check user preferences
          const shouldEmail =
            (type === 'audit.complete' && (prefs?.notifyAuditComplete !== false)) ||
            (type === 'audit.failed' && (prefs?.notifyAuditFailed !== false)) ||
            (type === 'audit.shared' && (prefs?.notifyShare !== false)) ||
            (type === 'billing.plan_change');
          if (shouldEmail) {
            await email.sendEmail({ to: user.email, subject: `Auleg — ${title}`, html: `<p>${message}</p>` });
          }
        }
      } catch (emailErr) {
        console.error('Email notification failed:', emailErr.message);
      }
    }
  } catch (err) {
    console.error('Failed to create notification:', err.message);
  }
}

module.exports = { notify };
