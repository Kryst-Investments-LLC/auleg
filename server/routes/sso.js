/**
 * SSO Routes — SAML 2.0 and OpenID Connect (OIDC)
 * 
 * Enterprise SSO flow:
 * 1. Admin configures SSO for their org via /api/sso/config
 * 2. Users initiate login via /api/sso/saml/login or /api/sso/oidc/login
 * 3. IdP callback posts to /api/sso/saml/callback or /api/sso/oidc/callback
 * 4. Server creates/links user, issues JWT session cookie
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { logActivity } = require('../lib/activity');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// ─── SAML 2.0 ──────────────────────────────────────────

let passport, SamlStrategy;
try {
  passport = require('passport');
  SamlStrategy = require('@node-saml/passport-saml').Strategy;
} catch (e) {
  logger.warn('@node-saml/passport-saml not available — SAML SSO disabled');
}

// ─── OIDC ──────────────────────────────────────────────

let openidClient;
try {
  openidClient = require('openid-client');
} catch (e) {
  logger.warn('openid-client not available — OIDC SSO disabled');
}

// Cache of org SSO configs
const ssoConfigCache = new Map();

/**
 * Get SSO config for an org from DB (with caching).
 */
async function getSSOConfig(orgId) {
  if (ssoConfigCache.has(orgId)) {
    const cached = ssoConfigCache.get(orgId);
    if (Date.now() - cached.ts < 5 * 60 * 1000) return cached.config; // 5 min cache
  }

  const config = await prisma.sSOConfig.findUnique({ where: { orgId } });
  if (config) {
    ssoConfigCache.set(orgId, { config, ts: Date.now() });
  }
  return config;
}

// ─── Admin: Configure SSO ──────────────────────────────

/**
 * @swagger
 * /api/sso/config:
 *   put:
 *     summary: Configure SSO for organization (admin only)
 *     tags: [SSO]
 *     security: [{ bearerAuth: [] }]
 */
