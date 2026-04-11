const prisma = require('./prisma');

async function logActivity(action, { detail, userId, userEmail, ip } = {}) {
  try {
    await prisma.activityLog.create({
      data: { action, detail, userId, userEmail, ip }
    });
  } catch (err) {
    console.error('Activity log failed:', err.message);
  }
}

function activityFromReq(req, action, detail) {
  return logActivity(action, {
    detail,
    userId: req.user?.id,
    userEmail: req.user?.email,
    ip: req.ip
  });
}

module.exports = { logActivity, activityFromReq };
