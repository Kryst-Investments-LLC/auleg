import React, { useState, useEffect, useCallback } from 'react';
import { getAnalyticsOverview, getAnalyticsTrend } from './api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';

const RISK_COLORS = { Low: '#22c55e', Moderate: '#eab308', High: '#f97316', Critical: '#ef4444' };

export default function AnalyticsPage({ onBack }) {
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState([]);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    try {
      const [ov, tr] = await Promise.all([getAnalyticsOverview(), getAnalyticsTrend(days)]);
      setOverview(ov);
      setTrend(tr.trend);
    } catch {}
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const pieData = overview ? Object.entries(overview.riskDistribution).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })) : [];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Analytics</h1>
          <div className="subtitle">Audit performance and risk insights</div>
        </div>
        <button className="nav-btn" onClick={onBack}>&larr; Dashboard</button>
      </div>

      {overview && (
        <>
          <div className="stat-grid" style={{ marginBottom: 24 }}>
            <StatCard label="Total Audits" value={overview.totalAudits} color="var(--accent-blue)" />
            <StatCard label="Completed" value={overview.completed} color="var(--accent-green)" />
            <StatCard label="Failed" value={overview.failed} color="var(--accent-red)" />
            <StatCard label="Processing" value={overview.processing} color="var(--accent-yellow)" />
            <StatCard label="Avg Risk Score" value={overview.averageRiskScore} color="var(--accent-orange)" />
            <StatCard label="Avg Clauses" value={overview.averageClauses} color="var(--accent-purple)" />
            <StatCard label="Avg Gaps" value={overview.averageGaps} color="var(--accent-red)" />
          </div>

          <div className="top-row" style={{ marginBottom: 24 }}>
            <div className="card">
              <h2>Risk Distribution</h2>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                      {pieData.map(e => <Cell key={e.name} fill={RISK_COLORS[e.name] || '#64748b'} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtitle">No completed audits yet.</p>
              )}
            </div>

            <div className="card">
              <h2>Averages</h2>
              <div style={{ display: 'flex', gap: 32, justifyContent: 'center', paddingTop: 24 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 48, fontWeight: 800, color: 'var(--accent-orange)' }}>{overview.averageRiskScore}</div>
                  <div className="subtitle">Risk Score</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 48, fontWeight: 800, color: 'var(--accent-blue)' }}>{overview.averageClauses}</div>
                  <div className="subtitle">Clauses</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 48, fontWeight: 800, color: 'var(--accent-red)' }}>{overview.averageGaps}</div>
                  <div className="subtitle">Gaps</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ marginBottom: 0 }}>Audit Volume ({days} days)</h2>
          <select className="role-select" value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        {trend.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }} />
              <Bar dataKey="completed" fill="#22c55e" name="Completed" />
              <Bar dataKey="failed" fill="#ef4444" name="Failed" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="subtitle">No audit data in this period.</p>
        )}
      </div>

      <div className="card">
        <h2>Risk Score Trend</h2>
        {trend.some(t => t.avgScore !== null) ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend.filter(t => t.avgScore !== null)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }} />
              <Line type="monotone" dataKey="avgScore" stroke="#f97316" strokeWidth={2} dot={{ fill: '#f97316', r: 3 }} name="Avg Risk Score" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="subtitle">No risk score data yet.</p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="stat-item">
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