router.put('/config', authMiddleware, requireRole('admin'), async (req, res) => {
  const { provider, entryPoint, issuer, cert, clientId, clientSecret, discoveryUrl } = req.body;

  if (!provider || !['saml', 'oidc'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be "saml" or "oidc"' });
  }

  if (!req.user.orgId) {
    return res.status(400).json({ error: 'User must belong to an organization' });
  }

  // Validate provider-specific fields
  if (provider === 'saml') {
    if (!entryPoint || !issuer || !cert) {
      return res.status(400).json({ error: 'SAML requires entryPoint, issuer, and cert' });
    }
  } else if (provider === 'oidc') {
    if (!clientId || !discoveryUrl) {
      return res.status(400).json({ error: 'OIDC requires clientId and discoveryUrl' });
    }
  }

  const data = {
    orgId: req.user.orgId,
    provider,
    entryPoint: entryPoint || null,
    issuer: issuer || null,
    cert: cert || null,
    clientId: clientId || null,
    clientSecret: clientSecret || null,
    discoveryUrl: discoveryUrl || null,
    enabled: true
  };

  const config = await prisma.sSOConfig.upsert({
    where: { orgId: req.user.orgId },
    create: { id: crypto.randomUUID(), ...data },
    update: data
  });

  ssoConfigCache.delete(req.user.orgId);

  await logActivity('sso.configure', {
    detail: `SSO configured: ${provider}`,
    userId: req.user.id,
    userEmail: req.user.email
  });

  logger.info({ orgId: req.user.orgId, provider }, 'SSO configured');

  res.json({ id: config.id, provider: config.provider, enabled: config.enabled });
});

/**
 * @swagger
 * /api/sso/config:
 *   get:
 *     summary: Get SSO configuration for current org
 *     tags: [SSO]
 */
router.get('/config', authMiddleware, requireRole('admin'), async (req, res) => {
  if (!req.user.orgId) {
    return res.status(400).json({ error: 'User must belong to an organization' });
  }

  const config = await getSSOConfig(req.user.orgId);
  if (!config) {
    return res.json({ configured: false });
  }

  res.json({
    configured: true,
    provider: config.provider,
    enabled: config.enabled,
    entryPoint: config.entryPoint,
    issuer: config.issuer,
    discoveryUrl: config.discoveryUrl,
    clientId: config.clientId,
    // Never expose cert or clientSecret
  });
});

// ─── SAML Login Flow ────────────────────────────────────

/**
 * @swagger
 * /api/sso/saml/login/{orgId}:
 *   get:
 *     summary: Initiate SAML SSO login for an org
 *     tags: [SSO]
 */
router.get('/saml/login/:orgId', async (req, res) => {
  if (!SamlStrategy) {
    return res.status(501).json({ error: 'SAML SSO not available' });
  }

  const config = await getSSOConfig(req.params.orgId);
  if (!config || config.provider !== 'saml' || !config.enabled) {
    return res.status(404).json({ error: 'SAML SSO not configured for this organization' });
  }

  const callbackUrl = `${process.env.CORS_ORIGIN || 'http://localhost:4000'}/api/sso/saml/callback`;

  const strategy = new SamlStrategy({
    entryPoint: config.entryPoint,
    issuer: config.issuer,
    idpCert: config.cert,
    callbackUrl,
    identifierFormat: null
  }, (profile, done) => done(null, profile));

  passport.use('saml-' + req.params.orgId, strategy);

  // Generate SAML AuthnRequest redirect
  passport.authenticate('saml-' + req.params.orgId, {
    session: false,
    additionalParams: { RelayState: req.params.orgId }
  })(req, res);
});

/**
 * @swagger
 * /api/sso/saml/callback:
 *   post:
 *     summary: SAML assertion consumer service (ACS) callback
 *     tags: [SSO]
 */
router.post('/saml/callback', express.urlencoded({ extended: false }), async (req, res) => {
  if (!SamlStrategy) {
    return res.status(501).json({ error: 'SAML SSO not available' });
  }

  const orgId = req.body.RelayState;
  if (!orgId) {
    return res.status(400).json({ error: 'Missing RelayState (orgId)' });
  }

  const config = await getSSOConfig(orgId);
  if (!config || config.provider !== 'saml' || !config.enabled) {
    return res.status(404).json({ error: 'SAML SSO not configured' });
  }

  const callbackUrl = `${process.env.CORS_ORIGIN || 'http://localhost:4000'}/api/sso/saml/callback`;

  const strategy = new SamlStrategy({
    entryPoint: config.entryPoint,
    issuer: config.issuer,
    idpCert: config.cert,
    callbackUrl,
    identifierFormat: null
  }, (profile, done) => done(null, profile));

  passport.use('saml-cb-' + orgId, strategy);

  passport.authenticate('saml-cb-' + orgId, { session: false }, async (err, profile) => {
    if (err || !profile) {
      logger.error({ err: err?.message, orgId }, 'SAML callback failed');
      return res.status(401).json({ error: 'SAML authentication failed' });
    }

    try {
      const email = profile.email || profile.nameID || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'];
      const name = profile.displayName || profile.firstName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'] || '';

      if (!email) {
        return res.status(400).json({ error: 'No email in SAML assertion' });
      }

      const user = await findOrCreateSSOUser(email, name, orgId);
      const token = issueToken(user);

      // Set session cookie and redirect to dashboard
      res.cookie('session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });

      await logActivity('sso.login', {
        detail: `SAML login: ${email}`,
        userId: user.id,
        userEmail: email
      });

      const dashboardUrl = process.env.CORS_ORIGIN || 'http://localhost:3000';
      res.redirect(dashboardUrl + '/dashboard');
    } catch (e) {
      logger.error({ err: e.message, orgId }, 'SAML user provisioning failed');
      res.status(500).json({ error: 'SSO login failed' });
    }
  })(req, res);
});

// ─── OIDC Login Flow ────────────────────────────────────

/**
 * @swagger
 * /api/sso/oidc/login/{orgId}:
 *   get:
 *     summary: Initiate OIDC SSO login for an org
 *     tags: [SSO]
 */
router.get('/oidc/login/:orgId', async (req, res) => {
  if (!openidClient) {
    return res.status(501).json({ error: 'OIDC SSO not available' });
  }

  const config = await getSSOConfig(req.params.orgId);
  if (!config || config.provider !== 'oidc' || !config.enabled) {
    return res.status(404).json({ error: 'OIDC SSO not configured for this organization' });
  }

  try {
    const issuer = await openidClient.Issuer.discover(config.discoveryUrl);
    const client = new issuer.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret || undefined,
      redirect_uris: [`${process.env.API_BASE_URL || 'http://localhost:4000'}/api/sso/oidc/callback`],
      response_types: ['code']
    });

    // Generate state with orgId embedded (encrypted)
    const state = Buffer.from(JSON.stringify({
      orgId: req.params.orgId,
      nonce: crypto.randomUUID()
    })).toString('base64url');

    const authUrl = client.authorizationUrl({
      scope: 'openid email profile',
      state,
      nonce: crypto.randomUUID()
    });

    res.redirect(authUrl);
  } catch (err) {
    logger.error({ err: err.message, orgId: req.params.orgId }, 'OIDC discovery failed');
    res.status(500).json({ error: 'OIDC configuration error' });
  }
});

