import React, { useState, useEffect } from 'react';
import { v1ListAudits, v1GetAudit, v1AiSummary, v1ListWebhooks, v1WebhookDeliveries, v1ListTemplates, v1SlackPayload, v1ZapierTrigger, listApiKeys, createApiKey } from './api';

const ENDPOINTS = [
  { id: 'list-audits', method: 'GET', path: '/api/v1/audits', scope: 'audits:read', desc: 'List all audits with pagination' },
  { id: 'get-audit', method: 'GET', path: '/api/v1/audits/:id', scope: 'audits:read', desc: 'Get single audit detail' },
  { id: 'get-report', method: 'GET', path: '/api/v1/audits/:id/report', scope: 'audits:read', desc: 'Download audit report' },
  { id: 'ai-summary', method: 'POST', path: '/api/v1/audits/:id/ai/summary', scope: 'audits:read', desc: 'AI executive summary' },
  { id: 'ai-analyze', method: 'POST', path: '/api/v1/audits/:id/ai/analyze', scope: 'audits:read', desc: 'AI clause analysis' },
  { id: 'list-webhooks', method: 'GET', path: '/api/v1/webhooks', scope: 'webhooks:read', desc: 'List webhooks' },
  { id: 'webhook-deliveries', method: 'GET', path: '/api/v1/webhooks/:id/deliveries', scope: 'webhooks:read', desc: 'Webhook delivery log' },
  { id: 'list-templates', method: 'GET', path: '/api/v1/templates', scope: 'templates:read', desc: 'List audit templates' },
  { id: 'slack', method: 'POST', path: '/api/v1/integrations/slack', scope: 'audits:read', desc: 'Slack message payload' },
  { id: 'zapier', method: 'POST', path: '/api/v1/integrations/zapier', scope: 'audits:read', desc: 'Zapier trigger poll' },
];

const methodColors = { GET: '#22c55e', POST: '#3b82f6', PUT: '#eab308', DELETE: '#ef4444' };

