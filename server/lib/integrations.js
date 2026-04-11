/**
 * Integration Engine
 * 
 * Handles CLM connectors (Ironclad, Juro, DocuSign CLM),
 * GRC sync (OneTrust, TrustArc, Vanta),
 * Slack/Teams notifications, and SSO/SAML config.
 */

const crypto = require('crypto');
const prisma = require('./prisma');

// ─── Integration Config Management ───────────────────

async function saveIntegration(userId, orgId, data) {
  const existing = await prisma.integrationConfig.findFirst({
    where: { userId, provider: data.provider }
  });

  const configJson = JSON.stringify(data.config || {});

  if (existing) {
    return prisma.integrationConfig.update({
      where: { id: existing.id },
      data: {
        config: configJson,
        active: data.active !== false,
        type: data.type
      }
    });
  }

  return prisma.integrationConfig.create({
    data: {
      provider: data.provider,
      type: data.type,
      config: configJson,
      userId,
      orgId,
      active: data.active !== false
    }
  });
}

async function getIntegrations(userId, orgId) {
  const where = orgId ? { orgId } : { userId };
  const integrations = await prisma.integrationConfig.findMany({ where, orderBy: { provider: 'asc' } });
  return integrations.map(i => ({
    ...i,
    config: safeParseConfig(i.config)
  }));
}

async function deleteIntegration(id) {
  return prisma.integrationConfig.delete({ where: { id } });
}

function safeParseConfig(configStr) {
  try {
    const config = JSON.parse(configStr);
    // Mask sensitive fields
    const masked = { ...config };
    if (masked.apiKey) masked.apiKey = masked.apiKey.substring(0, 8) + '***';
    if (masked.secret) masked.secret = '***';
    if (masked.webhookUrl) masked.webhookUrl = masked.webhookUrl; // keep URL visible
    return masked;
  } catch { return {}; }
}

// ─── Slack/Teams Notifications ────────────────────────

