const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  saveIntegration, getIntegrations, deleteIntegration, notifyIntegrations,
  clmPullContracts, grcPushResults,
  saveSsoConfig, getSsoConfig, deleteSsoConfig,
  createCustomFramework, getCustomFrameworks, getCustomFramework,
  updateCustomFramework, deleteCustomFramework,
  getAlerts, markAlertRead, markAllAlertsRead, generateRegulatoryAlerts
} = require('../lib/integrations');

const router = express.Router();
router.use(authMiddleware);

// ─── Integration Configs ──────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const integrations = await getIntegrations(req.user.id, req.user.orgId);
    res.json({ integrations });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { provider, type, config, active } = req.body;
    if (!provider || !type) return res.status(400).json({ error: 'provider and type required' });
    const integration = await saveIntegration(req.user.id, req.user.orgId, { provider, type, config, active });
    res.status(201).json(integration);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteIntegration(req.params.id, req.user.id, req.user.orgId);
    res.json({ message: 'Integration removed' });
  } catch (err) { next(err); }
});

/** Test integration notification */
router.post('/test-notify', async (req, res, next) => {
  try {
    const result = await notifyIntegrations(req.user.id, req.user.orgId, {
      title: 'Test Notification from Auleg',
      message: 'This is a test notification to verify your integration is working.',
      text: '[Auleg] Test notification — integration is working!'
    });
    res.json({ results: result });
  } catch (err) { next(err); }
});

// ─── CLM Connectors ──────────────────────────────────

router.get('/clm/:provider/contracts', async (req, res, next) => {
  try {
    const result = await clmPullContracts(req.user.id, req.user.orgId, req.params.provider);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── GRC Sync ─────────────────────────────────────────

router.post('/grc/:provider/push', async (req, res, next) => {
  try {
    const result = await grcPushResults(req.user.id, req.user.orgId, req.params.provider, req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── SSO/SAML ─────────────────────────────────────────

router.get('/sso', async (req, res, next) => {
  try {
    if (!req.user.orgId) return res.status(400).json({ error: 'Organization required for SSO' });
    const config = await getSsoConfig(req.user.orgId);
    res.json({ sso: config });
  } catch (err) { next(err); }
});

router.post('/sso', async (req, res, next) => {
  try {
    if (!req.user.orgId) return res.status(400).json({ error: 'Organization required for SSO' });
    const { provider, entityId, ssoUrl, certificate, metadataUrl } = req.body;
    if (!provider || !entityId || !ssoUrl || !certificate) {
      return res.status(400).json({ error: 'provider, entityId, ssoUrl, and certificate required' });
    }
    const config = await saveSsoConfig(req.user.orgId, req.body);
    res.status(201).json(config);
  } catch (err) { next(err); }
});

router.delete('/sso', async (req, res, next) => {
  try {
    if (!req.user.orgId) return res.status(400).json({ error: 'Organization required' });
    await deleteSsoConfig(req.user.orgId);
    res.json({ message: 'SSO config removed' });
  } catch (err) { next(err); }
});

// ─── Custom Frameworks ───────────────────────────────

router.get('/frameworks', async (req, res, next) => {
  try {
    const frameworks = await getCustomFrameworks(req.user.id, req.user.orgId);
    res.json({ frameworks });
  } catch (err) { next(err); }
});

router.post('/frameworks', async (req, res, next) => {
  try {
    const { name, description, clauses } = req.body;
    if (!name || !clauses) return res.status(400).json({ error: 'name and clauses required' });
    const fw = await createCustomFramework(req.user.id, req.user.orgId, req.body);
    res.status(201).json(fw);
  } catch (err) { next(err); }
});

router.get('/frameworks/:id', async (req, res, next) => {
  try {
    const fw = await getCustomFramework(req.params.id, req.user.id, req.user.orgId);
    if (!fw) return res.status(404).json({ error: 'Not found' });
    res.json(fw);
  } catch (err) { next(err); }
});

router.put('/frameworks/:id', async (req, res, next) => {
  try {
    const fw = await updateCustomFramework(req.params.id, req.user.id, req.user.orgId, req.body);
    res.json(fw);
  } catch (err) { next(err); }
});

router.delete('/frameworks/:id', async (req, res, next) => {
  try {
    await deleteCustomFramework(req.params.id, req.user.id, req.user.orgId);
    res.json({ message: 'Framework deleted' });
  } catch (err) { next(err); }
});

// ─── Regulatory Alerts ───────────────────────────────

router.get('/alerts', async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const alerts = await getAlerts(req.user.id, unreadOnly);
    res.json({ alerts });
  } catch (err) { next(err); }
});

router.post('/alerts/generate', async (req, res, next) => {
  try {
    const alerts = await generateRegulatoryAlerts(req.user.id);
    res.json({ generated: alerts.length, alerts });
  } catch (err) { next(err); }
});

router.patch('/alerts/:id/read', async (req, res, next) => {
  try {
    await markAlertRead(req.params.id, req.user.id);
    res.json({ message: 'Alert marked as read' });
  } catch (err) { next(err); }
});

router.post('/alerts/read-all', async (req, res, next) => {
  try {
    await markAllAlertsRead(req.user.id);
    res.json({ message: 'All alerts marked as read' });
  } catch (err) { next(err); }
});

module.exports = router;
