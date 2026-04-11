const prisma = require('./prisma');
const { getPlan } = require('./plans');

/**
 * Get or create billing account for an org.
 * For users without an org, creates a virtual single-user billing context.
 */
async function getBillingAccount(userId) {
  // Find user's org
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { org: true } });
  if (!user) return null;

  if (!user.orgId) {
    // Solo user — check if they have a pseudo-org billing account
    // For solo users, we track usage at user-level via a convention
    return {
      virtual: true,
      plan: 'free',
      status: 'active',
      auditsUsed: await prisma.audit.count({
        where: {
          userId,
          createdAt: { gte: getMonthStart() }
        }
      }),
      auditsLimit: getPlan('free').auditsPerMonth,
      usersLimit: getPlan('free').maxUsers,
      storageLimitMb: getPlan('free').storageMb,
      storageUsedMb: 0,
      apiCallsUsed: 0,
      apiCallsLimit: getPlan('free').apiCallsPerMonth,
      orgId: null,
      userId
    };
  }

  let billing = await prisma.billingAccount.findUnique({
    where: { orgId: user.orgId }
  });

  if (!billing) {
    const plan = getPlan(user.org.plan || 'free');
    billing = await prisma.billingAccount.create({
      data: {
        orgId: user.orgId,
        plan: user.org.plan || 'free',
        auditsLimit: plan.auditsPerMonth,
        usersLimit: plan.maxUsers,
        storageLimitMb: plan.storageMb,
        apiCallsLimit: plan.apiCallsPerMonth
      }
    });
  }

  // Refresh monthly counters if period has rolled over
  if (billing.currentPeriodEnd && new Date(billing.currentPeriodEnd) < new Date()) {
    billing = await prisma.billingAccount.update({
      where: { id: billing.id },
      data: {
        auditsUsed: 0,
        apiCallsUsed: 0,
        currentPeriodStart: new Date(),
        currentPeriodEnd: getNextMonthDate()
      }
    });
  }

  return billing;
}

/**
 * Check if a specific limit is within quota.
 * Returns { allowed: bool, current, limit, resource }
 */
async function checkLimit(userId, resource) {
  const billing = await getBillingAccount(userId);
  if (!billing) return { allowed: true, current: 0, limit: -1, resource };

  switch (resource) {
    case 'audits': {
      const limit = billing.auditsLimit;
      if (limit === -1) return { allowed: true, current: billing.auditsUsed, limit: -1, resource };
      return { allowed: billing.auditsUsed < limit, current: billing.auditsUsed, limit, resource };
    }
    case 'users': {
      const limit = billing.usersLimit;
      if (limit === -1) return { allowed: true, current: 0, limit: -1, resource };
      const count = billing.orgId
        ? await prisma.user.count({ where: { orgId: billing.orgId } })
        : 1;
      return { allowed: count < limit, current: count, limit, resource };
    }
    case 'api_calls': {
      const limit = billing.apiCallsLimit;
      if (limit === -1) return { allowed: true, current: billing.apiCallsUsed, limit: -1, resource };
      return { allowed: billing.apiCallsUsed < limit, current: billing.apiCallsUsed, limit, resource };
    }
    default:
      return { allowed: true, current: 0, limit: -1, resource };
  }
}

/**
 * Increment a usage counter.
 */
async function incrementUsage(userId, resource, amount = 1) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.orgId) return;

  const billing = await prisma.billingAccount.findUnique({
    where: { orgId: user.orgId }
  });
  if (!billing) return;

  const data = {};
  if (resource === 'audits') data.auditsUsed = { increment: amount };
  if (resource === 'api_calls') data.apiCallsUsed = { increment: amount };
  if (resource === 'storage') data.storageUsedMb = { increment: amount };

  if (Object.keys(data).length > 0) {
    await prisma.billingAccount.update({
      where: { id: billing.id },
      data
    });
  }
}

/**
 * Express middleware to enforce a resource limit.
 */
function requireQuota(resource) {
  return async (req, res, next) => {
    try {
      const result = await checkLimit(req.user.id, resource);
      if (!result.allowed) {
        return res.status(402).json({
          error: `${resource} quota exceeded. Current: ${result.current}/${result.limit}. Upgrade your plan.`,
          resource,
          current: result.current,
          limit: result.limit,
          upgradeUrl: '/billing'
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Check if a feature is available on the user's plan.
 */
function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      const billing = await getBillingAccount(req.user.id);
      const plan = getPlan(billing?.plan || 'free');
      if (!plan.features.includes(feature)) {
        return res.status(403).json({
          error: `Feature "${feature}" is not available on the ${plan.name} plan. Upgrade to access it.`,
          feature,
          currentPlan: plan.name,
          upgradeUrl: '/billing'
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function getMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getNextMonthDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

module.exports = { getBillingAccount, checkLimit, incrementUsage, requireQuota, requireFeature };
