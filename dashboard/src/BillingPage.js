import React, { useState, useEffect, useCallback } from 'react';
import { getPlans, getBillingAccount, getBillingUsage, upgradePlan, getBillingEvents } from './api';

function UsageBar({ label, used, limit, color }) {
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const barColor = pct > 90 ? 'var(--accent-red)' : pct > 70 ? 'var(--accent-yellow)' : color || 'var(--accent-blue)';

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: 'var(--text-secondary)' }}>
          {used} / {unlimited ? '∞' : limit}
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--bg-primary)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: unlimited ? '0%' : `${pct}%`, height: '100%', background: barColor, borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export default function BillingPage({ onBack }) {
  const [plans, setPlans] = useState([]);
  const [billing, setBilling] = useState(null);
  const [usage, setUsage] = useState(null);
  const [events, setEvents] = useState([]);
  const [upgrading, setUpgrading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, b, u, e] = await Promise.all([
        getPlans(),
        getBillingAccount().catch(() => null),
        getBillingUsage().catch(() => null),
        getBillingEvents().catch(() => ({ events: [] }))
      ]);
      setPlans(p.plans);
      setBilling(b);
      setUsage(u);
      setEvents(e.events || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpgrade = async (plan) => {
    if (upgrading) return;
    const action = billing && billing.plan === 'enterprise' && plan !== 'enterprise' ? 'downgrade' : 'upgrade';
    if (!window.confirm(`${action === 'upgrade' ? 'Upgrade' : 'Change'} to ${plan}?`)) return;
    setUpgrading(true);
    try {
      await upgradePlan(plan);
      await load();
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setUpgrading(false);
    }
  };

  const currentPlan = billing?.plan || 'free';

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Billing & Plans</h1>
          <div className="subtitle">Manage your subscription and usage</div>
        </div>
        <button className="nav-btn" onClick={onBack}>&larr; Dashboard</button>
      </div>

      {/* Current Plan Card */}
      {billing && (
        <div className="card" style={{ marginBottom: 24, borderLeft: '3px solid var(--accent-blue)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ marginBottom: 4 }}>Current Plan: {billing.planDetails?.name || currentPlan}</h2>
              <div className="subtitle">
                {billing.planDetails?.priceDisplay || 'Free'} · Status: <span style={{
                  color: billing.status === 'active' ? 'var(--accent-green)' :
                         billing.status === 'past_due' ? 'var(--accent-red)' : 'var(--accent-yellow)'
                }}>{billing.status}</span>
              </div>
            </div>
            {billing.status === 'past_due' && (
              <span className="ref-tag" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)', fontSize: 13 }}>
                Payment Required
              </span>
            )}
          </div>
        </div>
      )}

      {/* Usage */}
      {usage && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2>Current Usage</h2>
          <div className="subtitle" style={{ marginBottom: 16 }}>
            Period: {new Date(usage.period.start).toLocaleDateString()} — {new Date(usage.period.end).toLocaleDateString()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 20 }}>
            <div>
              <UsageBar label="Audits" used={usage.audits.used} limit={usage.audits.limit} color="var(--accent-blue)" />
              <UsageBar label="Team Members" used={usage.users.used} limit={usage.users.limit} color="var(--accent-purple)" />
            </div>
            <div>
              <UsageBar label={`Storage (${usage.storage.usedMb.toFixed(1)} MB)`} used={usage.storage.usedMb} limit={usage.storage.limitMb} color="var(--accent-green)" />
              <UsageBar label="API Calls" used={usage.apiCalls.used} limit={usage.apiCalls.limit} color="var(--accent-yellow)" />
            </div>
          </div>
        </div>
      )}

      {/* Plans */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2>Available Plans</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 16 }}>
          {plans.map(p => {
            const isCurrent = p.id === currentPlan;
            return (
              <div key={p.id} className="remediation-card" style={{
                border: isCurrent ? '2px solid var(--accent-blue)' : '1px solid var(--border)',
                position: 'relative'
              }}>
                {isCurrent && (
                  <span style={{
                    position: 'absolute', top: -10, right: 16, background: 'var(--accent-blue)',
                    color: '#fff', fontSize: 11, padding: '2px 10px', borderRadius: 10, fontWeight: 700
                  }}>Current</span>
                )}
                <h3 style={{ marginBottom: 4 }}>{p.name}</h3>
                <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
                  {p.priceDisplay}
                </div>
                <div className="subtitle" style={{ marginBottom: 12 }}>{p.description}</div>
                <div style={{ fontSize: 13, marginBottom: 16 }}>
                  <div style={{ marginBottom: 4 }}>Audits/mo: <strong>{p.auditsPerMonth === -1 ? 'Unlimited' : p.auditsPerMonth}</strong></div>
                  <div style={{ marginBottom: 4 }}>Users: <strong>{p.maxUsers === -1 ? 'Unlimited' : p.maxUsers}</strong></div>
                  <div style={{ marginBottom: 4 }}>Storage: <strong>{p.storageMb === -1 ? 'Unlimited' : `${p.storageMb} MB`}</strong></div>
                  <div style={{ marginBottom: 4 }}>API calls/mo: <strong>{p.apiCallsPerMonth === -1 ? 'Unlimited' : p.apiCallsPerMonth}</strong></div>
                </div>
                <div style={{ fontSize: 12, marginBottom: 12 }}>
                  {p.features.slice(0, 6).map(f => (
                    <span key={f} className="ref-tag" style={{ marginRight: 4, marginBottom: 4, display: 'inline-block' }}>
                      {f.replace(/_/g, ' ')}
                    </span>
                  ))}
                  {p.features.length > 6 && (
                    <span className="ref-tag">+{p.features.length - 6} more</span>
                  )}
                </div>
                {!isCurrent && (
                  <button className="upload-btn" disabled={upgrading}
                    onClick={() => handleUpgrade(p.id)}
                    style={p.price > (billing?.planDetails?.price || 0)
                      ? { background: 'var(--accent-green)' }
                      : { background: 'var(--text-secondary)' }
                    }>
                    {p.price > (billing?.planDetails?.price || 0) ? 'Upgrade' : 'Switch'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Billing History */}
      <div className="card">
        <h2>Billing History</h2>
        {events.length === 0 ? (
          <p className="subtitle">No billing events yet.</p>
        ) : (
          <table className="scores-table">
            <thead>
              <tr><th>Date</th><th>Event</th><th>Detail</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td><span className="ref-tag" style={
                    e.type.includes('upgrade') ? { background: 'rgba(34,197,94,0.15)', color: 'var(--accent-green)' } :
                    e.type.includes('failed') ? { background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)' } :
                    e.type.includes('downgrade') ? { background: 'rgba(234,179,8,0.15)', color: 'var(--accent-yellow)' } :
                    {}
                  }>{e.type}</span></td>
                  <td>{e.detail || '—'}</td>
                  <td>{e.amount ? `$${(e.amount / 100).toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
