import React, { useState } from 'react';
import { login, register } from './api';

export default function AuthPage({ onLogin, onBack, isBeta }) {
  const [isRegister, setIsRegister] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let user;
      if (isRegister) {
        user = await register(email, password, name);
      } else {
        user = await login(email, password);
      }
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = (e) => {
    e.preventDefault();
    if (!email) { setError('Enter your email address first'); return; }
    setError('');
    setSuccess('If an account exists for that email, a reset link has been sent.');
  };

  if (showForgot) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Auleg</h1>
          <p className="auth-subtitle">Reset your password</p>
          <form onSubmit={handleForgotPassword}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="auth-input"
            />
            {error && <div className="auth-error">{error}</div>}
            {success && <div className="auth-success">{success}</div>}
            <button type="submit" className="auth-button">Send Reset Link</button>
          </form>
          <div className="auth-toggle">
            <button onClick={() => { setShowForgot(false); setError(''); setSuccess(''); }}>
              &larr; Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {onBack && (
          <button className="auth-back" onClick={onBack}>&larr; Back</button>
        )}
        <h1>Auleg</h1>
        {isBeta && (
          <div style={{
            background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
            color: '#fff',
            textAlign: 'center',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 16
          }}>
            🔒 Private Beta — Authorized access only
          </div>
        )}
        <p className="auth-subtitle">
          {isRegister && !isBeta ? 'Create your account' : 'Sign in to your account'}
        </p>

        <form onSubmit={handleSubmit}>
          {isRegister && !isBeta && (
            <input
              type="text"
              placeholder="Full name"
              value={name}
              onChange={e => setName(e.target.value)}
              className="auth-input"
            />
          )}
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="auth-input"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            className="auth-input"
          />

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {!isRegister && (
          <div className="auth-forgot">
            <button onClick={() => { setShowForgot(true); setError(''); }}>Forgot password?</button>
          </div>
        )}

        {!isBeta && (
          <div className="auth-toggle">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}
            <button onClick={() => { setIsRegister(!isRegister); setError(''); }}>
              {isRegister ? 'Sign in' : 'Register'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
