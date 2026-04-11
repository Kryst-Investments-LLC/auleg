import React, { useState, useEffect } from 'react';
import {
  getRedlines, runRedlineAnalysis, updateRedlineStatus as updateRedlineApi,
  getJurisdictions, getGapMatrix, getConfidenceScores,
  getNegotiations, createNegotiation,
  getApprovalChains, createApprovalChain, processApprovalStep,
  getCounterpartyLinks, createCounterpartyLink,
  getVendorAssessments, createVendorAssessment,
  getBoardReport, getCertificates, issueCertificate, getEvidenceTrail,
  getBenchmarks, refreshBenchmarks,
  getIntegrations as fetchIntegrations, saveIntegration, deleteIntegration, testIntegrationNotify,
  getCustomFrameworks, createCustomFramework,
  getRegulatoryAlerts, generateRegulatoryAlerts, markAlertRead,
  getSsoConfig, saveSsoConfig
} from './api';

const TABS = [
  'Redlining', 'Gap Matrix', 'Jurisdictions', 'Confidence',
  'Negotiations', 'Approvals', 'Counterparty', 'Vendors',
  'Board Report', 'Certificates', 'Evidence', 'Benchmarks',
  'Integrations', 'Frameworks', 'Alerts', 'SSO'
];

export default function AdvancedPage({ onBack }) {
  const [tab, setTab] = useState('Redlining');

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Advanced Features</h1>
          <p className="subtitle">Redlining, compliance intelligence, workflows, reporting, and integrations</p>
        </div>
        <button className="action-btn" onClick={onBack}>← Back</button>
      </div>

      <div className="legal-tabs" style={{ flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t} className={`legal-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Redlining' && <RedliningTab />}
      {tab === 'Gap Matrix' && <GapMatrixTab />}
      {tab === 'Jurisdictions' && <JurisdictionsTab />}
      {tab === 'Confidence' && <ConfidenceTab />}
      {tab === 'Negotiations' && <NegotiationsTab />}
      {tab === 'Approvals' && <ApprovalsTab />}
      {tab === 'Counterparty' && <CounterpartyTab />}
      {tab === 'Vendors' && <VendorsTab />}
      {tab === 'Board Report' && <BoardReportTab />}
      {tab === 'Certificates' && <CertificatesTab />}
      {tab === 'Evidence' && <EvidenceTab />}
      {tab === 'Benchmarks' && <BenchmarksTab />}
      {tab === 'Integrations' && <IntegrationsTab />}
      {tab === 'Frameworks' && <FrameworksTab />}
      {tab === 'Alerts' && <AlertsTab />}
      {tab === 'SSO' && <SsoTab />}
    </div>
  );
}

// ─── Redlining Tab ────────────────────────────────────

function RedliningTab() {
  const [auditId, setAuditId] = useState('');
  const [redlines, setRedlines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const load = async () => {
    if (!auditId) return;
    setLoading(true);
    try { const r = await getRedlines(auditId); setRedlines(r.redlines || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const analyze = async () => {
    if (!auditId) return;
    setAnalyzing(true);
    try { const r = await runRedlineAnalysis(auditId); setRedlines(r.redlines || []); } catch (e) { alert('Analysis failed: ' + e.message); }
    setAnalyzing(false);
  };

  const updateStatus = async (id, status) => {
    try { await updateRedlineApi(id, status); load(); } catch (e) { console.error(e); }
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={auditId} onChange={e => setAuditId(e.target.value)} placeholder="Enter Audit ID" className="legal-chat-input" style={{ maxWidth: 400 }} />
        <button className="action-btn" onClick={load} disabled={loading}>Load Redlines</button>
        <button className="action-btn primary" onClick={analyze} disabled={analyzing}>{analyzing ? 'Analyzing...' : 'Run Analysis'}</button>
      </div>
      {redlines.length === 0 && !loading && <p className="subtitle">Enter an Audit ID and run analysis to see clause-by-clause redline suggestions.</p>}
      {redlines.map(r => (
        <div key={r.id} className="legal-enforcement-card" style={{ borderLeft: `3px solid ${r.severity === 'critical' ? 'var(--accent-red)' : r.severity === 'high' ? '#f97316' : 'var(--accent-yellow)'}` }}>
          <div className="legal-enf-header">
            <span className={`legal-severity ${r.severity}`}>{r.severity?.toUpperCase()}</span>
            <span className="legal-enf-authority">{r.clause?.replace(/_/g, ' ')}</span>
            <span style={{ marginLeft: 'auto', fontSize: 12 }}>Confidence: {Math.round(r.confidence * 100)}%</span>
          </div>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-red)', marginBottom: 4 }}>ORIGINAL:</div>
            <div style={{ fontSize: 13, padding: 8, background: 'rgba(239,68,68,0.06)', borderRadius: 6, textDecoration: 'line-through', opacity: 0.7 }}>{r.originalText}</div>
          </div>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-green)', marginBottom: 4 }}>SUGGESTED:</div>
            <div style={{ fontSize: 13, padding: 8, background: 'rgba(34,197,94,0.06)', borderRadius: 6 }}>{r.suggestedText}</div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>{r.explanation}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="action-btn" style={{ color: 'var(--accent-green)', borderColor: 'var(--accent-green)' }} onClick={() => updateStatus(r.id, 'accepted')} disabled={r.status !== 'pending'}>
              {r.status === 'accepted' ? '✓ Accepted' : 'Accept'}
            </button>
            <button className="action-btn" style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }} onClick={() => updateStatus(r.id, 'rejected')} disabled={r.status !== 'pending'}>
              {r.status === 'rejected' ? '✗ Rejected' : 'Reject'}
            </button>
            <span className="legal-clause-tag" style={{ marginLeft: 'auto' }}>{r.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Gap Matrix Tab ──────────────────────────────────

function GapMatrixTab() {
  const [auditId, setAuditId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!auditId) return;
    setLoading(true);
    try { const r = await getGapMatrix(auditId); setData(r); } catch (e) { alert(e.message); }
    setLoading(false);
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={auditId} onChange={e => setAuditId(e.target.value)} placeholder="Enter Audit ID" className="legal-chat-input" style={{ maxWidth: 400 }} />
        <button className="action-btn primary" onClick={load} disabled={loading}>Load Gap Matrix</button>
      </div>
      {data && (
        <>
          <div className="legal-trends-summary" style={{ marginBottom: 24 }}>
            <div className="legal-trend-stat">
              <div className="legal-trend-number">{data.summary?.regulationsChecked || 0}</div>
              <div className="legal-trend-label">Regulations Checked</div>
            </div>
            <div className="legal-trend-stat">
              <div className="legal-trend-number" style={{ color: 'var(--accent-red)' }}>{data.summary?.totalCriticalGaps || 0}</div>
              <div className="legal-trend-label">Critical Gaps</div>
            </div>
          </div>
          {Object.entries(data.gapMatrix || {}).map(([reg, info]) => (
            <div key={reg} className="legal-enforcement-card" style={{ marginBottom: 16 }}>
              <div className="legal-enf-header">
                <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)' }}>{reg}</span>
                <span className="legal-enf-authority">{info.jurisdiction}</span>
                <span style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 700, color: info.complianceRate >= 80 ? 'var(--accent-green)' : info.complianceRate >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)' }}>
                  {info.complianceRate}% Compliant
                </span>
              </div>
              <table className="scores-table" style={{ marginTop: 12 }}>
                <thead><tr><th>Clause</th><th>Score</th><th>Required</th><th>Article</th><th>Status</th><th>Gap</th></tr></thead>
                <tbody>
                  {Object.entries(info.clauses || {}).map(([clause, ci]) => (
                    <tr key={clause}>
                      <td className="clause-name">{clause.replace(/_/g, ' ')}</td>
                      <td>{ci.score}</td>
                      <td>{ci.minScore}</td>
                      <td style={{ fontSize: 12 }}>{ci.article}</td>
                      <td><span className="ref-tag" style={ci.status === 'compliant' ? { background: 'rgba(34,197,94,0.15)', color: 'var(--accent-green)' } : ci.status === 'partial' ? { background: 'rgba(234,179,8,0.15)', color: 'var(--accent-yellow)' } : { background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)' }}>{ci.status}</span></td>
                      <td style={{ color: ci.gap > 0 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: 700 }}>{ci.gap > 0 ? `-${ci.gap}` : '✓'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
      {!data && !loading && <p className="subtitle">Enter an Audit ID to see cross-regulation compliance gaps.</p>}
    </div>
  );
}

// ─── Jurisdictions Tab ───────────────────────────────

function JurisdictionsTab() {
  const [auditId, setAuditId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!auditId) return;
    setLoading(true);
    try { const r = await getJurisdictions(auditId); setData(r); } catch (e) { alert(e.message); }
    setLoading(false);
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={auditId} onChange={e => setAuditId(e.target.value)} placeholder="Enter Audit ID" className="legal-chat-input" style={{ maxWidth: 400 }} />
        <button className="action-btn primary" onClick={load} disabled={loading}>Detect Jurisdictions</button>
      </div>
      {data && (data.jurisdictions || []).map((j, i) => (
        <div key={i} className="legal-reg-card" style={{ marginBottom: 12, cursor: 'default' }}>
          <div className="legal-reg-code">{j.regulation}</div>
          <div className="legal-reg-name">{j.jurisdiction}</div>
          <div style={{ marginTop: 8 }}>
            <div style={{ background: 'var(--bg-main)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ background: 'var(--accent)', height: '100%', width: `${j.confidence * 100}%`, borderRadius: 4 }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Confidence: {Math.round(j.confidence * 100)}%</div>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(j.matches || []).slice(0, 5).map((m, k) => (
              <span key={k} className="legal-clause-tag">{m.type}: {m.term} (×{m.count})</span>
            ))}
          </div>
        </div>
      ))}
      {data && (data.jurisdictions || []).length === 0 && <p className="subtitle">No jurisdictions detected in this document.</p>}
      {!data && !loading && <p className="subtitle">Enter an Audit ID to auto-detect applicable regulations.</p>}
    </div>
  );
}

// ─── Confidence Tab ──────────────────────────────────

function ConfidenceTab() {
  const [auditId, setAuditId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!auditId) return;
    setLoading(true);
    try { const r = await getConfidenceScores(auditId); setData(r); } catch (e) { alert(e.message); }
    setLoading(false);
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={auditId} onChange={e => setAuditId(e.target.value)} placeholder="Enter Audit ID" className="legal-chat-input" style={{ maxWidth: 400 }} />
        <button className="action-btn primary" onClick={load} disabled={loading}>Load Confidence</button>
      </div>
      {data && (
        <>
          <div className="legal-trends-summary" style={{ marginBottom: 24 }}>
            <div className="legal-trend-stat">
              <div className="legal-trend-number">{Math.round((data.overallConfidence || 0) * 100)}%</div>
              <div className="legal-trend-label">Overall Confidence</div>
            </div>
            <div className="legal-trend-stat">
              <div className="legal-trend-number" style={{ color: 'var(--accent-red)' }}>{(data.lowConfidenceClauses || []).length}</div>
              <div className="legal-trend-label">Needs Manual Review</div>
            </div>
          </div>
          {(data.confidenceScores || []).map(c => (
            <div key={c.clause} className="legal-article-card" style={{ marginBottom: 8 }}>
              <div className="legal-article-header">
                <span className="legal-article-title">{c.clause?.replace(/_/g, ' ')}</span>
                <span className="ref-tag">{c.score}/100</span>
                <span className={`legal-severity ${c.reliability === 'high' ? 'low' : c.reliability === 'medium' ? 'medium' : 'high'}`}>{c.reliability} confidence</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1, background: 'var(--bg-main)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: c.confidence >= 0.85 ? 'var(--accent-green)' : c.confidence >= 0.7 ? 'var(--accent-yellow)' : 'var(--accent-red)', height: '100%', width: `${c.confidence * 100}%`, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{Math.round(c.confidence * 100)}%</span>
              </div>
              {c.reliability === 'low' && <div style={{ fontSize: 12, color: 'var(--accent-red)', marginTop: 4 }}>{c.recommendation}</div>}
            </div>
          ))}
        </>
      )}
      {!data && !loading && <p className="subtitle">Enter an Audit ID to see AI confidence scores for each clause.</p>}
    </div>
  );
}

// ─── Negotiations Tab ─────────────────────────────────

function NegotiationsTab() {
  const [negs, setNegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newCounterparty, setNewCounterparty] = useState('');
  const [newAuditId, setNewAuditId] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { const r = await getNegotiations(); setNegs(r.negotiations || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const create = async () => {
    if (!newTitle || !newCounterparty) return;
    try {
      await createNegotiation({ title: newTitle, counterparty: newCounterparty, auditId: newAuditId || undefined });
      setNewTitle(''); setNewCounterparty(''); setNewAuditId('');
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="legal-section">
      <div className="legal-draft-form" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>New Negotiation</h3>
        <div className="legal-draft-row"><label>Title</label><input value={newTitle} onChange={e => setNewTitle(e.target.value)} className="legal-select" placeholder="e.g. Vendor DPA Negotiation" /></div>
        <div className="legal-draft-row"><label>Counterparty</label><input value={newCounterparty} onChange={e => setNewCounterparty(e.target.value)} className="legal-select" placeholder="Company name" /></div>
        <div className="legal-draft-row"><label>Audit ID (optional)</label><input value={newAuditId} onChange={e => setNewAuditId(e.target.value)} className="legal-select" placeholder="Link to existing audit" /></div>
        <button className="action-btn primary" onClick={create}>Create Negotiation</button>
      </div>
      {loading ? <p className="subtitle">Loading...</p> : negs.length === 0 ? <p className="subtitle">No negotiations yet.</p> : negs.map(n => (
        <div key={n.id} className="legal-enforcement-card" style={{ marginBottom: 12 }}>
          <div className="legal-enf-header">
            <span style={{ fontWeight: 700, fontSize: 16 }}>{n.title}</span>
            <span className={`legal-severity ${n.status === 'accepted' ? 'low' : n.status === 'rejected' ? 'critical' : 'medium'}`}>{n.status}</span>
          </div>
          <div style={{ fontSize: 14 }}>Counterparty: <strong>{n.counterparty}</strong> • Round {n.currentRound} • {n._count?.clauses || 0} clauses tracked</div>
          <div className="subtitle" style={{ marginTop: 4 }}>Created: {new Date(n.createdAt).toLocaleDateString()}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Approvals Tab ───────────────────────────────────

function ApprovalsTab() {
  const [auditId, setAuditId] = useState('');
  const [chains, setChains] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!auditId) return;
    setLoading(true);
    try { const r = await getApprovalChains(auditId); setChains(r.chains || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const quickCreate = async () => {
    if (!auditId) return;
    try {
      await createApprovalChain(auditId, [
        { role: 'legal_reviewer', assignedEmail: 'legal@company.com' },
        { role: 'dpo', assignedEmail: 'dpo@company.com' },
        { role: 'management', assignedEmail: 'cto@company.com' }
      ]);
      load();
    } catch (e) { alert(e.message); }
  };

  const decide = async (stepId, decision) => {
    try { await processApprovalStep(stepId, decision); load(); } catch (e) { alert(e.message); }
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={auditId} onChange={e => setAuditId(e.target.value)} placeholder="Enter Audit ID" className="legal-chat-input" style={{ maxWidth: 400 }} />
        <button className="action-btn" onClick={load} disabled={loading}>Load Approvals</button>
        <button className="action-btn primary" onClick={quickCreate}>Create Chain</button>
      </div>
      {chains.map(c => (
        <div key={c.id} className="legal-enforcement-card" style={{ marginBottom: 16 }}>
          <div className="legal-enf-header">
            <span style={{ fontWeight: 700 }}>{c.title}</span>
            <span className={`legal-severity ${c.status === 'approved' ? 'low' : c.status === 'rejected' ? 'critical' : 'medium'}`}>{c.status}</span>
          </div>
          <div style={{ marginTop: 12 }}>
            {(c.steps || []).map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < c.steps.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: s.status === 'approved' ? 'var(--accent-green)' : s.status === 'rejected' ? 'var(--accent-red)' : 'var(--border)', color: '#fff' }}>{s.stepOrder}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.role?.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.assignedEmail || 'Unassigned'}</div>
                </div>
                <span className="legal-clause-tag">{s.status}</span>
                {s.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="action-btn" style={{ color: 'var(--accent-green)', borderColor: 'var(--accent-green)', fontSize: 11, padding: '2px 8px' }} onClick={() => decide(s.id, 'approved')}>Approve</button>
                    <button className="action-btn" style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)', fontSize: 11, padding: '2px 8px' }} onClick={() => decide(s.id, 'rejected')}>Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {chains.length === 0 && !loading && <p className="subtitle">Enter an Audit ID to view or create approval chains (Legal → DPO → Management).</p>}
    </div>
  );
}

// ─── Counterparty Tab ────────────────────────────────

function CounterpartyTab() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { const r = await getCounterpartyLinks(); setLinks(r.links || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const create = async () => {
    if (!company || !email) return;
    try {
      const r = await createCounterpartyLink({ companyName: company, contactEmail: email });
      alert(`Portal link created! Share this URL:\n${r.portalUrl}`);
      setCompany(''); setEmail('');
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="legal-section">
      <div className="legal-draft-form" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Create Counterparty Portal Link</h3>
        <div className="legal-draft-row"><label>Company Name</label><input value={company} onChange={e => setCompany(e.target.value)} className="legal-select" /></div>
        <div className="legal-draft-row"><label>Contact Email</label><input value={email} onChange={e => setEmail(e.target.value)} className="legal-select" type="email" /></div>
        <button className="action-btn primary" onClick={create}>Generate Link</button>
      </div>
      {links.map(l => (
        <div key={l.id} className="legal-article-card" style={{ marginBottom: 8 }}>
          <div className="legal-article-header">
            <span className="legal-article-title">{l.companyName}</span>
            <span className={`legal-severity ${l.status === 'submitted' ? 'low' : l.status === 'reviewed' ? 'medium' : 'high'}`}>{l.status}</span>
          </div>
          <div className="subtitle">{l.contactEmail} • Expires: {new Date(l.expiresAt).toLocaleDateString()}</div>
        </div>
      ))}
      {links.length === 0 && !loading && <p className="subtitle">No portal links created yet.</p>}
    </div>
  );
}

// ─── Vendors Tab ─────────────────────────────────────

function VendorsTab() {
  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { const r = await getVendorAssessments(); setAssessments(r.assessments || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const create = async () => {
    if (!newName) return;
    try { await createVendorAssessment(newName); setNewName(''); load(); } catch (e) { alert(e.message); }
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Assessment name (e.g. Q2 2026 Review)" className="legal-chat-input" style={{ maxWidth: 400 }} />
        <button className="action-btn primary" onClick={create}>Create Assessment</button>
      </div>
      {assessments.map(a => (
        <div key={a.id} className="legal-enforcement-card" style={{ marginBottom: 12 }}>
          <div className="legal-enf-header">
            <span style={{ fontWeight: 700, fontSize: 16 }}>{a.name}</span>
            <span className={`legal-severity ${a.status === 'complete' ? 'low' : 'medium'}`}>{a.status}</span>
          </div>
          <div className="legal-trends-summary" style={{ marginTop: 12 }}>
            <div className="legal-trend-stat" style={{ padding: 12 }}><div className="legal-trend-number" style={{ fontSize: 24 }}>{a.totalVendors}</div><div className="legal-trend-label">Total</div></div>
            <div className="legal-trend-stat" style={{ padding: 12 }}><div className="legal-trend-number" style={{ fontSize: 24, color: 'var(--accent-green)' }}>{a.completedVendors}</div><div className="legal-trend-label">Complete</div></div>
            <div className="legal-trend-stat" style={{ padding: 12 }}><div className="legal-trend-number" style={{ fontSize: 24 }}>{a.avgRiskScore != null ? a.avgRiskScore.toFixed(0) : '—'}</div><div className="legal-trend-label">Avg Risk</div></div>
            <div className="legal-trend-stat" style={{ padding: 12 }}><div className="legal-trend-number" style={{ fontSize: 24, color: 'var(--accent-red)' }}>{a.highRiskCount}</div><div className="legal-trend-label">High Risk</div></div>
          </div>
          {(a.vendors || []).length > 0 && (
            <table className="scores-table" style={{ marginTop: 12 }}>
              <thead><tr><th>Vendor</th><th>Status</th><th>Risk Score</th><th>Risk Level</th></tr></thead>
              <tbody>{a.vendors.map(v => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 600 }}>{v.vendorName}</td>
                  <td><span className="legal-clause-tag">{v.status}</span></td>
                  <td>{v.riskScore ?? '—'}</td>
                  <td>{v.riskLevel ? <span className={`legal-severity ${v.riskLevel === 'Critical' || v.riskLevel === 'High' ? 'critical' : v.riskLevel === 'Medium' ? 'medium' : 'low'}`}>{v.riskLevel}</span> : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      ))}
      {assessments.length === 0 && !loading && <p className="subtitle">Create a vendor assessment to start bulk DPA analysis.</p>}
    </div>
  );
}

// ─── Board Report Tab ────────────────────────────────

function BoardReportTab() {
  const [auditId, setAuditId] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!auditId) return;
    setLoading(true);
    try { const r = await getBoardReport(auditId); setReport(r); } catch (e) { alert(e.message); }
    setLoading(false);
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={auditId} onChange={e => setAuditId(e.target.value)} placeholder="Enter Audit ID" className="legal-chat-input" style={{ maxWidth: 400 }} />
        <button className="action-btn primary" onClick={load} disabled={loading}>Generate Board Report</button>
      </div>
      {report && (
        <div className="legal-reg-detail" id="board-report">
          <h2>{report.title}</h2>
          <p className="subtitle">Generated: {new Date(report.generatedAt).toLocaleString()}</p>

          <div className="legal-trends-summary" style={{ marginTop: 20, marginBottom: 20 }}>
            <div className="legal-trend-stat"><div className="legal-trend-number" style={{ color: report.executiveSummary.riskScore >= 60 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{report.executiveSummary.riskScore}</div><div className="legal-trend-label">Risk Score</div></div>
            <div className="legal-trend-stat"><div className="legal-trend-number">{report.executiveSummary.complianceRate}%</div><div className="legal-trend-label">Compliance Rate</div></div>
            <div className="legal-trend-stat"><div className="legal-trend-number">{report.executiveSummary.totalClauses}</div><div className="legal-trend-label">Clauses Analyzed</div></div>
            <div className="legal-trend-stat"><div className="legal-trend-number" style={{ color: 'var(--accent-red)' }}>{report.executiveSummary.criticalClauses}</div><div className="legal-trend-label">Critical Issues</div></div>
          </div>

          {report.topIssues?.length > 0 && (
            <>
              <h3>Top 5 Issues</h3>
              {report.topIssues.map((issue, i) => (
                <div key={i} className="legal-article-card" style={{ marginBottom: 8, borderLeft: `3px solid ${issue.severity === 'critical' ? 'var(--accent-red)' : issue.severity === 'high' ? '#f97316' : 'var(--accent-yellow)'}` }}>
                  <div className="legal-article-header">
                    <span style={{ fontWeight: 700 }}>{i + 1}. {issue.displayName}</span>
                    <span className={`legal-severity ${issue.severity}`}>{issue.severity}</span>
                    <span className="ref-tag">{issue.score}/100</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {report.remediationTimeline?.length > 0 && (
            <>
              <h3 style={{ marginTop: 24 }}>Remediation Timeline</h3>
              <table className="scores-table">
                <thead><tr><th>#</th><th>Clause</th><th>Effort</th><th>Est. Days</th></tr></thead>
                <tbody>{report.remediationTimeline.map(r => (
                  <tr key={r.priority}><td>{r.priority}</td><td>{r.displayName}</td><td><span className="legal-clause-tag">{r.effort}</span></td><td>{r.estimatedDays}</td></tr>
                ))}</tbody>
              </table>
            </>
          )}
        </div>
      )}
      {!report && !loading && <p className="subtitle">Generate a board-ready report with executive summary, risk heatmap, and remediation timeline.</p>}
    </div>
  );
}

// ─── Certificates Tab ────────────────────────────────

function CertificatesTab() {
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditId, setAuditId] = useState('');
  const [issuedTo, setIssuedTo] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { const r = await getCertificates(); setCerts(r.certificates || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const issue = async () => {
    if (!auditId) return;
    try { await issueCertificate({ auditId, issuedTo: issuedTo || undefined }); setAuditId(''); setIssuedTo(''); load(); } catch (e) { alert(e.message); }
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input value={auditId} onChange={e => setAuditId(e.target.value)} placeholder="Audit ID" className="legal-chat-input" style={{ maxWidth: 300 }} />
        <input value={issuedTo} onChange={e => setIssuedTo(e.target.value)} placeholder="Issued To (company)" className="legal-chat-input" style={{ maxWidth: 300 }} />
        <button className="action-btn primary" onClick={issue}>Issue Certificate</button>
      </div>
      {certs.map(c => (
        <div key={c.id} className="legal-enforcement-card" style={{ marginBottom: 12 }}>
          <div className="legal-enf-header">
            <span style={{ fontWeight: 800, color: 'var(--accent)', fontSize: 16 }}>{c.certificateNumber}</span>
            <span className={`legal-severity ${c.status === 'active' ? 'low' : c.status === 'revoked' ? 'critical' : 'high'}`}>{c.status}</span>
          </div>
          <div style={{ fontSize: 14 }}>Issued to: <strong>{c.issuedTo}</strong></div>
          <div className="subtitle">Valid: {new Date(c.validFrom).toLocaleDateString()} — {new Date(c.validUntil).toLocaleDateString()} • Score: {c.overallScore} • Frameworks: {c.frameworks}</div>
        </div>
      ))}
      {certs.length === 0 && !loading && <p className="subtitle">No certificates issued yet. Issue one from a completed, low-risk audit.</p>}
    </div>
  );
}

// ─── Evidence Tab ────────────────────────────────────

function EvidenceTab() {
  const [auditId, setAuditId] = useState('');
  const [trail, setTrail] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!auditId) return;
    setLoading(true);
    try { const r = await getEvidenceTrail(auditId); setTrail(r.evidence || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={auditId} onChange={e => setAuditId(e.target.value)} placeholder="Enter Audit ID" className="legal-chat-input" style={{ maxWidth: 400 }} />
        <button className="action-btn primary" onClick={load} disabled={loading}>Load Evidence Trail</button>
      </div>
      {trail.length > 0 && (
        <div style={{ position: 'relative', paddingLeft: 30 }}>
          <div style={{ position: 'absolute', left: 13, top: 0, bottom: 0, width: 2, background: 'var(--border)' }} />
          {trail.map(e => (
            <div key={e.id} style={{ position: 'relative', marginBottom: 16, paddingLeft: 20 }}>
              <div style={{ position: 'absolute', left: -22, top: 4, width: 12, height: 12, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--bg-card)' }} />
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{new Date(e.createdAt).toLocaleString()}</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{e.action?.replace(/_/g, ' ')}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{e.detail}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>By: {e.actorName || e.actor}</div>
            </div>
          ))}
        </div>
      )}
      {trail.length === 0 && !loading && <p className="subtitle">Enter an Audit ID to view its evidence trail for regulatory proof.</p>}
    </div>
  );
}

// ─── Benchmarks Tab ──────────────────────────────────

function BenchmarksTab() {
  const [benchmarks, setBenchmarks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { const r = await getBenchmarks(); setBenchmarks(r.benchmarks || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const refresh = async () => {
    try { await refreshBenchmarks(); load(); } catch (e) { alert(e.message); }
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="action-btn primary" onClick={refresh}>Refresh Benchmarks</button>
      </div>
      {benchmarks.length > 0 ? (
        <table className="scores-table">
          <thead><tr><th>Clause</th><th>Avg Score</th><th>Median</th><th>25th Pct.</th><th>75th Pct.</th><th>Sample Size</th></tr></thead>
          <tbody>{benchmarks.map(b => (
            <tr key={b.id}><td className="clause-name">{b.clause?.replace(/_/g, ' ')}</td><td>{b.avgScore?.toFixed(1)}</td><td>{b.medianScore?.toFixed(1)}</td><td>{b.p25Score?.toFixed(1)}</td><td>{b.p75Score?.toFixed(1)}</td><td>{b.sampleSize}</td></tr>
          ))}</tbody>
        </table>
      ) : <p className="subtitle">{loading ? 'Loading...' : 'No benchmark data yet. Complete some audits and refresh.'}</p>}
    </div>
  );
}

// ─── Integrations Tab ────────────────────────────────

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('slack');
  const [type, setType] = useState('notification');
  const [webhookUrl, setWebhookUrl] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { const r = await fetchIntegrations(); setIntegrations(r.integrations || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const save = async () => {
    if (!webhookUrl) return;
    try {
      await saveIntegration({ provider, type, config: { webhookUrl } });
      setWebhookUrl(''); load();
    } catch (e) { alert(e.message); }
  };

  const test = async () => {
    try { const r = await testIntegrationNotify(); alert(JSON.stringify(r.results, null, 2)); } catch (e) { alert(e.message); }
  };

  const remove = async (id) => {
    try { await deleteIntegration(id); load(); } catch (e) { alert(e.message); }
  };

  return (
    <div className="legal-section">
      <div className="legal-draft-form" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Add Integration</h3>
        <div className="legal-draft-row">
          <label>Provider</label>
          <select value={provider} onChange={e => setProvider(e.target.value)} className="legal-select">
            <option value="slack">Slack</option>
            <option value="teams">Microsoft Teams</option>
            <option value="ironclad">Ironclad (CLM)</option>
            <option value="juro">Juro (CLM)</option>
            <option value="onetrust">OneTrust (GRC)</option>
            <option value="vanta">Vanta (GRC)</option>
          </select>
        </div>
        <div className="legal-draft-row">
          <label>Type</label>
          <select value={type} onChange={e => setType(e.target.value)} className="legal-select">
            <option value="notification">Notification</option>
            <option value="clm">CLM Connector</option>
            <option value="grc">GRC Sync</option>
          </select>
        </div>
        <div className="legal-draft-row"><label>Webhook URL / API Endpoint</label><input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} className="legal-select" placeholder="https://hooks.slack.com/..." /></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="action-btn primary" onClick={save}>Save</button>
          <button className="action-btn" onClick={test}>Test Notification</button>
        </div>
      </div>
      {integrations.map(i => (
        <div key={i.id} className="legal-article-card" style={{ marginBottom: 8 }}>
          <div className="legal-article-header">
            <span className="legal-article-title">{i.provider}</span>
            <span className="legal-clause-tag">{i.type}</span>
            <span className={`legal-severity ${i.active ? 'low' : 'high'}`}>{i.active ? 'Active' : 'Inactive'}</span>
            <button className="action-btn delete" style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px' }} onClick={() => remove(i.id)}>Remove</button>
          </div>
          {i.lastSyncAt && <div className="subtitle">Last sync: {new Date(i.lastSyncAt).toLocaleString()}</div>}
        </div>
      ))}
      {integrations.length === 0 && !loading && <p className="subtitle">No integrations configured.</p>}
    </div>
  );
}

// ─── Custom Frameworks Tab ───────────────────────────

function FrameworksTab() {
  const [frameworks, setFrameworks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { const r = await getCustomFrameworks(); setFrameworks(r.frameworks || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const create = async () => {
    if (!name) return;
    try {
      await createCustomFramework({
        name, description: desc,
        clauses: [
          { name: 'data_handling', description: 'Data handling procedures', weight: 1.0, required: true },
          { name: 'access_control', description: 'Access control requirements', weight: 1.0, required: true },
          { name: 'incident_response', description: 'Incident response procedures', weight: 1.0, required: true }
        ]
      });
      setName(''); setDesc(''); load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="legal-section">
      <div className="legal-draft-form" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Create Custom Framework</h3>
        <div className="legal-draft-row"><label>Name</label><input value={name} onChange={e => setName(e.target.value)} className="legal-select" placeholder="e.g. HIPAA, PCI-DSS" /></div>
        <div className="legal-draft-row"><label>Description</label><input value={desc} onChange={e => setDesc(e.target.value)} className="legal-select" placeholder="Optional description" /></div>
        <button className="action-btn primary" onClick={create}>Create</button>
      </div>
      {frameworks.map(f => (
        <div key={f.id} className="legal-reg-card" style={{ cursor: 'default', marginBottom: 12 }}>
          <div className="legal-reg-code">{f.name}</div>
          <div className="legal-reg-name">{f.description || 'Custom framework'}</div>
          <div className="legal-reg-meta">{(f.clauses || []).length} clauses • {f.isPublic ? 'Public' : 'Private'}</div>
        </div>
      ))}
      {frameworks.length === 0 && !loading && <p className="subtitle">No custom frameworks yet. Create one for industry-specific compliance (HIPAA, PCI-DSS, SOX).</p>}
    </div>
  );
}

// ─── Alerts Tab ──────────────────────────────────────

function AlertsTab() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { const r = await getRegulatoryAlerts(); setAlerts(r.alerts || []); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const generate = async () => {
    try { const r = await generateRegulatoryAlerts(); alert(`Generated ${r.generated} new alerts`); load(); } catch (e) { alert(e.message); }
  };

  const markRead = async (id) => {
    try { await markAlertRead(id); load(); } catch (e) { console.error(e); }
  };

  return (
    <div className="legal-section">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="action-btn primary" onClick={generate}>Check for New Alerts</button>
      </div>
      {alerts.map(a => (
        <div key={a.id} className="legal-enforcement-card" style={{ marginBottom: 8, opacity: a.read ? 0.6 : 1 }}>
          <div className="legal-enf-header">
            <span className={`legal-severity ${a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'high' : 'low'}`}>{a.type}</span>
            <span style={{ fontWeight: 600, flex: 1 }}>{a.title}</span>
            {!a.read && <button className="action-btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => markRead(a.id)}>Mark Read</button>}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{a.summary}</div>
          {a.affectedClauses && <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>{a.affectedClauses.split(',').map((c, i) => <span key={i} className="legal-clause-tag">{c.trim()}</span>)}</div>}
          <div className="subtitle" style={{ marginTop: 4 }}>{a.regulation} • {new Date(a.createdAt).toLocaleDateString()}</div>
        </div>
      ))}
      {alerts.length === 0 && !loading && <p className="subtitle">No regulatory alerts. Click "Check for New Alerts" to scan for enforcement actions and guidance updates.</p>}
    </div>
  );
}

// ─── SSO Tab ─────────────────────────────────────────

function SsoTab() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('okta');
  const [entityId, setEntityId] = useState('');
  const [ssoUrl, setSsoUrl] = useState('');
  const [certificate, setCertificate] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { const r = await getSsoConfig(); setConfig(r.sso); } catch (e) { console.error(e); }
    setLoading(false);
  };

  const save = async () => {
    if (!entityId || !ssoUrl || !certificate) { alert('All fields required'); return; }
    try { await saveSsoConfig({ provider, entityId, ssoUrl, certificate }); load(); } catch (e) { alert(e.message); }
  };

  return (
    <div className="legal-section">
      {config ? (
        <div className="legal-enforcement-card">
          <div className="legal-enf-header">
            <span style={{ fontWeight: 700, fontSize: 16 }}>SSO Configuration</span>
            <span className={`legal-severity ${config.active ? 'low' : 'high'}`}>{config.active ? 'Active' : 'Inactive'}</span>
          </div>
          <div style={{ fontSize: 14, marginTop: 8 }}>Provider: <strong>{config.provider}</strong></div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Entity ID: {config.entityId}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>SSO URL: {config.ssoUrl}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Certificate: {config.certificate}</div>
        </div>
      ) : (
        <div className="legal-draft-form">
          <h3 style={{ marginTop: 0 }}>Configure SSO/SAML</h3>
          <div className="legal-draft-row">
            <label>Provider</label>
            <select value={provider} onChange={e => setProvider(e.target.value)} className="legal-select">
              <option value="okta">Okta</option>
              <option value="azure_ad">Azure AD</option>
              <option value="google">Google Workspace</option>
              <option value="onelogin">OneLogin</option>
            </select>
          </div>
          <div className="legal-draft-row"><label>Entity ID</label><input value={entityId} onChange={e => setEntityId(e.target.value)} className="legal-select" placeholder="https://your-org.okta.com/..." /></div>
          <div className="legal-draft-row"><label>SSO URL</label><input value={ssoUrl} onChange={e => setSsoUrl(e.target.value)} className="legal-select" placeholder="https://your-org.okta.com/saml/..." /></div>
          <div className="legal-draft-row"><label>X.509 Certificate</label><textarea value={certificate} onChange={e => setCertificate(e.target.value)} className="legal-textarea" rows={4} placeholder="Paste your SAML certificate..." /></div>
          <button className="action-btn primary" onClick={save}>Save SSO Config</button>
        </div>
      )}
      {!config && !loading && <p className="subtitle" style={{ marginTop: 16 }}>Enterprise SSO/SAML allows your team to sign in with your company's identity provider. Requires an organization account.</p>}
    </div>
  );
}
