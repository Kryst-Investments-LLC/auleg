import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

function getScoreColor(score) {
  if (score <= 20) return '#22c55e';
  if (score <= 50) return '#eab308';
  if (score <= 75) return '#f97316';
  return '#ef4444';
}

function getGaugeColor(risk) {
  const colors = { Low: '#22c55e', Moderate: '#eab308', High: '#f97316', Critical: '#ef4444' };
  return colors[risk] || '#94a3b8';
}

function formatClauseName(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* --- Risk Gauge: SVG radial 270° arc with count-up animation --- */
export function RiskGauge({ score, riskLevel }) {
  const target = Math.max(0, Math.min(100, Number(score) || 0));
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    // Honour user motion preference — show final value instantly
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setDisplay(target);
      return undefined;
    }

    const start = performance.now();
    const duration = 800;
    const ease = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(target * ease(t)));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target]);

  // Geometry — 270° arc from -135° to +135°
  const size = 180;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const arcLength = 2 * Math.PI * radius * (270 / 360);
  const dashOffset = arcLength * (1 - display / 100);
  const color = getGaugeColor(riskLevel);

  return (
    <div className="gauge-container">
      <div
        className="gauge-svg-wrap"
        role="img"
        aria-label={`Risk score: ${target} out of 100, ${riskLevel} risk`}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          {/* Background track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--border-default)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${2 * Math.PI * radius}`}
            transform={`rotate(135 ${cx} ${cy})`}
          />
          {/* Progress arc */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${2 * Math.PI * radius}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(135 ${cx} ${cy})`}
            style={{ transition: 'stroke 200ms ease' }}
          />
        </svg>
        <div className="gauge-svg-center">
          <div className="gauge-score" style={{ color }}>{display}</div>
          <div className="gauge-label">out of 100</div>
        </div>
      </div>
      <span className={`risk-badge ${riskLevel}`}>{riskLevel} Risk</span>
    </div>
  );
}

/* --- Clause Scores Table with Bar Chart --- */
export function ClauseScoresTable({ clauseScores }) {
  const sorted = [...clauseScores].sort((a, b) => b.score - a.score);
  const chartData = sorted.map(c => ({
    name: formatClauseName(c.clause),
    score: c.score,
    severity: c.severity,
    likelihood: c.likelihood,
    exposure: c.regulatory_exposure
  }));

  return (
    <div>
      <div style={{ height: 220, marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 140, right: 20 }}>
            <XAxis type="number" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 12 }} />
            <YAxis type="category" dataKey="name" tick={{ fill: '#f1f5f9', fontSize: 12 }} width={130} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#f1f5f9' }}
              formatter={(value, name) => [value, 'Score']}
            />
            <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={14}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={getScoreColor(entry.score)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="scores-table">
        <thead>
          <tr>
            <th>Clause</th>
            <th>Severity</th>
            <th>Likelihood</th>
            <th>Reg. Exposure</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(c => (
            <tr key={c.clause}>
              <td className="clause-name">{formatClauseName(c.clause)}</td>
              <td>{c.severity}/5</td>
              <td>{c.likelihood}/5</td>
              <td>{c.regulatory_exposure}/5</td>
              <td>
                <span className="score-value" style={{ color: getScoreColor(c.score) }}>
                  {c.score}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --- Framework Heatmap --- */
export function FrameworkHeatmap({ complianceMatrix }) {
  const frameworkCount = {};
  Object.values(complianceMatrix).forEach(refs => {
    if (!refs) return;
    refs.forEach(ref => {
      const fw = ref.split(':')[0];
      frameworkCount[fw] = (frameworkCount[fw] || 0) + 1;
    });
  });

  const maxCount = Math.max(...Object.values(frameworkCount), 1);
  const colors = ['#1e3a5f', '#1e5a8f', '#2563eb', '#3b82f6', '#60a5fa'];

  return (
    <div className="heatmap-grid">
      {Object.entries(frameworkCount).map(([fw, count]) => {
        const intensity = Math.min(4, Math.floor((count / maxCount) * 4));
        return (
          <div key={fw} className="heatmap-cell" style={{ background: colors[intensity], color: '#f1f5f9' }}>
            <span className="framework-count">{count}</span>
            {fw}
          </div>
        );
      })}
    </div>
  );
}

/* --- Gap Report --- */
export function GapReport({ gaps }) {
  if (!gaps || gaps.length === 0) {
    return <div className="no-gaps">&#10003; All required clauses detected</div>;
  }
  return (
    <ul className="gap-list">
      {gaps.map(g => (
        <li key={g}>{formatClauseName(g)}</li>
      ))}
    </ul>
  );
}

/* --- Remediation Plan --- */
export function RemediationPlan({ plan }) {
  if (!plan || plan.length === 0) {
    return <div className="no-gaps">&#10003; No remediation needed</div>;
  }
  return (
    <div>
      {plan.map((item, i) => (
        <div key={i} className="remediation-card">
          <div className="rem-header">
            <h3>{item.title}</h3>
            <span
              className="rem-score"
              style={{
                background: `${getScoreColor(item.risk_score || 50)}22`,
                color: getScoreColor(item.risk_score || 50)
              }}
            >
              {item.risk_score ? `Score: ${item.risk_score}` : item.action}
            </span>
          </div>
          <div className="suggested">{item.suggested_language}</div>
          <div className="refs">
            {(item.references || []).map((ref, j) => (
              <span key={j} className="ref-tag">{ref}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
