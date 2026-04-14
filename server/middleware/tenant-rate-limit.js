/**
 * Per-Tenant Rate Limiting
 * 
 * Enterprise rate limiting based on organization/billing plan.
 * Different limits per plan tier (free, starter, pro, business, enterprise).
 * Uses org-scoped keys instead of just IP addresses.
 */

const rateLimit = require('express-rate-limit');
const logger = require('../lib/logger');

// Plan-based rate limits (requests per 15 min window)
const PLAN_LIMITS = {
  free: 100,
  starter: 500,
  pro: 1500,
  business: 5000,
  enterprise: 20000
};

// Audit-specific limits (per org, per hour)
const AUDIT_PLAN_LIMITS = {
  free: 10,
  starter: 50,
  pro: 200,
  business: 1000,
  enterprise: 5000
};

/**
 * Per-tenant API rate limiter.
 * Uses orgId as key when authenticated, falls back to IP.
 */
function tenantRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: (req) => {
      // Override for tests
      const testMax = Number.parseInt(process.env.API_RATE_LIMIT_MAX, 10);
      if (Number.isFinite(testMax)) return testMax;

      if (req.user?.orgId) {
        const plan = req.tenantPlan || 'free';
        return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
      }
      return PLAN_LIMITS.free;
    },
    keyGenerator: (req) => {
      // Use orgId for authenticated org users, userId for individual, IP for unauthenticated
      if (req.user?.orgId) return `org:${req.user.orgId}`;
      if (req.user?.id) return `user:${req.user.id}`;
      return req.ip;
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn({
        key: req.user?.orgId ? `org:${req.user.orgId}` : req.ip,
        plan: req.tenantPlan
      }, 'Rate limit exceeded');
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: res.getHeader('Retry-After')
      });
    }
  });
}

/**
 * Audit submission rate limiter (per-org, per hour).
 */
function auditRateLimiter() {
  return rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: (req) => {
      const testMax = Number.parseInt(process.env.AUDIT_RATE_LIMIT_MAX, 10);
      if (Number.isFinite(testMax)) return testMax;

      const plan = req.tenantPlan || 'free';
      return AUDIT_PLAN_LIMITS[plan] || AUDIT_PLAN_LIMITS.free;
    },
    keyGenerator: (req) => {
      if (req.user?.orgId) return `audit:org:${req.user.orgId}`;
      if (req.user?.id) return `audit:user:${req.user.id}`;
      return `audit:${req.ip}`;
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Audit rate limit exceeded. Upgrade your plan for higher limits.' }
  });
}

/**
 * Middleware to inject tenant plan into request for rate limiting.
 * Should be added after auth middleware.
 */
function injectTenantPlan(prisma) {
  const planCache = new Map();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  return async (req, res, next) => {
    if (!req.user?.orgId) {
      req.tenantPlan = 'free';
      return next();
    }

    const cached = planCache.get(req.user.orgId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      req.tenantPlan = cached.plan;
      return next();
    }

    try {
      const billing = await prisma.billingAccount.findUnique({
        where: { orgId: req.user.orgId },
        select: { plan: true }
      });
      const plan = billing?.plan || 'free';
      planCache.set(req.user.orgId, { plan, ts: Date.now() });
      req.tenantPlan = plan;
    } catch {
      req.tenantPlan = 'free';
    }

    next();
  };
}

module.exports = {
  tenantRateLimiter,
  auditRateLimiter,
  injectTenantPlan,
  PLAN_LIMITS,
  AUDIT_PLAN_LIMITS
};
