const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)auleg_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function apiFetch(path, options = {}) {
  const { handleAuthFailure = true, ...fetchOptions } = options;
  const headers = { ...fetchOptions.headers };

  if (!(fetchOptions.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // Include CSRF token for state-changing requests
  const method = (fetchOptions.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
    credentials: 'include'
  });

  if (res.status === 401 && handleAuthFailure) {
    window.location.reload();
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }

  if (res.status === 204) return null;
  return res.json();
}

export async function login(email, password) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    handleAuthFailure: false
  });
  return data.user;
}

export async function register(email, password, name) {
  const data = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
    handleAuthFailure: false
  });
  return data.user;
}

export function logout() {
  return fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    keepalive: true
  }).catch(() => null);
}

export async function getMe() {
  return apiFetch('/auth/me', { handleAuthFailure: false });
}

export async function listAudits(page = 1, limit = 20) {
  return apiFetch(`/audits?page=${page}&limit=${limit}`);
}

export async function getAudit(id) {
  return apiFetch(`/audits/${id}`);
}

export async function uploadAndAudit(file) {
  const formData = new FormData();
  formData.append('contract', file);
  return apiFetch('/audits', { method: 'POST', body: formData });
}

export async function deleteAudit(id) {
  return apiFetch(`/audits/${id}`, { method: 'DELETE' });
}

// --- Export ---
export function exportJsonUrl(id) {
  return `${API_BASE}/export/${id}/json`;
}

