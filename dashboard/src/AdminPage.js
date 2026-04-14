import React, { useState, useEffect, useCallback } from 'react';
import {
  adminListUsers, adminChangeRole, adminDeleteUser,
  adminGetActivity, adminGetStats,
  getAuditLogs, exportAuditLogs, applyAuditLogRetention, getAuditLogStats,
  getDataResidency, updateDataResidency,
  getCurrentTerms, createLegalDocument,
  getSlaStatus, getReadiness
} from './api';

export default function AdminPage({ onBack }) {
  const [tab, setTab] = useState('stats');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);

  const loadStats = useCallback(async () => {
    try { setStats(await adminGetStats()); } catch {}
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const data = await adminListUsers();
      setUsers(data.users);
    } catch {}
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const data = await adminGetActivity();
      setLogs(data.logs);
    } catch {}
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    if (tab === 'users') loadUsers();
    if (tab === 'activity') loadLogs();
  }, [tab, loadUsers, loadLogs]);

  const handleRoleChange = async (userId, role) => {
    try {
      await adminChangeRole(userId, role);
      await loadUsers();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Delete this user and all their audits?')) return;
    try {
      await adminDeleteUser(userId);
      await loadUsers();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Admin Panel</h1>
          <div className="subtitle">Platform management</div>
        </div>
        <button className="nav-btn" onClick={onBack}>&larr; Dashboard</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {['stats', 'users', 'activity', 'audit-logs', 'data-residency', 'terms', 'sla'].map(t => (
          <button key={t} className={`nav-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)} style={tab === t ? { background: 'var(--accent-blue)', color: '#fff', borderColor: 'var(--accent-blue)' } : {}}>
            {t === 'audit-logs' ? 'Audit Logs' : t === 'data-residency' ? 'Data Residency' : t === 'sla' ? 'SLA' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'stats' && stats && (
        <div className="bottom-grid">
          <div className="card">
            <h2>Platform Overview</h2>
            <div className="stat-grid">
              <div className="stat-item"><span className="stat-value">{stats.users}</span><span className="stat-label">Users</span></div>
              <div className="stat-item"><span className="stat-value">{stats.orgs}</span><span className="stat-label">Orgs</span></div>
              <div className="stat-item"><span className="stat-value">{stats.audits}</span><span className="stat-label">Audits</span></div>
            </div>
          </div>
          <div className="card">
            <h2>Risk Distribution</h2>
            <div className="stat-grid">
              {Object.entries(stats.auditsByRisk).map(([risk, count]) => (
                <div key={risk} className="stat-item">
                  <span className="stat-value">{count}</span>
                  <span className={`risk-badge ${risk}`}>{risk}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="card">
          <h2>Users</h2>
          <table className="scores-table">
            <thead>
              <tr><th>Email</th><th>Name</th><th>Role</th><th>Joined</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.name || '—'}</td>
                  <td>
                    <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)}
                      className="role-select">
                      <option value="admin">admin</option>
                      <option value="auditor">auditor</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td><button className="action-btn delete" onClick={() => handleDeleteUser(u.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'activity' && (
        <div className="card">
          <h2>Activity Log</h2>
          <table className="scores-table">
            <thead>
              <tr><th>Time</th><th>Action</th><th>User</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(l.createdAt).toLocaleString()}</td>
                  <td><span className="ref-tag">{l.action}</span></td>
                  <td>{l.userEmail || '—'}</td>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit-logs' && <AuditLogsPanel />}
      {tab === 'data-residency' && <DataResidencyPanel />}
      {tab === 'terms' && <TermsPanel />}
      {tab === 'sla' && <SlaPanel />}
    </div>
  );
}

// ─── Enterprise: Audit Log Export Panel ───────────────

function AuditLogsPanel() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [retentionDays, setRetentionDays] = useState(365);

  const load = useCallback(async () => {
    try {
      const params = { page, limit: 50 };
      if (actionFilter) params.action = actionFilter;
      const data = await getAuditLogs(params);
      setLogs(data.logs); setTotal(data.pagination.total);
    } catch {}
    try { setStats(await getAuditLogStats()); } catch {}
  }, [page, actionFilter]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format) => {
    try {
      const blob = await exportAuditLogs({ format, action: actionFilter || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `audit-logs.${format}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert('Export failed: ' + e.message); }
  };

  const handleRetention = async () => {
    if (!window.confirm(`Delete logs older than ${retentionDays} days?`)) return;
    try {
      const r = await applyAuditLogRetention(retentionDays);
      alert(`Deleted ${r.deleted} log entries older than ${retentionDays} days.`);
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <>
      {stats && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Audit Log Statistics</h2>
          <div className="stat-grid">
            <div className="stat-item"><span className="stat-value">{stats.total}</span><span className="stat-label">Total Entries</span></div>
            <div className="stat-item"><span className="stat-value">{stats.oldestEntry ? new Date(stats.oldestEntry).toLocaleDateString() : '—'}</span><span className="stat-label">Oldest Entry</span></div>
          </div>
          {stats.actionBreakdown && stats.actionBreakdown.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {stats.actionBreakdown.slice(0, 8).map(a => (
                <span key={a.action} className="ref-tag" style={{ cursor: 'pointer' }} onClick={() => setActionFilter(a.action)}>
                  {a.action}: {a.count}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <input value={actionFilter} onChange={e => setActionFilter(e.target.value)} placeholder="Filter by action..." className="auth-input" style={{ marginBottom: 0, maxWidth: 200 }} />
          <button className="action-btn" onClick={() => handleExport('json')}>Export JSON</button>
          <button className="action-btn" onClick={() => handleExport('csv')}>Export CSV</button>
          <span style={{ flex: 1 }} />
          <input type="number" value={retentionDays} onChange={e => setRetentionDays(Number(e.target.value))} min={30} className="auth-input" style={{ marginBottom: 0, maxWidth: 80 }} />
          <button className="action-btn delete" onClick={handleRetention}>Apply Retention</button>
        </div>
        <table className="scores-table">
          <thead><tr><th>Time</th><th>Action</th><th>User</th><th>IP</th><th>Detail</th></tr></thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{new Date(l.createdAt).toLocaleString()}</td>
                <td><span className="ref-tag">{l.action}</span></td>
                <td style={{ fontSize: 12 }}>{l.userEmail || '—'}</td>
                <td style={{ fontSize: 12 }}>{l.ip || '—'}</td>
                <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12 }}>{l.detail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="action-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>← Prev</button>
          <span className="subtitle">Page {page} of {Math.ceil(total / 50) || 1} ({total} total)</span>
          <button className="action-btn" onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total}>Next →</button>
        </div>
      </div>
    </>
  );
}

// ─── Enterprise: Data Residency Panel ─────────────────

function DataResidencyPanel() {
  const [config, setConfig] = useState(null);
  const [region, setRegion] = useState('us');
  const [retentionDays, setRetentionDays] = useState(365);
  const [deletionPolicy, setDeletionPolicy] = useState('soft');

  useEffect(() => {
    (async () => {
      try {
        const data = await getDataResidency();
        setConfig(data);
        if (data.configured) {
          setRegion(data.region); setRetentionDays(data.retentionDays); setDeletionPolicy(data.deletionPolicy);
        }
      } catch {}
    })();
  }, []);

  const save = async () => {
    try {
      const data = await updateDataResidency({ region, retentionDays, deletionPolicy });
      setConfig({ configured: true, ...data });
      alert('Data residency saved');
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="card">
      <h2>Data Residency Configuration</h2>
      <p className="subtitle">Control where your organization's data is stored and how long it's retained.</p>
      <div style={{ display: 'grid', gap: 12, maxWidth: 400, marginTop: 16 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Storage Region</label>
          <select value={region} onChange={e => setRegion(e.target.value)} className="auth-input" style={{ marginBottom: 0 }}>
            <option value="us">US (United States)</option>
            <option value="eu">EU (European Union)</option>
            <option value="ap">AP (Asia-Pacific)</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Retention Period (days)</label>
          <input type="number" value={retentionDays} onChange={e => setRetentionDays(Number(e.target.value))} min={30} className="auth-input" style={{ marginBottom: 0 }} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Deletion Policy</label>
          <select value={deletionPolicy} onChange={e => setDeletionPolicy(e.target.value)} className="auth-input" style={{ marginBottom: 0 }}>
            <option value="soft">Soft Delete (recoverable)</option>
            <option value="hard">Hard Delete (permanent)</option>
          </select>
        </div>
        <button className="upload-btn" onClick={save}>Save Configuration</button>
      </div>
      {config && config.configured && (
        <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-primary)', borderRadius: 8, fontSize: 13 }}>
          <strong style={{ color: 'var(--accent-green)' }}>✓ Configured</strong> — Region: {config.region?.toUpperCase()}, Retention: {config.retentionDays} days, Deletion: {config.deletionPolicy}
        </div>
      )}
    </div>
  );
}

// ─── Enterprise: Terms Panel ──────────────────────────

function TermsPanel() {
  const [docs, setDocs] = useState([]);
  const [type, setType] = useState('tos');
  const [version, setVersion] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    (async () => {
      try { const r = await getCurrentTerms(); setDocs(r.documents); } catch {}
    })();
  }, []);

  const publish = async () => {
    if (!version || !title || !content) { alert('All fields required'); return; }
    try {
      await createLegalDocument({ type, version, title, content });
      setVersion(''); setTitle(''); setContent('');
      const r = await getCurrentTerms(); setDocs(r.documents);
      alert('Document published');
    } catch (e) { alert(e.message); }
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Active Legal Documents</h2>
        {docs.length === 0 ? (
          <p className="subtitle">No legal documents published yet.</p>
        ) : (
          <table className="scores-table">
            <thead><tr><th>Type</th><th>Version</th><th>Title</th><th>Effective</th></tr></thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  <td><span className="ref-tag">{d.type?.toUpperCase()}</span></td>
                  <td>{d.version}</td>
                  <td>{d.title}</td>
                  <td>{d.effectiveDate ? new Date(d.effectiveDate).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Publish New Document</h2>
        <div style={{ display: 'grid', gap: 12, maxWidth: 500, marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <select value={type} onChange={e => setType(e.target.value)} className="auth-input" style={{ marginBottom: 0 }}>
              <option value="tos">Terms of Service</option>
              <option value="dpa">Data Processing Agreement</option>
              <option value="privacy_policy">Privacy Policy</option>
            </select>
            <input value={version} onChange={e => setVersion(e.target.value)} placeholder="Version (e.g. 1.0)" className="auth-input" style={{ marginBottom: 0, maxWidth: 120 }} />
          </div>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title" className="auth-input" style={{ marginBottom: 0 }} />
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Document content (markdown supported)..." className="auth-input" rows={6} style={{ marginBottom: 0, fontFamily: 'monospace', fontSize: 12 }} />
          <button className="upload-btn" onClick={publish}>Publish Document</button>
        </div>
      </div>
    </>
  );
}

// ─── Enterprise: SLA Panel ────────────────────────────

function SlaPanel() {
  const [sla, setSla] = useState(null);
  const [readiness, setReadiness] = useState(null);

  useEffect(() => {
    (async () => {
      try { setSla(await getSlaStatus()); } catch {}
      try { setReadiness(await getReadiness()); } catch {}
    })();
  }, []);

  return (
    <>
      {sla && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>SLA & Uptime</h2>
          <div className="stat-grid">
            <div className="stat-item">
              <span className="stat-value" style={{ color: sla.sla?.met ? 'var(--accent-green)' : 'var(--accent-red)' }}>{sla.availability}</span>
              <span className="stat-label">Availability</span>
            </div>
            <div className="stat-item"><span className="stat-value">{sla.uptime?.human}</span><span className="stat-label">Uptime</span></div>
            <div className="stat-item"><span className="stat-value">{sla.requests?.total}</span><span className="stat-label">Total Requests</span></div>
            <div className="stat-item"><span className="stat-value">{sla.requests?.errors}</span><span className="stat-label">Errors</span></div>
          </div>
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-primary)', borderRadius: 8 }}>
            <span style={{ fontSize: 13 }}>
              SLA Target: <strong>{sla.sla?.target}</strong> — Current: <strong>{sla.sla?.current}</strong> —{' '}
              <span style={{ color: sla.sla?.met ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                {sla.sla?.met ? '✓ SLA Met' : '✗ SLA Not Met'}
              </span>
            </span>
          </div>
        </div>
      )}
      {readiness && (
        <div className="card">
          <h2>System Readiness</h2>
          <div className="stat-grid">
            <div className="stat-item">
              <span className="stat-value" style={{ color: readiness.checks?.database === 'connected' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {readiness.checks?.database === 'connected' ? '✓' : '✗'}
              </span>
              <span className="stat-label">Database</span>
            </div>
            <div className="stat-item">
              <span className="stat-value" style={{ color: readiness.checks?.redis === 'connected' ? 'var(--accent-green)' : readiness.checks?.redis === 'not_configured' ? 'var(--accent-yellow)' : 'var(--accent-red)' }}>
                {readiness.checks?.redis === 'connected' ? '✓' : readiness.checks?.redis === 'not_configured' ? '○' : '✗'}
              </span>
              <span className="stat-label">Redis</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{readiness.checks?.memory?.rss || '—'}</span>
              <span className="stat-label">Memory (RSS)</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{readiness.checks?.memory?.heap || '—'}</span>
              <span className="stat-label">Heap Used</span>
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
            Queue Backend: <strong>{readiness.checks?.queue?.backend || '—'}</strong> |
            Queued: {readiness.checks?.queue?.queued ?? '—'} |
            Status: <span style={{ color: readiness.status === 'ready' ? 'var(--accent-green)' : 'var(--accent-red)' }}>{readiness.status}</span>
          </div>
        </div>
      )}
    </>
  );
}
