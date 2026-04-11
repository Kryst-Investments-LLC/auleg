import React, { useState, useEffect, useCallback } from 'react';
import {
  listWebhooks, createWebhook, updateWebhook, deleteWebhook,
  listTemplates, createTemplate, deleteTemplate,
  listApiKeys, createApiKey, deleteApiKey,
  listSchedules, createSchedule, updateSchedule, deleteSchedule,
  listScoringRules, createScoringRule, updateScoringRule, deleteScoringRule,
  getPreferences, updatePreferences
} from './api';

const CLAUSE_OPTIONS = [
  'audit_rights', 'breach_notification', 'data_subject_rights',
  'subprocessor_controls', 'security_measures', 'data_processing_purpose',
  'data_retention', 'cross_border_transfer', 'liability', 'termination'
];
const FRAMEWORK_OPTIONS = ['GDPR', 'CCPA', 'SOC2', 'ISO27701', 'HIPAA'];

export default function SettingsPage({ onBack }) {
  const [tab, setTab] = useState('webhooks');

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Settings</h1>
          <div className="subtitle">Webhooks, templates, schedules, and configuration</div>
        </div>
        <button className="nav-btn" onClick={onBack}>&larr; Dashboard</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {['webhooks', 'templates', 'api-keys', 'schedules', 'scoring', 'preferences'].map(t => (
          <button key={t} className="nav-btn"
            onClick={() => setTab(t)}
            style={tab === t ? { background: 'var(--accent-blue)', color: '#fff', borderColor: 'var(--accent-blue)' } : {}}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'webhooks' && <WebhooksPanel />}
      {tab === 'templates' && <TemplatesPanel />}
      {tab === 'api-keys' && <ApiKeysPanel />}
      {tab === 'schedules' && <SchedulesPanel />}
      {tab === 'scoring' && <ScoringPanel />}
      {tab === 'preferences' && <PreferencesPanel />}
    </div>
  );
}

function WebhooksPanel() {
  const [hooks, setHooks] = useState([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('audit.complete,audit.failed');
  const [newSecret, setNewSecret] = useState(null);

  const load = useCallback(async () => {
    try { const d = await listWebhooks(); setHooks(d.webhooks); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!url) return;
    try {
      const hook = await createWebhook(url, events);
      setNewSecret(hook.secret);
      setUrl('');
      await load();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  const handleToggle = async (id, active) => {
    try { await updateWebhook(id, { active: !active }); await load(); } catch {}
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this webhook?')) return;
    try { await deleteWebhook(id); await load(); } catch {}
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 24 }}>
        <h2>Add Webhook</h2>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <input type="url" value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com/webhook" className="auth-input" style={{ marginBottom: 0, maxWidth: 350 }} required />
          <input type="text" value={events} onChange={e => setEvents(e.target.value)}
            placeholder="audit.complete,audit.failed" className="auth-input" style={{ marginBottom: 0, maxWidth: 250 }} />
          <button type="submit" className="upload-btn">Create</button>
        </form>
        {newSecret && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-primary)', borderRadius: 8, fontSize: 13 }}>
            <strong style={{ color: 'var(--accent-yellow)' }}>Save this secret — it won't be shown again:</strong>
            <pre style={{ margin: '8px 0 0', fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--accent-green)' }}>{newSecret}</pre>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Webhooks</h2>
        {hooks.length === 0 ? (
          <p className="subtitle">No webhooks configured.</p>
        ) : (
          <table className="scores-table">
            <thead>
              <tr><th>URL</th><th>Events</th><th>Active</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {hooks.map(h => (
                <tr key={h.id}>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.url}</td>
                  <td>{h.events.split(',').map(e => <span key={e} className="ref-tag" style={{ marginRight: 4 }}>{e}</span>)}</td>
                  <td>
                    <button onClick={() => handleToggle(h.id, h.active)}
                      className="action-btn" style={h.active ? { color: 'var(--accent-green)', borderColor: 'var(--accent-green)' } : {}}>
                      {h.active ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td><button className="action-btn delete" onClick={() => handleDelete(h.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function TemplatesPanel() {
  const [templates, setTemplates] = useState([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [clauses, setClauses] = useState([]);
  const [frameworks, setFrameworks] = useState([]);

  const load = useCallback(async () => {
    try { const d = await listTemplates(); setTemplates(d.templates); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleItem = (arr, setArr, item) => {
    setArr(arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item]);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name || clauses.length === 0 || frameworks.length === 0) {
      alert('Name, at least one clause type, and one framework are required.');
      return;
    }
    try {
      await createTemplate({ name, description: desc, clauseTypes: clauses, frameworks });
      setName(''); setDesc(''); setClauses([]); setFrameworks([]);
      await load();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete template?')) return;
    try { await deleteTemplate(id); await load(); } catch {}
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 24 }}>
        <h2>Create Template</h2>
        <form onSubmit={handleCreate} style={{ marginTop: 12 }}>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Template name" className="auth-input" style={{ maxWidth: 350 }} required />
          <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Description (optional)" className="auth-input" style={{ maxWidth: 500 }} />

          <div style={{ marginBottom: 12 }}>
            <div className="subtitle" style={{ marginBottom: 6 }}>Clause Types:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CLAUSE_OPTIONS.map(c => (
                <button key={c} type="button" onClick={() => toggleItem(clauses, setClauses, c)}
                  className="chip-btn" style={clauses.includes(c) ? { background: 'var(--accent-blue)', color: '#fff' } : {}}>
                  {c.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="subtitle" style={{ marginBottom: 6 }}>Frameworks:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FRAMEWORK_OPTIONS.map(f => (
                <button key={f} type="button" onClick={() => toggleItem(frameworks, setFrameworks, f)}
                  className="chip-btn" style={frameworks.includes(f) ? { background: 'var(--accent-purple)', color: '#fff' } : {}}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          <button type="submit" className="upload-btn">Create Template</button>
        </form>
      </div>

      <div className="card">
        <h2>Saved Templates</h2>
        {templates.length === 0 ? (
          <p className="subtitle">No templates saved yet.</p>
        ) : (
          <div>
            {templates.map(t => (
              <div key={t.id} className="remediation-card">
                <div className="rem-header">
                  <h3>{t.name}</h3>
                  <button className="action-btn delete" onClick={() => handleDelete(t.id)}>Delete</button>
                </div>
                {t.description && <div className="suggested">{t.description}</div>}
                <div className="refs" style={{ marginBottom: 6 }}>
                  {t.clauseTypes.map(c => <span key={c} className="ref-tag">{c.replace(/_/g, ' ')}</span>)}
                </div>
                <div className="refs">
                  {t.frameworks.map(f => <span key={f} className="ref-tag" style={{ background: 'rgba(168,85,247,0.15)', color: 'var(--accent-purple)' }}>{f}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const SCOPE_OPTIONS = ['audits:read', 'audits:write', 'templates:read', 'templates:write', 'webhooks:read', 'webhooks:write'];
const CONDITION_OPTIONS = ['missing', 'weak', 'present', 'strong'];
const ACTION_OPTIONS = ['flag', 'boost', 'reduce', 'ignore'];

function ApiKeysPanel() {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['audits:read']);
  const [expiry, setExpiry] = useState('');
  const [newKey, setNewKey] = useState(null);

  const load = useCallback(async () => {
    try { const d = await listApiKeys(); setKeys(d.keys); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleScope = (s) => {
    setScopes(scopes.includes(s) ? scopes.filter(x => x !== s) : [...scopes, s]);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name || scopes.length === 0) { alert('Name and at least one scope required.'); return; }
    try {
      const result = await createApiKey(name, scopes, expiry ? parseInt(expiry) : null);
      setNewKey(result.key);
      setName(''); setExpiry('');
      await load();
    } catch (err) { alert('Failed: ' + err.message); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Revoke this API key? This cannot be undone.')) return;
    try { await deleteApiKey(id); await load(); } catch {}
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 24 }}>
        <h2>Create API Key</h2>
        <form onSubmit={handleCreate} style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Key name (e.g. CI Pipeline)" className="auth-input" style={{ marginBottom: 0, maxWidth: 250 }} required />
            <input type="number" value={expiry} onChange={e => setExpiry(e.target.value)}
              placeholder="Expires in days (empty=never)" className="auth-input" style={{ marginBottom: 0, maxWidth: 220 }} min="1" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="subtitle" style={{ marginBottom: 6 }}>Scopes:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SCOPE_OPTIONS.map(s => (
                <button key={s} type="button" onClick={() => toggleScope(s)}
                  className="chip-btn" style={scopes.includes(s) ? { background: 'var(--accent-blue)', color: '#fff' } : {}}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" className="upload-btn">Generate Key</button>
        </form>
        {newKey && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-primary)', borderRadius: 8, fontSize: 13 }}>
            <strong style={{ color: 'var(--accent-yellow)' }}>Copy this key now — it won't be shown again:</strong>
            <pre style={{ margin: '8px 0 0', fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--accent-green)' }}>{newKey}</pre>
          </div>
        )}
      </div>

      <div className="card">
        <h2>API Keys</h2>
        {keys.length === 0 ? (
          <p className="subtitle">No API keys created.</p>
        ) : (
          <table className="scores-table">
            <thead>
              <tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last Used</th><th>Expires</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id}>
                  <td className="clause-name">{k.name}</td>
                  <td><code>{k.prefix}...</code></td>
                  <td>{k.scopes.map(s => <span key={s} className="ref-tag" style={{ marginRight: 4 }}>{s}</span>)}</td>
                  <td>{k.lastUsed ? new Date(k.lastUsed).toLocaleDateString() : 'Never'}</td>
                  <td>{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}</td>
                  <td><button className="action-btn delete" onClick={() => handleDelete(k.id)}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function SchedulesPanel() {
  const [schedules, setSchedules] = useState([]);
  const [name, setName] = useState('');
  const [auditId, setAuditId] = useState('');
  const [cron, setCron] = useState('0 0 * * 1');

  const load = useCallback(async () => {
    try { const d = await listSchedules(); setSchedules(d.schedules); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name || !auditId || !cron) { alert('All fields are required.'); return; }
    try {
      await createSchedule(name, auditId, cron);
      setName(''); setAuditId(''); setCron('0 0 * * 1');
      await load();
    } catch (err) { alert('Failed: ' + err.message); }
  };

  const handleToggle = async (id, active) => {
    try { await updateSchedule(id, { active: !active }); await load(); } catch {}
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this schedule?')) return;
    try { await deleteSchedule(id); await load(); } catch {}
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 24 }}>
        <h2>Create Schedule</h2>
        <form onSubmit={handleCreate} style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Schedule name" className="auth-input" style={{ marginBottom: 0, maxWidth: 220 }} required />
            <input type="text" value={auditId} onChange={e => setAuditId(e.target.value)}
              placeholder="Source Audit ID" className="auth-input" style={{ marginBottom: 0, maxWidth: 280 }} required />
            <input type="text" value={cron} onChange={e => setCron(e.target.value)}
              placeholder="Cron (e.g. 0 0 * * 1)" className="auth-input" style={{ marginBottom: 0, maxWidth: 200 }} required />
          </div>
          <div className="subtitle" style={{ marginBottom: 12, fontSize: 12 }}>
            Cron format: minute hour day month weekday (e.g. "0 9 * * 1" = every Monday 9 AM)
          </div>
          <button type="submit" className="upload-btn">Create Schedule</button>
        </form>
      </div>

      <div className="card">
        <h2>Scheduled Audits</h2>
        {schedules.length === 0 ? (
          <p className="subtitle">No schedules configured.</p>
        ) : (
          <table className="scores-table">
            <thead>
              <tr><th>Name</th><th>Cron</th><th>Next Run</th><th>Last Run</th><th>Active</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id}>
                  <td className="clause-name">{s.name}</td>
                  <td><code>{s.cron}</code></td>
                  <td>{s.nextRun ? new Date(s.nextRun).toLocaleString() : '—'}</td>
                  <td>{s.lastRun ? new Date(s.lastRun).toLocaleString() : 'Never'}</td>
                  <td>
                    <button onClick={() => handleToggle(s.id, s.active)}
                      className="action-btn" style={s.active ? { color: 'var(--accent-green)', borderColor: 'var(--accent-green)' } : {}}>
                      {s.active ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td><button className="action-btn delete" onClick={() => handleDelete(s.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ScoringPanel() {
  const [rules, setRules] = useState([]);
  const [clause, setClause] = useState('');
  const [condition, setCondition] = useState('missing');
  const [weight, setWeight] = useState('1.0');
  const [action, setAction] = useState('flag');
  const [editId, setEditId] = useState(null);

  const load = useCallback(async () => {
    try { const d = await listScoringRules(); setRules(d.rules); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setClause(''); setCondition('missing'); setWeight('1.0'); setAction('flag'); setEditId(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!clause) { alert('Clause is required.'); return; }
    const data = { clause, condition, weight: parseFloat(weight), action };
    try {
      if (editId) { await updateScoringRule(editId, data); }
      else { await createScoringRule(data); }
      resetForm();
      await load();
    } catch (err) { alert('Failed: ' + err.message); }
  };

  const handleEdit = (r) => {
    setEditId(r.id); setClause(r.clause); setCondition(r.condition);
    setWeight(String(r.weight)); setAction(r.action);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this scoring rule?')) return;
    try { await deleteScoringRule(id); if (editId === id) resetForm(); await load(); } catch {}
  };

  const handleToggle = async (r) => {
    try { await updateScoringRule(r.id, { active: !r.active }); await load(); } catch {}
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 24 }}>
        <h2>{editId ? 'Edit Scoring Rule' : 'Create Scoring Rule'}</h2>
        <form onSubmit={handleSubmit} style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <select value={clause} onChange={e => setClause(e.target.value)}
              className="auth-input" style={{ marginBottom: 0, maxWidth: 220 }} required>
              <option value="">Select clause...</option>
              {CLAUSE_OPTIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={condition} onChange={e => setCondition(e.target.value)}
              className="auth-input" style={{ marginBottom: 0, maxWidth: 150 }}>
              {CONDITION_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" step="0.1" min="0" max="10" value={weight}
              onChange={e => setWeight(e.target.value)}
              className="auth-input" style={{ marginBottom: 0, maxWidth: 100 }} placeholder="Weight" />
            <select value={action} onChange={e => setAction(e.target.value)}
              className="auth-input" style={{ marginBottom: 0, maxWidth: 130 }}>
              {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="upload-btn">{editId ? 'Update' : 'Create'}</button>
            {editId && <button type="button" className="nav-btn" onClick={resetForm}>Cancel</button>}
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Scoring Rules</h2>
        {rules.length === 0 ? (
          <p className="subtitle">No custom scoring rules yet.</p>
        ) : (
          <table className="scores-table">
            <thead>
              <tr><th>Clause</th><th>Condition</th><th>Weight</th><th>Action</th><th>Active</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id}>
                  <td className="clause-name">{r.clause.replace(/_/g, ' ')}</td>
                  <td><span className="ref-tag">{r.condition}</span></td>
                  <td>{r.weight}</td>
                  <td><span className="ref-tag" style={
                    r.action === 'flag' ? { background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)' } :
                    r.action === 'boost' ? { background: 'rgba(34,197,94,0.15)', color: 'var(--accent-green)' } :
                    r.action === 'reduce' ? { background: 'rgba(234,179,8,0.15)', color: 'var(--accent-yellow)' } :
                    {}
                  }>{r.action}</span></td>
                  <td>
                    <button onClick={() => handleToggle(r)}
                      className="action-btn" style={r.active ? { color: 'var(--accent-green)', borderColor: 'var(--accent-green)' } : {}}>
                      {r.active ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="action-btn" onClick={() => handleEdit(r)}>Edit</button>
                    <button className="action-btn delete" onClick={() => handleDelete(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function PreferencesPanel() {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const p = await getPreferences(); setPrefs(p); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (field, value) => {
    setSaving(true);
    try {
      const updated = await updatePreferences({ [field]: value });
      setPrefs(updated);
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setSaving(false); }
  };

  if (!prefs) return <div className="card"><p className="subtitle">Loading preferences...</p></div>;

  return (
    <div className="card">
      <h2>User Preferences</h2>
      <div style={{ display: 'grid', gap: 20, marginTop: 16, maxWidth: 500 }}>
        <div>
          <div className="subtitle" style={{ marginBottom: 6 }}>Email Digest</div>
          <select className="auth-input" style={{ maxWidth: 200 }} value={prefs.emailDigest}
            onChange={e => save('emailDigest', e.target.value)} disabled={saving}>
            <option value="none">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>

        <div>
          <div className="subtitle" style={{ marginBottom: 6 }}>Theme</div>
          <select className="auth-input" style={{ maxWidth: 200 }} value={prefs.theme}
            onChange={e => save('theme', e.target.value)} disabled={saving}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>

        <div>
          <div className="subtitle" style={{ marginBottom: 10 }}>Notification Preferences</div>
          {[
            { key: 'notifyAuditComplete', label: 'Audit completed' },
            { key: 'notifyAuditFailed', label: 'Audit failed' },
            { key: 'notifyShare', label: 'Audit shared with me' }
          ].map(({ key, label }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={prefs[key]} disabled={saving}
                onChange={e => save(key, e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--accent-blue)' }} />
              <span style={{ fontSize: 14 }}>{label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