async function sendSlackNotification(userId, orgId, payload) {
  const config = await prisma.integrationConfig.findFirst({
    where: { provider: 'slack', active: true, ...(orgId ? { orgId } : { userId }) }
  });
  if (!config) return null;

  const { webhookUrl, channel } = JSON.parse(config.config);
  if (!webhookUrl) return null;

  try {
    const body = {
      channel: channel || undefined,
      text: payload.text,
      blocks: payload.blocks || [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${payload.title}*\n${payload.message}` }
        }
      ]
    };

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await prisma.integrationConfig.update({
      where: { id: config.id },
      data: { lastSyncAt: new Date() }
    });

    return { sent: resp.ok, status: resp.status };
  } catch (err) {
    console.error('Slack notification failed:', err.message);
    return { sent: false, error: err.message };
  }
}

async function sendTeamsNotification(userId, orgId, payload) {
  const config = await prisma.integrationConfig.findFirst({
    where: { provider: 'teams', active: true, ...(orgId ? { orgId } : { userId }) }
  });
  if (!config) return null;

  const { webhookUrl } = JSON.parse(config.config);
  if (!webhookUrl) return null;

  try {
    const body = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      summary: payload.title,
      themeColor: payload.color || '6366F1',
      title: payload.title,
      sections: [{
        activityTitle: payload.title,
        facts: payload.facts || [{ name: 'Details', value: payload.message }],
        markdown: true
      }]
    };

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await prisma.integrationConfig.update({
      where: { id: config.id },
      data: { lastSyncAt: new Date() }
    });

    return { sent: resp.ok, status: resp.status };
  } catch (err) {
    console.error('Teams notification failed:', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Send notification to all configured channels.
 */
async function notifyIntegrations(userId, orgId, event) {
  const results = {};
  results.slack = await sendSlackNotification(userId, orgId, event);
  results.teams = await sendTeamsNotification(userId, orgId, event);
  return results;
}

// ─── CLM Connector Stubs ─────────────────────────────
// These provide the interface for CLM integrations.
// Actual API calls require customer-specific API keys.

async function clmPullContracts(userId, orgId, provider) {
  const config = await prisma.integrationConfig.findFirst({
    where: { provider, type: 'clm', active: true, ...(orgId ? { orgId } : { userId }) }
  });
  if (!config) throw new Error(`No active ${provider} integration configured`);

  const parsed = JSON.parse(config.config);

  // Return stub response — real implementation would call the CLM API
  return {
    provider,
    status: 'connected',
    message: `${provider} integration is configured. Contract pull would use API key ending in ...${(parsed.apiKey || '').slice(-4)}.`,
    contracts: [],
    note: 'Real CLM API integration requires provider-specific SDK. This endpoint validates the configuration.'
  };
}

// ─── GRC Sync Stubs ──────────────────────────────────

async function grcPushResults(userId, orgId, provider, auditData) {
  const config = await prisma.integrationConfig.findFirst({
    where: { provider, type: 'grc', active: true, ...(orgId ? { orgId } : { userId }) }
  });
  if (!config) throw new Error(`No active ${provider} integration configured`);

  return {
    provider,
    status: 'connected',
    message: `Audit results would be pushed to ${provider}.`,
    payload: {
      auditId: auditData.auditId,
      riskScore: auditData.riskScore,
      overallRisk: auditData.overallRisk,
      clauseCount: auditData.clauseCount,
      gapsFound: auditData.gapsFound
    },
    note: 'Real GRC API integration requires provider-specific SDK.'
  };
}

// ─── SSO/SAML Config ─────────────────────────────────

async function saveSsoConfig(orgId, data) {
  const existing = await prisma.ssoConfig.findUnique({ where: { orgId } });

  if (existing) {
    return prisma.ssoConfig.update({
      where: { orgId },
      data: {
        provider: data.provider,
        entityId: data.entityId,
        ssoUrl: data.ssoUrl,
        certificate: data.certificate,
        metadataUrl: data.metadataUrl,
        active: data.active !== false
      }
    });
  }

  return prisma.ssoConfig.create({
    data: {
      orgId,
      provider: data.provider,
      entityId: data.entityId,
      ssoUrl: data.ssoUrl,
      certificate: data.certificate,
      metadataUrl: data.metadataUrl,
      active: data.active !== false
    }
  });
}

async function getSsoConfig(orgId) {
  const config = await prisma.ssoConfig.findUnique({ where: { orgId } });
  if (!config) return null;
  // Mask certificate
  return {
    ...config,
    certificate: config.certificate ? `${config.certificate.substring(0, 40)}...` : null
  };
}

async function deleteSsoConfig(orgId) {
  return prisma.ssoConfig.delete({ where: { orgId } });
}

// ─── Custom Frameworks ───────────────────────────────

async function createCustomFramework(userId, orgId, data) {
  return prisma.customFramework.create({
    data: {
      name: data.name,
      description: data.description,
      clauses: JSON.stringify(data.clauses || []),
      userId,
      orgId,
      isPublic: data.isPublic || false
    }
  });
}

async function getCustomFrameworks(userId, orgId) {
  const frameworks = await prisma.customFramework.findMany({
    where: {
      OR: [
        { userId },
        ...(orgId ? [{ orgId }] : []),
        { isPublic: true }
      ]
    },
    orderBy: { name: 'asc' }
  });
  return frameworks.map(f => ({
    ...f,
    clauses: JSON.parse(f.clauses || '[]')
  }));
}

async function getCustomFramework(id) {
  const f = await prisma.customFramework.findUnique({ where: { id } });
  if (!f) return null;
  return { ...f, clauses: JSON.parse(f.clauses || '[]') };
}

async function updateCustomFramework(id, data) {
  return prisma.customFramework.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      clauses: data.clauses ? JSON.stringify(data.clauses) : undefined,
      isPublic: data.isPublic
    }
  });
}

async function deleteCustomFramework(id) {
  return prisma.customFramework.delete({ where: { id } });
}

// ─── Regulatory Alerts ───────────────────────────────

async function createAlert(userId, data) {
  return prisma.regulatoryAlert.create({
    data: {
      type: data.type,
      title: data.title,
      summary: data.summary,
      regulation: data.regulation,
      affectedClauses: data.affectedClauses || '',
      severity: data.severity || 'info',
      sourceUrl: data.sourceUrl,
      userId
    }
  });
}

async function getAlerts(userId, unreadOnly = false) {
  const where = { userId };
  if (unreadOnly) where.read = false;
  return prisma.regulatoryAlert.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50
  });
}

async function markAlertRead(id) {
  return prisma.regulatoryAlert.update({
    where: { id },
    data: { read: true }
  });
}

async function markAllAlertsRead(userId) {
  return prisma.regulatoryAlert.updateMany({
    where: { userId, read: false },
    data: { read: true }
  });
}

/**
 * Check enforcement actions and generate alerts for users whose DPAs 
 * may be affected by new enforcement/guidance.
 */
async function generateRegulatoryAlerts(userId) {
  // Get recent enforcement and guidance
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const enforcement = await prisma.enforcementAction.findMany({
    where: { createdAt: { gte: oneMonthAgo } }
  });
  const guidance = await prisma.regulatoryGuidance.findMany({
    where: { createdAt: { gte: oneMonthAgo } }
  });

  const alerts = [];

  for (const e of enforcement) {
    const existing = await prisma.regulatoryAlert.findFirst({
      where: { userId, title: `Enforcement: ${e.entity}` }
    });
    if (existing) continue;

    alerts.push(await createAlert(userId, {
      type: 'enforcement',
      title: `Enforcement: ${e.entity}`,
      summary: `${e.authority} fined ${e.entity} ${e.fineAmount ? '€' + e.fineAmount.toLocaleString() : 'N/A'}. ${e.summary}`,
      regulation: e.regulation,
      affectedClauses: e.clauseImpact,
      severity: e.severity === 'critical' ? 'critical' : e.severity === 'high' ? 'warning' : 'info',
      sourceUrl: e.sourceUrl
    }));
  }

  for (const g of guidance) {
    const existing = await prisma.regulatoryAlert.findFirst({
      where: { userId, title: `Guidance: ${g.title}` }
    });
    if (existing) continue;

    alerts.push(await createAlert(userId, {
      type: 'guidance',
      title: `Guidance: ${g.title}`,
      summary: `${g.authority}: ${g.summary}`,
      regulation: g.regulation,
      affectedClauses: g.clauseImpact,
      severity: 'info',
      sourceUrl: g.sourceUrl
    }));
  }

  return alerts;
}

module.exports = {
  // Integrations
  saveIntegration,
  getIntegrations,
  deleteIntegration,
  notifyIntegrations,
  // CLM
  clmPullContracts,
  // GRC
  grcPushResults,
  // SSO
  saveSsoConfig,
  getSsoConfig,
  deleteSsoConfig,
  // Custom Frameworks
  createCustomFramework,
  getCustomFrameworks,
  getCustomFramework,
  updateCustomFramework,
  deleteCustomFramework,
  // Alerts
  createAlert,
  getAlerts,
  markAlertRead,
  markAllAlertsRead,
  generateRegulatoryAlerts
};