export async function exportCsv(id) {
  const res = await fetch(`${API_BASE}/export/${id}/csv`, {
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  return blob;
}

export async function exportJson(id) {
  const res = await fetch(`${API_BASE}/export/${id}/json`, {
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  return blob;
}

// --- Compare ---
export async function compareAudits(auditA, auditB) {
  return apiFetch('/export/compare', {
    method: 'POST',
    body: JSON.stringify({ auditA, auditB })
  });
}

// --- Admin ---
export async function adminListUsers(page = 1, limit = 50) {
  return apiFetch(`/admin/users?page=${page}&limit=${limit}`);
}

export async function adminChangeRole(userId, role) {
  return apiFetch(`/admin/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role })
  });
}

export async function adminDeleteUser(userId) {
  return apiFetch(`/admin/users/${userId}`, { method: 'DELETE' });
}

export async function adminGetActivity(page = 1, limit = 50) {
  return apiFetch(`/admin/activity?page=${page}&limit=${limit}`);
}

export async function adminGetStats() {
  return apiFetch('/admin/stats');
}

// --- Org ---
export async function createOrg(name) {
  return apiFetch('/orgs', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function getMyOrg() {
  return apiFetch('/orgs/mine');
}

export async function inviteToOrg(email, role) {
  return apiFetch('/orgs/invite', {
    method: 'POST',
    body: JSON.stringify({ email, role })
  });
}

export async function removeFromOrg(userId) {
  return apiFetch(`/orgs/members/${userId}`, { method: 'DELETE' });
}

// --- Batch Upload ---
export async function batchUpload(files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('contracts', file);
  }
  return apiFetch('/audits/batch', { method: 'POST', body: formData });
}

// --- Queue Status ---
export async function getQueueStatus() {
  return apiFetch('/audits/queue');
}

// --- Webhooks ---
export async function listWebhooks() {
  return apiFetch('/webhooks');
}

export async function createWebhook(url, events) {
  return apiFetch('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ url, events })
  });
}

export async function updateWebhook(id, data) {
  return apiFetch(`/webhooks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export async function deleteWebhook(id) {
  return apiFetch(`/webhooks/${id}`, { method: 'DELETE' });
}

// --- Templates ---
export async function listTemplates() {
  return apiFetch('/templates');
}

export async function createTemplate(data) {
  return apiFetch('/templates', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateTemplate(id, data) {
  return apiFetch(`/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteTemplate(id) {
  return apiFetch(`/templates/${id}`, { method: 'DELETE' });
}

// --- Notifications ---
export async function listNotifications(unreadOnly = false) {
  return apiFetch(`/notifications${unreadOnly ? '?unreadOnly=true' : ''}`);
}

export async function markRead(id) {
  return apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
}

export async function markAllRead() {
  return apiFetch('/notifications/read-all', { method: 'PATCH' });
}

// --- API Keys ---
export async function listApiKeys() {
  return apiFetch('/api-keys');
}

export async function createApiKey(name, scopes, expiresInDays) {
  return apiFetch('/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name, scopes, expiresInDays: expiresInDays || null })
  });
}

export async function deleteApiKey(id) {
  return apiFetch(`/api-keys/${id}`, { method: 'DELETE' });
}

// --- Analytics ---
export async function getAnalyticsOverview() {
  return apiFetch('/analytics/overview');
}

export async function getAnalyticsTrend(days = 30) {
  return apiFetch(`/analytics/trend?days=${days}`);
}

// --- Search/Filter Audits ---
export async function searchAudits({ search, status, risk, sort, order, from, to, page, limit } = {}) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (risk) params.set('risk', risk);
  if (sort) params.set('sort', sort);
  if (order) params.set('order', order);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (page) params.set('page', page);
  if (limit) params.set('limit', limit);
  return apiFetch(`/audits?${params.toString()}`);
}

// --- Re-audit / Versioning ---
export async function reAudit(id) {
  return apiFetch(`/audits/${id}/re-audit`, { method: 'POST' });
}

export async function getVersions(id) {
  return apiFetch(`/audits/${id}/versions`);
}

// --- Sharing ---
export async function shareAudit(auditId, email, permission, expiresInDays) {
  return apiFetch('/shares', {
    method: 'POST',
    body: JSON.stringify({ auditId, email, permission: permission || 'view', expiresInDays: expiresInDays || null })
  });
}

export async function getSharedWithMe() {
  return apiFetch('/shares/mine');
}

export async function getAuditShares(auditId) {
  return apiFetch(`/shares/audit/${auditId}`);
}

export async function getSharedByToken(token) {
  return apiFetch(`/shares/token/${token}`);
}

export async function revokeShare(id) {
  return apiFetch(`/shares/${id}`, { method: 'DELETE' });
}

// --- Schedules ---
export async function listSchedules() {
  return apiFetch('/schedules');
}

export async function createSchedule(name, auditId, cron, templateId) {
  return apiFetch('/schedules', {
    method: 'POST',
    body: JSON.stringify({ name, auditId, cron, templateId: templateId || null })
  });
}

export async function updateSchedule(id, data) {
  return apiFetch(`/schedules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export async function deleteSchedule(id) {
  return apiFetch(`/schedules/${id}`, { method: 'DELETE' });
}

// --- Scoring Rules ---
export async function listScoringRules() {
  return apiFetch('/scoring-rules');
}

export async function createScoringRule(data) {
  return apiFetch('/scoring-rules', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateScoringRule(id, data) {
  return apiFetch(`/scoring-rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteScoringRule(id) {
  return apiFetch(`/scoring-rules/${id}`, { method: 'DELETE' });
}

// --- Comments ---
export async function listComments(auditId) {
  return apiFetch(`/comments/${auditId}`);
}

export async function addComment(auditId, body, clause, parentId) {
  return apiFetch(`/comments/${auditId}`, {
    method: 'POST',
    body: JSON.stringify({ body, clause: clause || null, parentId: parentId || null })
  });
}

export async function editComment(auditId, commentId, body) {
  return apiFetch(`/comments/${auditId}/${commentId}`, {
    method: 'PUT',
    body: JSON.stringify({ body })
  });
}

export async function deleteComment(auditId, commentId) {
  return apiFetch(`/comments/${auditId}/${commentId}`, { method: 'DELETE' });
}

// --- Tags ---
export async function updateTags(auditId, tags) {
  return apiFetch(`/audits/${auditId}/tags`, {
    method: 'PATCH',
    body: JSON.stringify({ tags })
  });
}

// --- Version Diff ---
export async function getVersionDiff(id, compareId) {
  return apiFetch(`/audits/${id}/diff/${compareId}`);
}

// --- Compliance Report ---
export async function getComplianceReport(auditId) {
  return apiFetch(`/audits/${auditId}/compliance`);
}

// --- User Preferences ---
export async function getPreferences() {
  return apiFetch('/preferences');
}

export async function updatePreferences(data) {
  return apiFetch('/preferences', {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

// --- Billing ---
export async function getPlans() {
  return apiFetch('/billing/plans');
}

export async function getBillingAccount() {
  return apiFetch('/billing/account');
}

export async function getBillingUsage() {
  return apiFetch('/billing/usage');
}

export async function upgradePlan(plan) {
  return apiFetch('/billing/upgrade', {
    method: 'POST',
    body: JSON.stringify({ plan })
  });
}

export async function getBillingEvents() {
  return apiFetch('/billing/events');
}

export async function createBillingPortal() {
  return apiFetch('/billing/portal', { method: 'POST' });
}

// --- AI ---
export async function aiSummary(auditId) {
  return apiFetch(`/ai/summary/${auditId}`, { method: 'POST' });
}

export async function aiAnalyze(auditId, clause) {
  return apiFetch(`/ai/analyze/${auditId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clause ? { clause } : {})
  });
}

export async function aiRemediate(auditId) {
  return apiFetch(`/ai/remediate/${auditId}`, { method: 'POST' });
}

export async function aiExplain(auditId) {
  return apiFetch(`/ai/explain/${auditId}`, { method: 'POST' });
}

export async function aiSearch(query) {
  return apiFetch('/ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
}

// --- Public API v1 ---
export async function v1ListAudits(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/v1/audits${qs ? '?' + qs : ''}`);
}

export async function v1GetAudit(id) {
  return apiFetch(`/v1/audits/${id}`);
}

export async function v1GetReport(id, format = 'json') {
  return apiFetch(`/v1/audits/${id}/report?format=${format}`);
}

export async function v1AiSummary(id) {
  return apiFetch(`/v1/audits/${id}/ai/summary`, { method: 'POST' });
}

export async function v1ListWebhooks() {
  return apiFetch('/v1/webhooks');
}

export async function v1WebhookDeliveries(id) {
  return apiFetch(`/v1/webhooks/${id}/deliveries`);
}

export async function v1RetryDelivery(webhookId, deliveryId) {
  return apiFetch(`/v1/webhooks/${webhookId}/deliveries/${deliveryId}/retry`, { method: 'POST' });
}

export async function v1ListTemplates() {
  return apiFetch('/v1/templates');
}

export async function v1SlackPayload(auditId) {
  return apiFetch('/v1/integrations/slack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auditId })
  });
}

export async function v1ZapierTrigger(since) {
  return apiFetch('/v1/integrations/zapier', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ since })
  });
}

// ─── Legal API ────────────────────────────────────────

export async function legalGetRegulations() {
  return apiFetch('/legal/regulations');
}

export async function legalGetRegulation(code) {
  return apiFetch(`/legal/regulations/${code}`);
}

export async function legalSearchArticles(query) {
  return apiFetch(`/legal/articles/search?q=${encodeURIComponent(query)}`);
}

export async function legalGetEnforcement(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/legal/enforcement${qs ? '?' + qs : ''}`);
}

export async function legalGetGuidance(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/legal/guidance${qs ? '?' + qs : ''}`);
}

export async function legalGetTrends() {
  return apiFetch('/legal/trends');
}

export async function legalChat(message, chatId, auditId) {
  return apiFetch('/legal/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, chatId, auditId })
  });
}

export async function legalGetChats() {
  return apiFetch('/legal/chats');
}

export async function legalGetChat(id) {
  return apiFetch(`/legal/chats/${id}`);
}

export async function legalDraftClause(clauseType, regulation, currentLanguage) {
  return apiFetch('/legal/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clauseType, regulation, currentLanguage })
  });
}

export async function legalSeedDatabase() {
  return apiFetch('/legal/seed', { method: 'POST' });
}

// ─── Core Advanced API ────────────────────────────────

export async function runRedlineAnalysis(auditId, text) {
  return apiFetch(`/core/redline/${auditId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
}

export async function getRedlines(auditId, filters) {
  const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
  return apiFetch(`/core/redline/${auditId}${qs}`);
}

export async function updateRedlineStatus(id, status, modifiedText) {
  return apiFetch(`/core/redline/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, modifiedText })
  });
}

export async function applyRedlines(auditId) {
  return apiFetch(`/core/redline/${auditId}/apply`, { method: 'POST' });
}

export async function getJurisdictions(auditId) {
  return apiFetch(`/core/jurisdictions/${auditId}`);
}

export async function getGapMatrix(auditId) {
  return apiFetch(`/core/gap-matrix/${auditId}`);
}

export async function getConfidenceScores(auditId) {
  return apiFetch(`/core/confidence/${auditId}`);
}

// ─── Workflow API ─────────────────────────────────────

export async function createNegotiation(data) {
  return apiFetch('/workflow/negotiations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function getNegotiations() {
  return apiFetch('/workflow/negotiations');
}

export async function getNegotiation(id) {
  return apiFetch(`/workflow/negotiations/${id}`);
}

export async function addNegotiationRound(id, data) {
  return apiFetch(`/workflow/negotiations/${id}/rounds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function updateNegotiationStatus(id, status) {
  return apiFetch(`/workflow/negotiations/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
}

export async function updateNegotiationClause(id, data) {
  return apiFetch(`/workflow/negotiation-clauses/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function createApprovalChain(auditId, steps) {
  return apiFetch('/workflow/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auditId, steps })
  });
}

export async function getApprovalChains(auditId) {
  return apiFetch(`/workflow/approvals/${auditId}`);
}

export async function processApprovalStep(stepId, decision, comments) {
  return apiFetch(`/workflow/approvals/steps/${stepId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, comments })
  });
}

export async function createCounterpartyLink(data) {
  return apiFetch('/workflow/counterparty/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function getCounterpartyLinks() {
  return apiFetch('/workflow/counterparty/links');
}

export async function getVendorAssessments() {
  return apiFetch('/workflow/vendor-assessments');
}

export async function getVendorAssessment(id) {
  return apiFetch(`/workflow/vendor-assessments/${id}`);
}

export async function createVendorAssessment(name) {
  return apiFetch('/workflow/vendor-assessments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
}

export async function getBundles() {
  return apiFetch('/workflow/bundles');
}

export async function getBundle(id) {
  return apiFetch(`/workflow/bundles/${id}`);
}

// ─── Reporting API ────────────────────────────────────

export async function getBoardReport(auditId) {
  return apiFetch(`/reporting/board-report/${auditId}`);
}

export async function issueCertificate(data) {
  return apiFetch('/reporting/certificates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function getCertificates() {
  return apiFetch('/reporting/certificates');
}

export async function verifyCertificate(certNumber) {
  return apiFetch(`/reporting/verify/${certNumber}`);
}

export async function getEvidenceTrail(auditId) {
  return apiFetch(`/reporting/evidence/${auditId}`);
}

export async function getEvidencePack(auditId) {
  return apiFetch(`/reporting/evidence-pack/${auditId}`);
}

export async function getBenchmarks() {
  return apiFetch('/reporting/benchmarks');
}

export async function refreshBenchmarks() {
  return apiFetch('/reporting/benchmarks/refresh', { method: 'POST' });
}

export async function autoRemediate(auditId) {
  return apiFetch(`/reporting/auto-remediate/${auditId}`, { method: 'POST' });
}

// ─── Integrations API ─────────────────────────────────

export async function getIntegrations() {
  return apiFetch('/integrations');
}

export async function saveIntegration(data) {
  return apiFetch('/integrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function deleteIntegration(id) {
  return apiFetch(`/integrations/${id}`, { method: 'DELETE' });
}

export async function testIntegrationNotify() {
  return apiFetch('/integrations/test-notify', { method: 'POST' });
}

export async function getCustomFrameworks() {
  return apiFetch('/integrations/frameworks');
}

export async function createCustomFramework(data) {
  return apiFetch('/integrations/frameworks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function deleteCustomFramework(id) {
  return apiFetch(`/integrations/frameworks/${id}`, { method: 'DELETE' });
}

export async function getRegulatoryAlerts(unread) {
  return apiFetch(`/integrations/alerts${unread ? '?unread=true' : ''}`);
}

export async function generateRegulatoryAlerts() {
  return apiFetch('/integrations/alerts/generate', { method: 'POST' });
}

export async function markAlertRead(id) {
  return apiFetch(`/integrations/alerts/${id}/read`, { method: 'PATCH' });
}

export async function getSsoConfig() {
  return apiFetch('/integrations/sso');
}

export async function saveSsoConfig(data) {
  return apiFetch('/integrations/sso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function checkBetaStatus() {
  const res = await fetch(`${API_BASE}/health`, { credentials: 'include' });
  const data = await res.json();
  return data.beta === true;
}