export default function ApiExplorerPage({ onBack }) {
  const [selectedEndpoint, setSelectedEndpoint] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [paramId, setParamId] = useState('');
  const [apiKeys, setApiKeys] = useState([]);
  const [showKeyCreate, setShowKeyCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyResult, setNewKeyResult] = useState(null);

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    try {
      const d = await listApiKeys();
      setApiKeys(d.keys || []);
    } catch {}
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    try {
      const k = await createApiKey(newKeyName, ['audits:read', 'audits:write', 'webhooks:read', 'webhooks:write', 'templates:read', 'templates:write']);
      setNewKeyResult(k);
      setNewKeyName('');
      loadKeys();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  const handleTry = async (ep) => {
    setLoading(true);
    setResult(null);
    try {
      let data;
      switch (ep.id) {
        case 'list-audits': data = await v1ListAudits({ limit: 5 }); break;
        case 'get-audit': data = await v1GetAudit(paramId); break;
        case 'get-report': data = { note: 'Report download endpoint — use directly via API' }; break;
        case 'ai-summary': data = await v1AiSummary(paramId); break;
        case 'list-webhooks': data = await v1ListWebhooks(); break;
        case 'webhook-deliveries': data = await v1WebhookDeliveries(paramId); break;
        case 'list-templates': data = await v1ListTemplates(); break;
        case 'slack': data = await v1SlackPayload(paramId); break;
        case 'zapier': data = await v1ZapierTrigger(new Date(Date.now() - 7 * 86400000).toISOString()); break;
        default: data = { error: 'Not implemented in explorer' };
      }
      setResult(data);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>API Explorer</h1>
          <div className="subtitle">Public API v1 — Test endpoints and manage API keys</div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <a href="http://localhost:4000/api/docs" target="_blank" rel="noreferrer" className="nav-btn">Swagger Docs</a>
          <button className="nav-btn" onClick={onBack}>&larr; Dashboard</button>
        </div>
      </div>

      {/* API Keys Section */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ marginBottom: 0 }}>API Keys</h2>
          <button className="upload-btn" style={{ background: 'var(--accent-purple)' }} onClick={() => setShowKeyCreate(!showKeyCreate)}>
            {showKeyCreate ? 'Cancel' : 'New API Key'}
          </button>
        </div>

        {showKeyCreate && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. CI/CD Pipeline)" className="auth-input" style={{ marginBottom: 0, maxWidth: 300 }} />
            <button className="upload-btn" onClick={handleCreateKey}>Create</button>
          </div>
        )}

        {newKeyResult && (
          <div style={{ padding: 12, background: 'rgba(34,197,94,0.08)', borderRadius: 8, borderLeft: '3px solid var(--accent-green)', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>API Key Created — Copy it now! It won't be shown again.</div>
            <code style={{ fontSize: 13, color: 'var(--accent-green)', wordBreak: 'break-all' }}>{newKeyResult.key}</code>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>Scopes: {(newKeyResult.scopes || []).join(', ')}</div>
          </div>
        )}

        {apiKeys.length === 0 ? (
          <div className="subtitle">No API keys yet. Create one to use the Public API.</div>
        ) : (
          <table className="scores-table">
            <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last Used</th><th>Expires</th></tr></thead>
            <tbody>
              {apiKeys.map(k => (
                <tr key={k.id}>
                  <td className="clause-name">{k.name}</td>
                  <td><code>{k.prefix}...</code></td>
                  <td style={{ fontSize: 12 }}>{(k.scopes || []).join(', ')}</td>
                  <td>{k.lastUsed ? new Date(k.lastUsed).toLocaleDateString() : 'Never'}</td>
                  <td>{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Endpoints */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card">
          <h2>Endpoints</h2>
          {ENDPOINTS.map(ep => (
            <div key={ep.id}
              onClick={() => { setSelectedEndpoint(ep); setResult(null); }}
              style={{
                padding: '10px 12px', marginBottom: 6, borderRadius: 8, cursor: 'pointer',
                background: selectedEndpoint?.id === ep.id ? 'rgba(139,92,246,0.1)' : 'var(--bg-primary)',
                border: selectedEndpoint?.id === ep.id ? '1px solid var(--accent-purple)' : '1px solid var(--border)',
                transition: 'all 0.15s'
              }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: 11, fontWeight: 700, padding: '2px 6px',
                  borderRadius: 4, color: '#fff', background: methodColors[ep.method]
                }}>{ep.method}</span>
                <code style={{ fontSize: 13 }}>{ep.path}</code>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{ep.desc}</div>
              <div style={{ fontSize: 11, color: 'var(--accent-purple)', marginTop: 2 }}>scope: {ep.scope}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Try It</h2>
          {selectedEndpoint ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: 12, fontWeight: 700, padding: '2px 8px',
                  borderRadius: 4, color: '#fff', background: methodColors[selectedEndpoint.method]
                }}>{selectedEndpoint.method}</span>
                <code style={{ marginLeft: 8, fontSize: 14 }}>{selectedEndpoint.path}</code>
              </div>

              {selectedEndpoint.path.includes(':id') && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Resource ID:</label>
                  <input type="text" value={paramId} onChange={e => setParamId(e.target.value)}
                    placeholder="Enter audit or webhook ID..." className="auth-input" style={{ marginBottom: 0, marginTop: 4 }} />
                </div>
              )}

              <button className="upload-btn" onClick={() => handleTry(selectedEndpoint)} disabled={loading}
                style={{ marginBottom: 16 }}>
                {loading ? 'Loading...' : 'Send Request'}
              </button>

              {/* cURL example */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>cURL Example:</div>
                <pre style={{
                  background: 'var(--bg-primary)', padding: 12, borderRadius: 8, fontSize: 12,
                  overflowX: 'auto', whiteSpace: 'pre-wrap', border: '1px solid var(--border)'
                }}>
{`curl -X ${selectedEndpoint.method} \\
  http://localhost:4000${selectedEndpoint.path.replace(':id', '<ID>')} \\
  -H "Authorization: Bearer dpa_YOUR_API_KEY" \\
  -H "Content-Type: application/json"`}
                </pre>
              </div>

              {result && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Response:</div>
                  <pre style={{
                    background: 'var(--bg-primary)', padding: 12, borderRadius: 8, fontSize: 12,
                    maxHeight: 400, overflowY: 'auto', overflowX: 'auto', whiteSpace: 'pre-wrap',
                    border: '1px solid var(--border)', color: result.error ? 'var(--accent-red)' : 'var(--text-primary)'
                  }}>
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="subtitle">Select an endpoint from the left to try it out.</div>
          )}
        </div>
      </div>
    </div>
  );
}
