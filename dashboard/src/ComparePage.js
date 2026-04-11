import React, { useState, useEffect } from 'react';
import { listAudits, compareAudits } from './api';
import { RiskGauge } from './components';

function formatClause(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getScoreColor(score) {
  if (score <= 20) return '#22c55e';
  if (score <= 50) return '#eab308';
  if (score <= 75) return '#f97316';
  return '#ef4444';
}

export default function ComparePage({ onBack }) {
  const [audits, setAudits] = useState([]);
  const [idA, setIdA] = useState('');
  const [idB, setIdB] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listAudits(1, 100).then(d => setAudits(d.audits.filter(a => a.status === 'complete'))).catch(() => {});
  }, []);

  const handleCompare = async () => {
    if (!idA || !idB) return setError('Select two audits');
    if (idA === idB) return setError('Select two different audits');
    setError('');
    setLoading(true);
    try {
      const data = await compareAudits(idA, idB);
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const s = result?.summary;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Audit Comparison</h1>
          <div className="subtitle">Compare two audit reports side by side</div>
        </div>
        <button className="nav-btn" onClick={onBack}>&larr; Dashboard</button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2>Select Audits</h2>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <select value={idA} onChange={e => setIdA(e.target.value)} className="compare-select">
            <option value="">Audit A</option>
            {audits.map(a => <option key={a.id} value={a.id}>{a.contractName} ({new Date(a.createdAt).toLocaleDateString()})</option>)}
          </select>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>vs</span>
          <select value={idB} onChange={e => setIdB(e.target.value)} className="compare-select">
            <option value="">Audit B</option>
            {audits.map(a => <option key={a.id} value={a.id}>{a.contractName} ({new Date(a.createdAt).toLocaleDateString()})</option>)}
          </select>
          <button className="upload-btn" onClick={handleCompare} disabled={loading}>
            {loading ? 'Comparing...' : 'Compare'}
          </button>
        </div>
        {error && <div className="auth-error" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {result && s && (
        <>
          <div className="top-row">
            <div className="card">
              <h2>Audit A: {s.a.name}</h2>
              <RiskGauge score={s.a.score || 0} riskLevel={s.a.risk || 'Low'} />
              <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                {s.a.clauses} clauses · {s.a.gaps} gaps
              </div>
            </div>
            <div className="card">
              <h2>Audit B: {s.b.name}</h2>
              <RiskGauge score={s.b.score || 0} riskLevel={s.b.risk || 'Low'} />
              <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                {s.b.clauses} clauses · {s.b.gaps} gaps
              </div>
              <div style={{ marginTop: 8, textAlign: 'center' }}>
                <span style={{
                  fontSize: 14, fontWeight: 700,
                  color: s.scoreDelta < 0 ? '#22c55e' : s.scoreDelta > 0 ? '#ef4444' : '#94a3b8'
                }}>
                  {s.scoreDelta > 0 ? '+' : ''}{s.scoreDelta} risk delta
                </span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            <h2>Clause Comparison</h2>
            <table className="scores-table">
              <thead>
                <tr><th>Clause</th><th>In A</th><th>In B</th><th>Score A</th><th>Score B</th><th>Delta</th></tr>
              </thead>
              <tbody>
                {result.clauseComparison.map(c => (
                  <tr key={c.clause}>
                    <td className="clause-name">{formatClause(c.clause)}</td>
                    <td>{c.inA ? '✓' : '✗'}</td>
                    <td>{c.inB ? '✓' : '✗'}</td>
                    <td>{c.scoreA != null ? <span style={{ color: getScoreColor(c.scoreA) }}>{c.scoreA}</span> : '—'}</td>
                    <td>{c.scoreB != null ? <span style={{ color: getScoreColor(c.scoreB) }}>{c.scoreB}</span> : '—'}</td>
                    <td>
                      {c.delta != null ? (
                        <span style={{ color: c.delta < 0 ? '#22c55e' : c.delta > 0 ? '#ef4444' : '#94a3b8', fontWeight: 700 }}>
                          {c.delta > 0 ? '+' : ''}{c.delta}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bottom-grid" style={{ marginTop: 24 }}>
            <div className="card">
              <h2>Gap Changes</h2>
              {result.gapChanges.fixed.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700, marginBottom: 4 }}>FIXED</div>
                  {result.gapChanges.fixed.map(g => <div key={g} className="gap-fixed">{formatClause(g)}</div>)}
                </div>
              )}
              {result.gapChanges.new.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>NEW GAPS</div>
                  {result.gapChanges.new.map(g => <div key={g} className="gap-new">{formatClause(g)}</div>)}
                </div>
              )}
              {result.gapChanges.remaining.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: '#eab308', fontWeight: 700, marginBottom: 4 }}>REMAINING</div>
                  {result.gapChanges.remaining.map(g => <div key={g} className="gap-remaining">{formatClause(g)}</div>)}
                </div>
              )}
              {result.gapChanges.fixed.length === 0 && result.gapChanges.new.length === 0 && result.gapChanges.remaining.length === 0 && (
                <div className="no-gaps">&#10003; No gaps in either audit</div>
              )}
            </div>
            <div className="card">
              <h2>Summary</h2>
              <div style={{ fontSize: 14, lineHeight: 2, color: 'var(--text-secondary)' }}>
                <div>Audit A: <strong>{s.a.clauses}</strong> clauses, <strong>{s.a.gaps}</strong> gaps, <span className={`risk-badge ${s.a.risk}`}>{s.a.risk}</span></div>
                <div>Audit B: <strong>{s.b.clauses}</strong> clauses, <strong>{s.b.gaps}</strong> gaps, <span className={`risk-badge ${s.b.risk}`}>{s.b.risk}</span></div>
                <div style={{ marginTop: 8 }}>
                  Risk delta: <strong style={{ color: s.scoreDelta < 0 ? '#22c55e' : s.scoreDelta > 0 ? '#ef4444' : '#94a3b8' }}>
                    {s.scoreDelta > 0 ? '+' : ''}{s.scoreDelta} points
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
