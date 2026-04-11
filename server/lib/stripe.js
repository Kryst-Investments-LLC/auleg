/**
 * Stripe integration module.
 * 
 * When STRIPE_SECRET_KEY is set, provides real Stripe checkout, portal,
 * and webhook signature verification. Falls back to mock mode otherwise.
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

let stripe = null;
if (STRIPE_KEY) {
  try {
    const Stripe = require('stripe');
    stripe = new Stripe(STRIPE_KEY);
    console.log('Stripe: Live mode enabled');
  } catch (e) {
    console.warn('Stripe package not installed, falling back to mock billing');
  }
}

function isLive() {
  return !!stripe;
}

/**
 * Create or retrieve a Stripe customer for an org.
 */
async function getOrCreateCustomer(org, email) {
  if (!stripe) return null;

  if (org.stripeCustomerId) {
    return org.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email,
    name: org.name,
    metadata: { orgId: org.id }
  });

  return customer.id;
}

/**
 * Create a Stripe Checkout Session for plan upgrade.
 */
async function createCheckoutSession({ customerId, priceId, orgId, successUrl, cancelUrl }) {
  if (!stripe) return null;

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl || `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/billing`,
    metadata: { orgId },
    subscription_data: { metadata: { orgId } }
  });

  return { sessionId: session.id, url: session.url };
}

/**
 * Create a Stripe Billing Portal session.
 */
async function createPortalSession(customerId, returnUrl) {
  if (!stripe) return null;

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl || `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/billing`
  });

  return { url: session.url };
}

/**
 * Verify Stripe webhook signature and parse the event.
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return null;

  return stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
}

/**
 * Map Stripe price IDs to plan names.
 * Set via STRIPE_PRICE_PRO and STRIPE_PRICE_ENTERPRISE env vars.
 */
const PRICE_TO_PLAN = {};
if (process.env.STRIPE_PRICE_PRO) PRICE_TO_PLAN[process.env.STRIPE_PRICE_PRO] = 'pro';
if (process.env.STRIPE_PRICE_ENTERPRISE) PRICE_TO_PLAN[process.env.STRIPE_PRICE_ENTERPRISE] = 'enterprise';

function planFromPriceId(priceId) {
  return PRICE_TO_PLAN[priceId] || null;
}

module.exports = {
  isLive,
  getOrCreateCustomer,
  createCheckoutSession,
  createPortalSession,
  verifyWebhookSignature,
  planFromPriceId,
  stripe
};