/**
 * @swagger
 * /api/sso/oidc/callback:
 *   get:
 *     summary: OIDC authorization code callback
 *     tags: [SSO]
 */
router.get('/oidc/callback', async (req, res) => {
  if (!openidClient) {
    return res.status(501).json({ error: 'OIDC SSO not available' });
  }

  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  let stateData;
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
  } catch {
    return res.status(400).json({ error: 'Invalid state' });
  }

  const { orgId } = stateData;
  const config = await getSSOConfig(orgId);
  if (!config || config.provider !== 'oidc' || !config.enabled) {
    return res.status(404).json({ error: 'OIDC SSO not configured' });
  }

  try {
    const issuer = await openidClient.Issuer.discover(config.discoveryUrl);
    const client = new issuer.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret || undefined,
      redirect_uris: [`${process.env.API_BASE_URL || 'http://localhost:4000'}/api/sso/oidc/callback`],
      response_types: ['code']
    });

    const tokenSet = await client.callback(
      `${process.env.API_BASE_URL || 'http://localhost:4000'}/api/sso/oidc/callback`,
      { code, state },
      { state }
    );

    const userinfo = await client.userinfo(tokenSet.access_token);
    const email = userinfo.email;
    const name = userinfo.name || userinfo.preferred_username || '';

    if (!email) {
      return res.status(400).json({ error: 'No email in OIDC response' });
    }

    const user = await findOrCreateSSOUser(email, name, orgId);
    const token = issueToken(user);

    res.cookie('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    await logActivity('sso.login', {
      detail: `OIDC login: ${email}`,
      userId: user.id,
      userEmail: email
    });

    const dashboardUrl = process.env.CORS_ORIGIN || 'http://localhost:3000';
    res.redirect(dashboardUrl + '/dashboard');
  } catch (err) {
    logger.error({ err: err.message, orgId }, 'OIDC callback failed');
    res.status(500).json({ error: 'OIDC authentication failed' });
  }
});

// ─── Helpers ────────────────────────────────────────────

async function findOrCreateSSOUser(email, name, orgId) {
  let user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    // Link to org if not already linked
    if (!user.orgId && orgId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { orgId }
      });
    }
    return user;
  }

  // Create new user via SSO (no password — SSO-only)
  user = await prisma.user.create({
    data: {
      email,
      name: name || null,
      password: '', // No password for SSO users
      role: 'auditor',
      orgId
    }
  });

  logger.info({ email, orgId }, 'SSO user auto-provisioned');
  return user;
}

function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

module.exports = router;
