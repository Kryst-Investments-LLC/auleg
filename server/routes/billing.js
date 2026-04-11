const express = require('express');
const prisma = require('../lib/prisma');
const authMiddleware = require('../middleware/auth');
const { PLANS, getPlan } = require('../lib/plans');
const { getBillingAccount, incrementUsage } = require('../lib/billing');
const { activityFromReq } = require('../lib/activity');
const { notify } = require('../lib/notifications');
const stripeLib = require('../lib/stripe');

const router = express.Router();

/**
 * @swagger
 * /api/billing/plans:
 *   get:
 *     summary: List all available plans
 *     tags: [Billing]
 *     responses:
 *       200:
 *         description: List of plans
 */
router.get('/plans', (req, res) => {
  const plans = Object.entries(PLANS).map(([key, plan]) => ({
    id: key,
    name: plan.name,
    price: plan.price,
    priceDisplay: plan.price === 0 ? 'Free' : `$${(plan.price / 100).toFixed(0)}/mo`,
    auditsPerMonth: plan.auditsPerMonth,
    maxUsers: plan.maxUsers,
    storageMb: plan.storageMb,
    apiCallsPerMonth: plan.apiCallsPerMonth,
    features: plan.features,
    description: plan.description
  }));
  res.json({ plans });
});

/**
 * @swagger
 * /api/billing/account:
 *   get:
 *     summary: Get billing account for current user's org
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Billing account
 */
