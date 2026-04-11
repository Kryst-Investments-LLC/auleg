import React, { useState, useEffect, useCallback } from 'react';
import {
  adminListUsers, adminChangeRole, adminDeleteUser,
  adminGetActivity, adminGetStats
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {['stats', 'users', 'activity'].map(t => (
          <button key={t} className={`nav-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)} style={tab === t ? { background: 'var(--accent-blue)', color: '#fff', borderColor: 'var(--accent-blue)' } : {}}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
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
    </div>
  );
}
