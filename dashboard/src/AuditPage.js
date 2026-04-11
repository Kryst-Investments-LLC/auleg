import React, { useState, useEffect, useCallback, useRef } from 'react';
import { listAudits, getAudit, uploadAndAudit, deleteAudit, exportJson, exportCsv, batchUpload, getQueueStatus, searchAudits, listNotifications, markAllRead, reAudit, getVersions, shareAudit, getAuditShares, revokeShare, listComments, addComment, deleteComment, updateTags, getVersionDiff, getComplianceReport, aiSummary, aiAnalyze, aiRemediate, aiExplain, aiSearch } from './api';
import {
  RiskGauge,
  ClauseScoresTable,
  FrameworkHeatmap,
  GapReport,
  RemediationPlan
} from './components';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditPage({ user, onLogout, onAdmin, onOrg, onCompare, onSettings, onAnalytics, onBilling, onApiExplorer, onLegal }) {
  const [audits, setAudits] = useState([]);
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [report, setReport] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState('history'); // history | report | versions | share | comments | diff | compliance | ai-summary | ai-analyze | ai-remediate | ai-explain
  const [queueInfo, setQueueInfo] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const [versions, setVersions] = useState([]);
  const [shares, setShares] = useState([]);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentClause, setCommentClause] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [auditTags, setAuditTags] = useState([]);
  const [diffData, setDiffData] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [nlQuery, setNlQuery] = useState('');
  const [nlResults, setNlResults] = useState(null);
  const pollRef = useRef(null);

  const loadShares = useCallback(async (auditId) => {
    try { const d = await getAuditShares(auditId); setShares(d.shares); } catch {}
  }, []);

  const loadComments = useCallback(async (auditId) => {
    try { const d = await listComments(auditId); setComments(d.comments); } catch {}
  }, []);

  const loadAudits = useCallback(async () => {
    try {
      const params = {};
      if (searchText) params.search = searchText;
      if (filterStatus) params.status = filterStatus;
      if (filterRisk) params.risk = filterRisk;
      const data = Object.keys(params).length > 0 ? await searchAudits(params) : await listAudits();
      setAudits(data.audits);
    } catch (err) {
      console.error('Failed to load audits:', err);
    }
  }, [searchText, filterStatus, filterRisk]);

  useEffect(() => { loadAudits(); }, [loadAudits]);

  // Load notifications
  useEffect(() => {
    const loadNotifs = async () => {
      try {
        const d = await listNotifications();
        setNotifications(d.notifications.slice(0, 10));
        setUnreadCount(d.unreadCount);
      } catch {}
    };
    loadNotifs();
    const iv = setInterval(loadNotifs, 15000);
    return () => clearInterval(iv);
  }, []);

  // Poll for processing audits
  useEffect(() => {
    const hasProcessing = audits.some(a => a.status === 'processing');
    if (hasProcessing) {
      pollRef.current = setInterval(async () => {
        await loadAudits();
        try { const q = await getQueueStatus(); setQueueInfo(q); } catch {}
      }, 4000);
    } else {
      setQueueInfo(null);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [audits, loadAudits]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const audit = await uploadAndAudit(file);
      await loadAudits();
      if (audit.reportJson || audit.status === 'complete') {
        await handleViewAudit(audit.id);
      }
    } catch (err) {
      alert('Audit failed: ' + err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleBatch = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setUploading(true);
    try {
      await batchUpload(files);
      await loadAudits();
    } catch (err) {
      alert('Batch upload failed: ' + err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleViewAudit = async (id) => {
    try {
      const data = await getAudit(id);
      setSelectedAudit(data);
      setReport(data.report || null);
      setAuditTags(data.tags ? data.tags.split(',').filter(Boolean) : []);
      setView('report');
    } catch (err) {
      alert('Failed to load audit: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this audit?')) return;
    try {
      await deleteAudit(id);
      if (selectedAudit && selectedAudit.id === id) {
        setSelectedAudit(null);
        setReport(null);
        setView('history');
      }
      await loadAudits();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const rp = report?.risk_profile || {};

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Auleg</h1>
          <div className="subtitle">Welcome, {user?.name || user?.email}</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="upload-btn">
            {uploading ? 'Auditing...' : '+ New Audit'}
            <input type="file" accept=".txt,.pdf,.docx" onChange={handleUpload} disabled={uploading} hidden />
          </label>
          <label className="upload-btn" style={{ background: 'var(--accent-purple)' }}>
            {uploading ? 'Uploading...' : 'Batch'}
            <input type="file" accept=".txt,.pdf,.docx" multiple onChange={handleBatch} disabled={uploading} hidden />
          </label>
        </div>
      </div>

      {/* Navigation Bar */}
      <div className="dashboard-nav">
        <div className="dashboard-nav-left">
          <button className={`dash-nav-btn ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>Audits</button>
          {onCompare && <button className="dash-nav-btn" onClick={onCompare}>Compare</button>}
          {onAnalytics && <button className="dash-nav-btn" onClick={onAnalytics}>Analytics</button>}
          {onOrg && <button className="dash-nav-btn" onClick={onOrg}>Organization</button>}
          {onSettings && <button className="dash-nav-btn" onClick={onSettings}>Settings</button>}
          {onBilling && <button className="dash-nav-btn" onClick={onBilling}>Billing</button>}
          {onApiExplorer && <button className="dash-nav-btn" onClick={onApiExplorer}>API</button>}
          {onLegal && <button className="dash-nav-btn" onClick={onLegal}>Legal Agent</button>}
          {onAdmin && <button className="dash-nav-btn" onClick={onAdmin}>Admin</button>}
        </div>
        <div className="dashboard-nav-right">
          <div style={{ position: 'relative' }}>
            <button className="dash-nav-btn" onClick={() => setShowNotifs(!showNotifs)} style={{ position: 'relative' }}>
              🔔{unreadCount > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--accent-red)', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{unreadCount}</span>}
            </button>
            {showNotifs && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 340, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, zIndex: 100, maxHeight: 400, overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <strong>Notifications</strong>
                  {unreadCount > 0 && <button className="action-btn" onClick={async () => { await markAllRead(); setUnreadCount(0); setNotifications(n => n.map(x => ({...x, read: true}))); }}>Mark all read</button>}
                </div>
                {notifications.length === 0 ? <div className="subtitle">No notifications.</div> : notifications.map(n => (
                  <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', opacity: n.read ? 0.6 : 1 }}>
                    <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600 }}>{n.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.message}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{new Date(n.createdAt).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="dash-nav-btn logout" onClick={onLogout}>Sign Out</button>
        </div>
      </div>

      {queueInfo && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--accent-yellow)' }}>
          <h2 style={{ color: 'var(--accent-yellow)' }}>Queue Status</h2>
          <div style={{ display: 'flex', gap: 24, fontSize: 14 }}>
            <span>Queued: <strong>{queueInfo.queued}</strong></span>
            <span>Processing: <strong>{queueInfo.processing ? 'Yes' : 'No'}</strong></span>
          </div>
        </div>
      )}

      {view === 'history' && (
        <div className="card">
          <h2>Audit History</h2>
          {/* AI Natural Language Search */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <input type="text" value={nlQuery} onChange={e => setNlQuery(e.target.value)}
              placeholder="AI Search: e.g. 'show me high risk audits missing breach notification'" className="auth-input"
              style={{ marginBottom: 0, flex: 1 }}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && nlQuery.trim()) {
                  try { const r = await aiSearch(nlQuery); setNlResults(r); } catch (err) { alert('AI Search failed: ' + err.message); }
                }
              }} />
            <button className="upload-btn" style={{ background: 'var(--accent-purple)', whiteSpace: 'nowrap' }} onClick={async () => {
              if (!nlQuery.trim()) return;
              try { const r = await aiSearch(nlQuery); setNlResults(r); } catch (err) { alert('AI Search failed: ' + err.message); }
            }}>AI Search</button>
            {nlResults && <button className="action-btn" onClick={() => { setNlResults(null); setNlQuery(''); }}>Clear AI</button>}
          </div>
          {nlResults && (
            <div style={{ marginBottom: 16, padding: 12, background: 'rgba(139,92,246,0.08)', borderRadius: 8, borderLeft: '3px solid var(--accent-purple)' }}>
              <div style={{ fontSize: 13, color: '#a78bfa', marginBottom: 4 }}>AI Interpretation: {nlResults.interpretation}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{nlResults.count} result(s) found</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Search by contract name..." className="auth-input" style={{ marginBottom: 0, maxWidth: 250 }} />
            <select className="role-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="complete">Complete</option>
              <option value="processing">Processing</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
            </select>
            <select className="role-select" value={filterRisk} onChange={e => setFilterRisk(e.target.value)}>
              <option value="">All risk levels</option>
              <option value="Low">Low</option>
              <option value="Moderate">Moderate</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </select>
            {(searchText || filterStatus || filterRisk) && (
              <button className="action-btn" onClick={() => { setSearchText(''); setFilterStatus(''); setFilterRisk(''); }}>Clear</button>
            )}
          </div>
          {(nlResults ? nlResults.results : audits).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📄</div>
              <h3>No audits yet</h3>
              <p>Upload your first Data Processing Agreement to get an AI-powered compliance report in seconds.</p>
              <label className="empty-state-btn">
                Upload Your First DPA
                <input type="file" accept=".txt,.pdf,.docx" onChange={handleUpload} disabled={uploading} hidden />
              </label>
            </div>
          ) : (
            <table className="scores-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Score</th>
                  <th>Clauses</th>
                  <th>Gaps</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(nlResults ? nlResults.results : audits).map(a => (
                  <tr key={a.id}>
                    <td className="clause-name">{a.contractName}</td>
                    <td><span className={`risk-badge ${a.overallRisk || ''}`}>{a.status}</span></td>
                    <td>{a.overallRisk || '—'}</td>
                    <td>{a.riskScore != null ? a.riskScore : '—'}</td>
                    <td>{a.clausesDetected}</td>
                    <td>{a.gapsFound}</td>
                    <td>{new Date(a.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button className="action-btn" onClick={() => handleViewAudit(a.id)}>View</button>
                      <button className="action-btn delete" onClick={() => handleDelete(a.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === 'report' && report && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <button className="nav-btn" onClick={() => setView('history')}>
              &larr; Back to History
            </button>
            <button className="export-btn" onClick={async () => {
              try {
                const blob = await exportJson(selectedAudit.id);
                downloadBlob(blob, `audit-${selectedAudit.contractName}.json`);
              } catch (err) { alert('Export failed: ' + err.message); }
            }}>Export JSON</button>
            <button className="export-btn" onClick={async () => {
              try {
                const blob = await exportCsv(selectedAudit.id);
                downloadBlob(blob, `audit-${selectedAudit.contractName}.csv`);
              } catch (err) { alert('Export failed: ' + err.message); }
            }}>Export CSV</button>
            <button className="upload-btn" style={{ background: 'var(--accent-green)' }} onClick={async () => {
              try {
                const r = await reAudit(selectedAudit.id);
                alert(`Re-audit queued as v${r.version}`);
                await loadAudits();
              } catch (err) { alert('Re-audit failed: ' + err.message); }
            }}>Re-Audit</button>
            <button className="nav-btn" onClick={async () => {
              try {
                const v = await getVersions(selectedAudit.id);
                setVersions(v.versions);
                setView('versions');
              } catch (err) { alert('Failed: ' + err.message); }
            }}>Versions</button>
            <button className="nav-btn" onClick={() => { setView('share'); loadShares(selectedAudit.id); }}>Share</button>
            <button className="nav-btn" onClick={() => { setView('comments'); loadComments(selectedAudit.id); }}>Comments</button>
            {selectedAudit.status === 'complete' && (
              <button className="nav-btn" onClick={async () => {
                try { const c = await getComplianceReport(selectedAudit.id); setCompliance(c); setView('compliance'); }
                catch (err) { alert('Failed: ' + err.message); }
              }}>Compliance</button>
            )}
            {selectedAudit.status === 'complete' && (
              <>
                <button className="nav-btn" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }} onClick={async () => {
                  setAiLoading(true);
                  try { const d = await aiSummary(selectedAudit.id); setAiData(d); setView('ai-summary'); }
                  catch (err) { alert('AI Summary failed: ' + err.message); }
                  finally { setAiLoading(false); }
                }}>{aiLoading ? '...' : 'AI Summary'}</button>
                <button className="nav-btn" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }} onClick={async () => {
                  setAiLoading(true);
                  try { const d = await aiAnalyze(selectedAudit.id); setAiData(d); setView('ai-analyze'); }
                  catch (err) { alert('AI Analyze failed: ' + err.message); }
                  finally { setAiLoading(false); }
                }}>AI Analyze</button>
                <button className="nav-btn" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }} onClick={async () => {
                  setAiLoading(true);
                  try { const d = await aiRemediate(selectedAudit.id); setAiData(d); setView('ai-remediate'); }
                  catch (err) { alert('AI Remediation failed: ' + err.message); }
                  finally { setAiLoading(false); }
                }}>AI Remediation</button>
                <button className="nav-btn" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }} onClick={async () => {
                  setAiLoading(true);
                  try { const d = await aiExplain(selectedAudit.id); setAiData(d); setView('ai-explain'); }
                  catch (err) { alert('AI Explain Risk failed: ' + err.message); }
                  finally { setAiLoading(false); }
                }}>AI Explain</button>
              </>
            )}
          </div>

          {/* Tags bar */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Tags:</span>
            {auditTags.map(t => (
              <span key={t} className="ref-tag" style={{ cursor: 'pointer' }} onClick={async () => {
                const next = auditTags.filter(x => x !== t);
                try { await updateTags(selectedAudit.id, next); setAuditTags(next); } catch {}
              }}>{t} ×</span>
            ))}
            <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)}
              placeholder="Add tag..." style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--text-primary)', fontSize: 12, width: 100 }}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  e.preventDefault();
                  const next = [...new Set([...auditTags, tagInput.trim().toLowerCase()])];
                  try { await updateTags(selectedAudit.id, next); setAuditTags(next); setTagInput(''); } catch {}
                }
              }} />
          </div>

          <div className="top-row">
            <div className="card">
              <h2>Overall Risk</h2>
              <RiskGauge score={rp.score || 0} riskLevel={rp.overall_risk || 'Low'} />
            </div>
            <div className="card">
              <h2>Clause Risk Scores</h2>
              <ClauseScoresTable clauseScores={rp.clause_scores || []} />
            </div>
          </div>

          <div className="bottom-grid">
            <div className="card">
              <h2>Framework Coverage</h2>
              <FrameworkHeatmap complianceMatrix={report.compliance_matrix || {}} />
            </div>
            <div className="card">
              <h2>Gap Report</h2>
              <GapReport gaps={report.gap_report || []} />
            </div>
          </div>

          <div className="card full-width">
            <h2>Remediation Plan</h2>
            <RemediationPlan plan={report.remediation_plan || []} />
          </div>
        </>
      )}

      {view === 'report' && !report && (
        <div className="card">
          <p className="subtitle">No report available for this audit.</p>
        </div>
      )}

      {view === 'versions' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ marginBottom: 0 }}>Version History</h2>
            <button className="nav-btn" onClick={() => setView('report')}>&larr; Back</button>
          </div>
          {versions.length === 0 ? <p className="subtitle">No versions found.</p> : (
            <table className="scores-table">
              <thead><tr><th>Version</th><th>Status</th><th>Risk</th><th>Score</th><th>Clauses</th><th>Gaps</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {versions.map(v => (
                  <tr key={v.id}>
                    <td><strong>v{v.version}</strong></td>
                    <td><span className={`risk-badge ${v.overallRisk || ''}`}>{v.status}</span></td>
                    <td>{v.overallRisk || '—'}</td>
                    <td>{v.riskScore != null ? v.riskScore : '—'}</td>
                    <td>{v.clausesDetected}</td>
                    <td>{v.gapsFound}</td>
                    <td>{new Date(v.createdAt).toLocaleDateString()}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="action-btn" onClick={() => handleViewAudit(v.id)}>View</button>
                      {selectedAudit && v.id !== selectedAudit.id && (
                        <button className="action-btn" style={{ color: 'var(--accent-purple)', borderColor: 'var(--accent-purple)' }}
                          onClick={async () => {
                            try {
                              const d = await getVersionDiff(selectedAudit.id, v.id);
                              setDiffData(d); setView('diff');
                            } catch (err) { alert('Diff failed: ' + err.message); }
                          }}>Diff</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === 'share' && selectedAudit && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ marginBottom: 0 }}>Share: {selectedAudit.contractName}</h2>
            <button className="nav-btn" onClick={() => setView('report')}>&larr; Back</button>
          </div>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const email = e.target.email.value;
            if (!email) return;
            try {
              await shareAudit(selectedAudit.id, email);
              e.target.email.value = '';
              await loadShares(selectedAudit.id);
            } catch (err) { alert('Share failed: ' + err.message); }
          }} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input name="email" type="email" placeholder="Email to share with" className="auth-input" style={{ marginBottom: 0, maxWidth: 300 }} required />
            <button type="submit" className="upload-btn">Share</button>
          </form>
          {shares.length === 0 ? <p className="subtitle">Not shared with anyone.</p> : (
            <table className="scores-table">
              <thead><tr><th>Shared With</th><th>Permission</th><th>Expires</th><th>Actions</th></tr></thead>
              <tbody>
                {shares.map(s => (
                  <tr key={s.id}>
                    <td>{s.sharedWith}</td>
                    <td><span className="ref-tag">{s.permission}</span></td>
                    <td>{s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : 'Never'}</td>
                    <td><button className="action-btn delete" onClick={async () => { await revokeShare(s.id); await loadShares(selectedAudit.id); }}>Revoke</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === 'comments' && selectedAudit && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ marginBottom: 0 }}>Comments: {selectedAudit.contractName}</h2>
            <button className="nav-btn" onClick={() => setView('report')}>&larr; Back</button>
          </div>
          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!commentText.trim()) return;
            try {
              await addComment(selectedAudit.id, commentText, commentClause || null);
              setCommentText(''); setCommentClause('');
              await loadComments(selectedAudit.id);
            } catch (err) { alert('Failed: ' + err.message); }
          }} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input type="text" value={commentClause} onChange={e => setCommentClause(e.target.value)}
                placeholder="Clause (optional, e.g. audit_rights)" className="auth-input" style={{ marginBottom: 0, maxWidth: 220 }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea value={commentText} onChange={e => setCommentText(e.target.value)}
                placeholder="Write a comment..." rows={3}
                style={{ flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, color: 'var(--text-primary)', fontSize: 14, resize: 'vertical' }} />
              <button type="submit" className="upload-btn" style={{ alignSelf: 'flex-end' }}>Post</button>
            </div>
          </form>
          {comments.length === 0 ? <p className="subtitle">No comments yet.</p> : (
            <div>
              {comments.map(c => (
                <div key={c.id} style={{
                  padding: 12, marginBottom: 8, background: 'var(--bg-primary)', borderRadius: 8,
                  borderLeft: c.clause ? '3px solid var(--accent-blue)' : '3px solid var(--border)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div>
                      <strong style={{ fontSize: 13 }}>{c.userName || c.userEmail}</strong>
                      {c.clause && <span className="ref-tag" style={{ marginLeft: 8 }}>{c.clause}</span>}
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    {c.userId === (selectedAudit?.userId || '') && (
                      <button className="action-btn delete" onClick={async () => {
                        if (!window.confirm('Delete comment?')) return;
                        await deleteComment(selectedAudit.id, c.id);
                        await loadComments(selectedAudit.id);
                      }}>Delete</button>
                    )}
                  </div>
                  <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'diff' && diffData && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ marginBottom: 0 }}>Version Diff</h2>
            <button className="nav-btn" onClick={() => setView('versions')}>&larr; Back</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div className="remediation-card">
              <h3>v{diffData.meta.left.version} — {diffData.meta.left.contractName}</h3>
              <div className="subtitle">{new Date(diffData.meta.left.createdAt).toLocaleString()}</div>
            </div>
            <div className="remediation-card">
              <h3>v{diffData.meta.right.version} — {diffData.meta.right.contractName}</h3>
              <div className="subtitle">{new Date(diffData.meta.right.createdAt).toLocaleString()}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Risk Score</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{diffData.riskScore.left ?? '—'} → {diffData.riskScore.right ?? '—'}</div>
              <div style={{ color: diffData.riskScore.delta > 0 ? 'var(--accent-red)' : diffData.riskScore.delta < 0 ? 'var(--accent-green)' : 'var(--text-secondary)', fontSize: 13 }}>
                {diffData.riskScore.delta > 0 ? '+' : ''}{diffData.riskScore.delta.toFixed(1)}
              </div>
            </div>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Overall Risk</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{diffData.overallRisk.left || '—'} → {diffData.overallRisk.right || '—'}</div>
              <div style={{ color: diffData.overallRisk.changed ? 'var(--accent-yellow)' : 'var(--text-secondary)', fontSize: 13 }}>
                {diffData.overallRisk.changed ? 'Changed' : 'Unchanged'}
              </div>
            </div>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Clauses</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{diffData.clausesDetected.left} → {diffData.clausesDetected.right}</div>
              <div style={{ color: diffData.clausesDetected.delta !== 0 ? 'var(--accent-blue)' : 'var(--text-secondary)', fontSize: 13 }}>
                {diffData.clausesDetected.delta > 0 ? '+' : ''}{diffData.clausesDetected.delta}
              </div>
            </div>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Gaps</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{diffData.gapsFound.left} → {diffData.gapsFound.right}</div>
              <div style={{ color: diffData.gapsFound.delta > 0 ? 'var(--accent-red)' : diffData.gapsFound.delta < 0 ? 'var(--accent-green)' : 'var(--text-secondary)', fontSize: 13 }}>
                {diffData.gapsFound.delta > 0 ? '+' : ''}{diffData.gapsFound.delta}
              </div>
            </div>
          </div>
          {diffData.clauses.length > 0 && (
            <table className="scores-table">
              <thead><tr><th>Clause</th><th>Left Score</th><th>Right Score</th><th>Delta</th><th>Status</th></tr></thead>
              <tbody>
                {diffData.clauses.map(c => (
                  <tr key={c.clause}>
                    <td className="clause-name">{c.clause.replace(/_/g, ' ')}</td>
                    <td>{c.left ?? '—'}</td>
                    <td>{c.right ?? '—'}</td>
                    <td style={{ color: c.delta > 0 ? 'var(--accent-green)' : c.delta < 0 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                      {c.delta > 0 ? '+' : ''}{c.delta}
                    </td>
                    <td><span className="ref-tag" style={
                      c.status === 'added' ? { background: 'rgba(34,197,94,0.15)', color: 'var(--accent-green)' } :
                      c.status === 'removed' ? { background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)' } :
                      c.status === 'changed' ? { background: 'rgba(234,179,8,0.15)', color: 'var(--accent-yellow)' } :
                      {}
                    }>{c.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === 'compliance' && compliance && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ marginBottom: 0 }}>Compliance Report: {compliance.audit.contractName}</h2>
            <button className="nav-btn" onClick={() => setView('report')}>&larr; Back</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Compliance Rate</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: compliance.summary.complianceRate >= 80 ? 'var(--accent-green)' : compliance.summary.complianceRate >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)' }}>
                {compliance.summary.complianceRate}%
              </div>
            </div>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Compliant</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-green)' }}>{compliance.summary.compliant}</div>
              <div className="subtitle">of {compliance.summary.totalClauses} clauses</div>
            </div>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Partial</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-yellow)' }}>{compliance.summary.partial}</div>
            </div>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Non-Compliant</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-red)' }}>{compliance.summary.nonCompliant}</div>
            </div>
          </div>

          <h3>Clause Breakdown</h3>
          <table className="scores-table" style={{ marginBottom: 24 }}>
            <thead><tr><th>Clause</th><th>Score</th><th>Status</th></tr></thead>
            <tbody>
              {compliance.clauseBreakdown.map(c => (
                <tr key={c.clause}>
                  <td className="clause-name">{c.clause.replace(/_/g, ' ')}</td>
                  <td>{c.score}</td>
                  <td><span className="ref-tag" style={
                    c.status === 'compliant' ? { background: 'rgba(34,197,94,0.15)', color: 'var(--accent-green)' } :
                    c.status === 'partial' ? { background: 'rgba(234,179,8,0.15)', color: 'var(--accent-yellow)' } :
                    c.status === 'weak' ? { background: 'rgba(249,115,22,0.15)', color: '#f97316' } :
                    { background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)' }
                  }>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>

          {compliance.criticalFindings.length > 0 && (
            <>
              <h3>Critical Findings</h3>
              {compliance.criticalFindings.map((f, i) => (
                <div key={i} className="remediation-card" style={{ borderLeft: f.severity === 'critical' ? '3px solid var(--accent-red)' : '3px solid #f97316' }}>
                  <div className="rem-header">
                    <h4 style={{ margin: 0 }}>{f.clause.replace(/_/g, ' ')}</h4>
                    <span className="ref-tag" style={
                      f.severity === 'critical' ? { background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)' }
                      : { background: 'rgba(249,115,22,0.15)', color: '#f97316' }
                    }>{f.severity}</span>
                  </div>
                  <div className="suggested" style={{ marginTop: 8 }}>{f.recommendation}</div>
                </div>
              ))}
            </>
          )}

          <div className="subtitle" style={{ marginTop: 16 }}>
            Generated: {new Date(compliance.generatedAt).toLocaleString()} | Version: v{compliance.audit.version}
          </div>
        </div>
      )}

      {/* AI Summary View */}
      {view === 'ai-summary' && aiData && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ marginBottom: 0, color: '#a78bfa' }}>AI Executive Summary</h2>
            <button className="nav-btn" onClick={() => setView('report')}>&larr; Back</button>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 14 }}
            dangerouslySetInnerHTML={{ __html: aiData.summary
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/^## (.*)/gm, '<h2 style="color:#a78bfa;margin-top:20px">$1</h2>')
              .replace(/^### (.*)/gm, '<h3 style="margin-top:16px">$1</h3>')
              .replace(/^\d+\.\s/gm, (m) => `<br/>${m}`)
            }} />
        </div>
      )}

      {/* AI Clause Analysis View */}
      {view === 'ai-analyze' && aiData && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ marginBottom: 0, color: '#a78bfa' }}>AI Clause Analysis</h2>
            <button className="nav-btn" onClick={() => setView('report')}>&larr; Back</button>
          </div>
          {(aiData.analyses || [aiData.analysis]).map(a => (
            <div key={a.clause} className="remediation-card" style={{
              marginBottom: 12,
              borderLeft: `3px solid ${a.riskLevel === 'critical' ? 'var(--accent-red)' : a.riskLevel === 'high' ? '#f97316' : a.riskLevel === 'medium' ? 'var(--accent-yellow)' : 'var(--accent-green)'}`
            }}>
              <div className="rem-header">
                <h4 style={{ margin: 0 }}>{a.displayName || a.clause}</h4>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="ref-tag">{a.score}/100</span>
                  <span className="ref-tag" style={{
                    background: a.riskLevel === 'critical' ? 'rgba(239,68,68,0.15)' : a.riskLevel === 'high' ? 'rgba(249,115,22,0.15)' : a.riskLevel === 'medium' ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.15)',
                    color: a.riskLevel === 'critical' ? 'var(--accent-red)' : a.riskLevel === 'high' ? '#f97316' : a.riskLevel === 'medium' ? 'var(--accent-yellow)' : 'var(--accent-green)'
                  }}>{a.riskLevel}</span>
                </div>
              </div>
              {a.gdprArticle && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>GDPR: {a.gdprArticle}</div>}
              <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}
                dangerouslySetInnerHTML={{ __html: (a.analysis || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
              {a.bestPractice && (
                <div style={{ marginTop: 8, padding: 8, background: 'rgba(34,197,94,0.06)', borderRadius: 6, fontSize: 13 }}>
                  <strong style={{ color: 'var(--accent-green)' }}>Best Practice:</strong> {a.bestPractice}
                </div>
              )}
              {a.remediation && (
                <div style={{ marginTop: 8, padding: 8, background: 'rgba(139,92,246,0.06)', borderRadius: 6, fontSize: 13 }}>
                  <strong style={{ color: '#a78bfa' }}>Suggested Remediation:</strong> {a.remediation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* AI Remediation Plan View */}
      {view === 'ai-remediate' && aiData && aiData.plan && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ marginBottom: 0, color: '#a78bfa' }}>AI Remediation Plan</h2>
            <button className="nav-btn" onClick={() => setView('report')}>&larr; Back</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Total Items</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{aiData.plan.totalItems}</div>
            </div>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Critical</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-red)' }}>{aiData.plan.criticalCount}</div>
            </div>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">High</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#f97316' }}>{aiData.plan.highCount}</div>
            </div>
            <div className="remediation-card" style={{ textAlign: 'center' }}>
              <div className="subtitle">Est. Hours</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-blue)' }}>{aiData.plan.estimatedTotalHours}</div>
            </div>
          </div>
          {aiData.plan.items.map((item, i) => (
            <div key={i} className="remediation-card" style={{
              marginBottom: 12,
              borderLeft: `3px solid ${item.priority === 1 ? 'var(--accent-red)' : item.priority === 2 ? '#f97316' : 'var(--accent-yellow)'}`
            }}>
              <div className="rem-header">
                <h4 style={{ margin: 0 }}>{item.displayName}</h4>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="ref-tag" style={{
                    background: item.priority === 1 ? 'rgba(239,68,68,0.15)' : item.priority === 2 ? 'rgba(249,115,22,0.15)' : 'rgba(234,179,8,0.15)',
                    color: item.priority === 1 ? 'var(--accent-red)' : item.priority === 2 ? '#f97316' : 'var(--accent-yellow)'
                  }}>{item.priorityLabel}</span>
                  <span className="ref-tag">{item.currentScore} → {item.targetScore}</span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{item.gdprArticle} | {item.effort} | ~{item.estimatedTimeHours}h</div>
              <div style={{ marginTop: 8, fontSize: 14 }}>{item.issue}</div>
              <div style={{ marginTop: 8, padding: 8, background: 'rgba(139,92,246,0.06)', borderRadius: 6, fontSize: 13 }}>
                <strong style={{ color: '#a78bfa' }}>Suggested Language:</strong> {item.suggestedLanguage}
              </div>
              <div style={{ marginTop: 8, padding: 8, background: 'rgba(239,68,68,0.06)', borderRadius: 6, fontSize: 13 }}>
                <strong style={{ color: 'var(--accent-red)' }}>Regulatory Impact:</strong> {item.regulatoryImpact}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Risk Explanation View */}
      {view === 'ai-explain' && aiData && aiData.explanation && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ marginBottom: 0, color: '#a78bfa' }}>AI Risk Explanation</h2>
            <button className="nav-btn" onClick={() => setView('report')}>&larr; Back</button>
          </div>
          <div style={{ marginBottom: 20, padding: 16, background: 'rgba(139,92,246,0.06)', borderRadius: 8, fontSize: 15, lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{ __html: aiData.explanation.explanation.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
          <div style={{ marginBottom: 16, padding: 12, background: 'rgba(34,197,94,0.06)', borderRadius: 8, fontSize: 14 }}>
            <strong>Recommendation:</strong> {aiData.explanation.recommendation}
          </div>
          {aiData.explanation.factors.length > 0 && (
            <>
              <h3>Risk Factors</h3>
              {aiData.explanation.factors.map((f, i) => (
                <div key={i} className="remediation-card" style={{
                  marginBottom: 8,
                  borderLeft: `3px solid ${f.impact === 'critical' ? 'var(--accent-red)' : f.impact === 'high' ? '#f97316' : 'var(--accent-yellow)'}`
                }}>
                  <div className="rem-header">
                    <strong>{f.clause.replace(/_/g, ' ')}</strong>
                    <span className="ref-tag" style={{
                      background: f.impact === 'critical' ? 'rgba(239,68,68,0.15)' : f.impact === 'high' ? 'rgba(249,115,22,0.15)' : 'rgba(234,179,8,0.15)',
                      color: f.impact === 'critical' ? 'var(--accent-red)' : f.impact === 'high' ? '#f97316' : 'var(--accent-yellow)'
                    }}>{f.impact}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13 }}>{f.explanation}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