router.get('/account', authMiddleware, async (req, res, next) => {
  try {
    const billing = await getBillingAccount(req.user.id);
    if (!billing) return res.status(404).json({ error: 'No billing account found' });

    const plan = getPlan(billing.plan);
    res.json({
      ...billing,
      planDetails: {
        name: plan.name,
        price: plan.price,
        priceDisplay: plan.price === 0 ? 'Free' : `$${(plan.price / 100).toFixed(0)}/mo`,
        features: plan.features,
        description: plan.description
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/billing/usage:
 *   get:
 *     summary: Get current billing period usage
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Usage stats
 */
router.get('/usage', authMiddleware, async (req, res, next) => {
  try {
    const billing = await getBillingAccount(req.user.id);
    if (!billing) return res.status(404).json({ error: 'No billing account found' });

    const plan = getPlan(billing.plan);

    // Count users in org
    const userCount = billing.orgId
      ? await prisma.user.count({ where: { orgId: billing.orgId } })
      : 1;

    // Calc storage from uploads folder
    let storageUsedMb = billing.storageUsedMb || 0;
    if (billing.orgId) {
      const audits = await prisma.audit.findMany({
        where: { orgId: billing.orgId },
        select: { contractPath: true }
      });
      // Rough estimate: count audits * avg 0.05MB
      storageUsedMb = Math.round(audits.length * 0.05 * 100) / 100;
    }

    res.json({
      period: {
        start: billing.currentPeriodStart || getMonthStart(),
        end: billing.currentPeriodEnd || getNextMonth()
      },
      audits: {
        used: billing.auditsUsed,
        limit: plan.auditsPerMonth,
        percentage: plan.auditsPerMonth > 0 ? Math.round((billing.auditsUsed / plan.auditsPerMonth) * 100) : 0
      },
      users: {
        used: userCount,
        limit: plan.maxUsers,
        percentage: plan.maxUsers > 0 ? Math.round((userCount / plan.maxUsers) * 100) : 0
      },
      storage: {
        usedMb: storageUsedMb,
        limitMb: plan.storageMb,
        percentage: plan.storageMb > 0 ? Math.round((storageUsedMb / plan.storageMb) * 100) : 0
      },
      apiCalls: {
        used: billing.apiCallsUsed,
        limit: plan.apiCallsPerMonth,
        percentage: plan.apiCallsPerMonth > 0 ? Math.round((billing.apiCallsUsed / plan.apiCallsPerMonth) * 100) : 0
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/billing/upgrade:
 *   post:
 *     summary: Upgrade or change plan
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [plan]
 *             properties:
 *               plan: { type: string, enum: [free, pro, enterprise] }
 *     responses:
 *       200:
 *         description: Plan changed
 */
router.post('/upgrade', authMiddleware, async (req, res, next) => {
  try {
    const { plan: newPlan } = req.body;
    if (!PLANS[newPlan]) {
      return res.status(400).json({ error: `Invalid plan. Options: ${Object.keys(PLANS).join(', ')}` });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { org: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Must be org owner/admin to change plan
    if (!user.orgId) {
      return res.status(400).json({ error: 'Create an organization first to manage billing' });
    }

    const billing = await getBillingAccount(req.user.id);
    const oldPlan = billing.plan || 'free';

    if (oldPlan === newPlan) {
      return res.status(400).json({ error: 'Already on this plan' });
    }

    const planConfig = getPlan(newPlan);
    const isUpgrade = PLANS[newPlan].price > PLANS[oldPlan].price;

    // If Stripe is live and upgrading to a paid plan, redirect to Stripe Checkout
    if (stripeLib.isLive() && newPlan !== 'free' && isUpgrade) {
      const priceId = newPlan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_ENTERPRISE;
      if (priceId) {
        const customerId = await stripeLib.getOrCreateCustomer(user.org, user.email);
        // Persist Stripe customer ID
        if (customerId && !billing.stripeCustomerId) {
          await prisma.billingAccount.update({
            where: { orgId: user.orgId },
            data: { stripeCustomerId: customerId }
          });
        }
        const session = await stripeLib.createCheckoutSession({
          customerId,
          priceId,
          orgId: user.orgId
        });
        if (session) {
          return res.json({ checkoutUrl: session.url, sessionId: session.sessionId });
        }
      }
    }

    // Direct plan change (mock mode, free plan, or downgrade)
    // Update org plan
    await prisma.org.update({
      where: { id: user.orgId },
      data: { plan: newPlan }
    });

    // Update billing account
    const updated = await prisma.billingAccount.upsert({
      where: { orgId: user.orgId },
      update: {
        plan: newPlan,
        auditsLimit: planConfig.auditsPerMonth,
        usersLimit: planConfig.maxUsers,
        storageLimitMb: planConfig.storageMb,
        apiCallsLimit: planConfig.apiCallsPerMonth,
        currentPeriodStart: new Date(),
        currentPeriodEnd: getNextMonth()
      },
      create: {
        orgId: user.orgId,
        plan: newPlan,
        auditsLimit: planConfig.auditsPerMonth,
        usersLimit: planConfig.maxUsers,
        storageLimitMb: planConfig.storageMb,
        apiCallsLimit: planConfig.apiCallsPerMonth,
        currentPeriodStart: new Date(),
        currentPeriodEnd: getNextMonth()
      }
    });

    // Log billing event
    await prisma.billingEvent.create({
      data: {
        orgId: user.orgId,
        type: isUpgrade ? 'plan.upgrade' : 'plan.downgrade',
        detail: `${oldPlan} → ${newPlan}`,
        amount: planConfig.price
      }
    });

    await activityFromReq(req, 'billing.plan_change', `${oldPlan} → ${newPlan}`);
    await notify(req.user.id, 'billing.plan_change', 'Plan Changed',
      `Your plan has been ${isUpgrade ? 'upgraded' : 'changed'} to ${planConfig.name}.`);

    res.json({
      message: `Plan ${isUpgrade ? 'upgraded' : 'changed'} to ${planConfig.name}`,
      billing: updated,
      planDetails: {
        name: planConfig.name,
        price: planConfig.price,
        priceDisplay: planConfig.price === 0 ? 'Free' : `$${(planConfig.price / 100).toFixed(0)}/mo`,
        features: planConfig.features
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/billing/events:
 *   get:
 *     summary: Get billing event history
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Billing events
 */
router.get('/events', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.orgId) {
      return res.json({ events: [] });
    }

    const events = await prisma.billingEvent.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({ events });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/billing/portal:
 *   post:
 *     summary: Create a mock billing portal session
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Portal URL
 */
router.post('/portal', authMiddleware, async (req, res, next) => {
  try {
    const billing = await getBillingAccount(req.user.id);
    if (!billing) return res.status(404).json({ error: 'No billing account found' });

    // Real Stripe portal
    if (stripeLib.isLive() && billing.stripeCustomerId) {
      const session = await stripeLib.createPortalSession(billing.stripeCustomerId);
      return res.json(session);
    }

    // Mock fallback
    res.json({
      url: '/billing',
      message: 'Billing portal (development mode). Set STRIPE_SECRET_KEY for live Stripe.',
      billing
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/billing/webhook:
 *   post:
 *     summary: Stripe webhook endpoint
 *     tags: [Billing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, data]
 *             properties:
 *               type: { type: string }
 *               data: { type: object }
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let eventType, eventData;

  // Real Stripe webhook with signature verification
  if (stripeLib.isLive() && req.headers['stripe-signature']) {
    try {
      const event = stripeLib.verifyWebhookSignature(req.body, req.headers['stripe-signature']);
      eventType = event.type;
      eventData = event.data.object;
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } else {
    // Mock/dev mode — accept raw JSON
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    eventType = body.type;
    eventData = body.data;
  }

  try {
    switch (eventType) {
      case 'checkout.session.completed': {
        // Real Stripe: subscription created via checkout
        const orgId = eventData.metadata?.orgId;
        if (orgId && eventData.subscription) {
          const sub = stripeLib.stripe ? await stripeLib.stripe.subscriptions.retrieve(eventData.subscription) : null;
          const priceId = sub?.items?.data?.[0]?.price?.id;
          const newPlan = stripeLib.planFromPriceId(priceId) || 'pro';
          const planConfig = getPlan(newPlan);
          await prisma.org.update({ where: { id: orgId }, data: { plan: newPlan } });
          await prisma.billingAccount.upsert({
            where: { orgId },
            update: {
              plan: newPlan, status: 'active',
              stripeCustomerId: eventData.customer,
              auditsLimit: planConfig.auditsPerMonth, usersLimit: planConfig.maxUsers,
              storageLimitMb: planConfig.storageMb, apiCallsLimit: planConfig.apiCallsPerMonth,
              currentPeriodStart: new Date(), currentPeriodEnd: getNextMonth()
            },
            create: {
              orgId, plan: newPlan, stripeCustomerId: eventData.customer,
              auditsLimit: planConfig.auditsPerMonth, usersLimit: planConfig.maxUsers,
              storageLimitMb: planConfig.storageMb, apiCallsLimit: planConfig.apiCallsPerMonth
            }
          });
          await prisma.billingEvent.create({
            data: { orgId, type: 'plan.upgrade', detail: `Checkout → ${newPlan}`, amount: planConfig.price }
          });
        }
        break;
      }
      case 'invoice.paid': {
        const orgId = eventData?.orgId || eventData?.subscription_details?.metadata?.orgId || eventData?.metadata?.orgId;
        if (orgId) {
          await prisma.billingEvent.create({
            data: { orgId, type: 'payment.success', detail: 'Invoice paid', amount: eventData.amount_paid || eventData.amount || 0 }
          });
          // Reset monthly counters
          await prisma.billingAccount.update({
            where: { orgId },
            data: {
              status: 'active',
              auditsUsed: 0,
              apiCallsUsed: 0,
              currentPeriodStart: new Date(),
              currentPeriodEnd: getNextMonth()
            }
          });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const orgId = eventData?.orgId || eventData?.subscription_details?.metadata?.orgId || eventData?.metadata?.orgId;
        if (orgId) {
          await prisma.billingEvent.create({
            data: { orgId, type: 'payment.failed', detail: 'Payment failed', amount: eventData.amount_due || eventData.amount || 0 }
          });
          await prisma.billingAccount.update({
            where: { orgId },
            data: { status: 'past_due' }
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const orgId = eventData?.orgId || eventData?.metadata?.orgId;
        if (orgId) {
          const freePlan = getPlan('free');
          await prisma.billingAccount.update({
            where: { orgId },
            data: {
              plan: 'free', status: 'canceled',
              auditsLimit: freePlan.auditsPerMonth, usersLimit: freePlan.maxUsers,
              storageLimitMb: freePlan.storageMb, apiCallsLimit: freePlan.apiCallsPerMonth
            }
          });
          await prisma.org.update({ where: { id: orgId }, data: { plan: 'free' } });
          await prisma.billingEvent.create({
            data: { orgId, type: 'plan.downgrade', detail: 'Subscription canceled → free' }
          });
        }
        break;
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Billing webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

function getMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getNextMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

module.exports = router;
