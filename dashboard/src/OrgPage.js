import React, { useState, useEffect, useCallback } from 'react';
import { createOrg, getMyOrg, inviteToOrg, removeFromOrg } from './api';

export default function OrgPage({ user, onBack }) {
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newOrgName, setNewOrgName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('auditor');
  const [msg, setMsg] = useState('');

  const loadOrg = useCallback(async () => {
    try {
      const data = await getMyOrg();
      setOrg(data.org);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadOrg(); }, [loadOrg]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    try {
      await createOrg(newOrgName.trim());
      setNewOrgName('');
      await loadOrg();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail) return;
    try {
      const res = await inviteToOrg(inviteEmail, inviteRole);
      setMsg(res.message);
      setInviteEmail('');
      await loadOrg();
    } catch (err) {
      setMsg(err.message);
    }
  };

  const handleRemove = async (userId) => {
    if (!window.confirm('Remove this member?')) return;
    try {
      await removeFromOrg(userId);
      await loadOrg();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  if (loading) return <div className="dashboard"><div className="subtitle">Loading...</div></div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>{org ? org.name : 'Organization'}</h1>
          <div className="subtitle">{org ? `${org.plan} plan · ${org.users?.length || 0} members` : 'Not part of an organization'}</div>
        </div>
        <button className="nav-btn" onClick={onBack}>&larr; Dashboard</button>
      </div>

      {!org && (
        <div className="card">
          <h2>Create Organization</h2>
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
            <input type="text" value={newOrgName} onChange={e => setNewOrgName(e.target.value)}
              placeholder="Organization name" className="auth-input" style={{ marginBottom: 0, maxWidth: 300 }} />
            <button type="submit" className="upload-btn">Create</button>
          </form>
        </div>
      )}

      {org && (
        <>
          {user.role === 'admin' && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2>Invite Member</h2>
              <form onSubmit={handleInvite} style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="Email address" className="auth-input" style={{ marginBottom: 0, maxWidth: 260 }} />
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="role-select">
                  <option value="auditor">Auditor</option>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="submit" className="upload-btn">Invite</button>
              </form>
              {msg && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--accent-green)' }}>{msg}</div>}
            </div>
          )}

          <div className="card">
            <h2>Members</h2>
            <table className="scores-table">
              <thead>
                <tr><th>Email</th><th>Name</th><th>Role</th><th>Joined</th>{user.role === 'admin' && <th>Actions</th>}</tr>
              </thead>
              <tbody>
                {(org.users || []).map(m => (
                  <tr key={m.id}>
                    <td>{m.email}</td>
                    <td>{m.name || '—'}</td>
                    <td><span className="ref-tag">{m.role}</span></td>
                    <td>{new Date(m.createdAt).toLocaleDateString()}</td>
                    {user.role === 'admin' && (
                      <td>
                        {m.id !== user.id && (
                          <button className="action-btn delete" onClick={() => handleRemove(m.id)}>Remove</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
