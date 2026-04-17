import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import { getMe, logout, checkBetaStatus, getTermsStatus, acceptTerms } from './api';
import AuthPage from './AuthPage';
import AuditPage from './AuditPage';
import AdminPage from './AdminPage';
import OrgPage from './OrgPage';
import ComparePage from './ComparePage';
import SettingsPage from './SettingsPage';
import AnalyticsPage from './AnalyticsPage';
import BillingPage from './BillingPage';
import ApiExplorerPage from './ApiExplorerPage';
import LegalAgentPage from './LegalAgentPage';
import AdvancedPage from './AdvancedPage';
import LandingPage from './LandingPage';
import OnboardingWizard from './OnboardingWizard';
import ResetPasswordPage from './ResetPasswordPage';

function BetaBanner() {
  return (
    <div className="beta-banner" role="status">
      <span className="beta-banner__icon" aria-hidden="true">🔒</span>
      PRIVATE BETA — Platform is in testing mode. Registration is closed.
    </div>
  );
}

/**
 * Theme management — reads/writes localStorage, applies data-theme on <html>.
 * Defaults to OS preference; user choice always wins.
 */
const THEME_STORAGE_KEY = 'auleg_theme';
function getInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  // Fall back to OS preference
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function ThemeToggle({ theme, onToggle }) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isBeta, setIsBeta] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [pendingTerms, setPendingTerms] = useState(null);
  const [page, setPage] = useState('audits');
  const [theme, setTheme] = useState(getInitialTheme);

  // Apply + persist theme whenever it changes
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  useEffect(() => {
    const init = async () => {
      // Check beta mode
      try {
        const beta = await checkBetaStatus();
        setIsBeta(beta);
      } catch {}

      try {
        const me = await getMe();
        setUser(me);
      } catch {}
      setLoading(false);
    };
    init();
  }, []);

  // Check terms acceptance after login
  useEffect(() => {
    if (!user) return;
    const checkTerms = async () => {
      try {
        const status = await getTermsStatus();
        if (!status.allAccepted && status.pending?.length > 0) {
          setPendingTerms(status.pending);
        } else {
          setPendingTerms(null);
        }
      } catch {
        // Terms endpoint may not be configured yet — skip
        setPendingTerms(null);
      }
    };
    checkTerms();
  }, [user]);

  const handleLogin = (user) => {
    setUser(user);
    const onboarded = localStorage.getItem('auleg_onboarded');
    if (!onboarded) {
      setShowOnboarding(true);
    }
    setPage('audits');
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setPage('audits');
  };

  if (loading) {
    return (
      <div className="dashboard" style={{ textAlign: 'center', paddingTop: 100 }}>
        <div className="subtitle">Loading...</div>
      </div>
    );
  }

  // Handle /reset-password?token=... URL from email
  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = window.location.pathname === '/reset-password' ? urlParams.get('token') : null;
  if (resetToken) {
    return (
      <ResetPasswordPage
        token={resetToken}
        onDone={() => { window.history.replaceState({}, '', '/'); window.location.reload(); }}
      />
    );
  }

  if (!user) {
    // Beta mode: show login page directly (no landing, no register)
    if (isBeta) {
      return <AuthPage onLogin={handleLogin} isBeta={true} />;
    }
    if (page === 'auth') {
      return <AuthPage onLogin={handleLogin} onBack={() => setPage('landing')} />;
    }
    return <LandingPage onGetStarted={() => setPage('auth')} onSignIn={() => setPage('auth')} isBeta={false} />;
  }

  if (showOnboarding) {
    return (
      <OnboardingWizard
        user={user}
        onComplete={() => {
          localStorage.setItem('auleg_onboarded', '1');
          setShowOnboarding(false);
        }}
      />
    );
  }

  if (pendingTerms && pendingTerms.length > 0) {
    return (
      <div className="dashboard" style={{ maxWidth: 600, margin: '80px auto', padding: 32 }}>
        <h2 style={{ marginBottom: 16 }}>Terms &amp; Conditions Update</h2>
        <p style={{ marginBottom: 24, color: '#666' }}>
          Please review and accept the following to continue using the platform:
        </p>
        {pendingTerms.map((term) => (
          <div key={term.id} style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{term.title}</h3>
            <p style={{ fontSize: 13, color: '#888', margin: '4px 0 8px' }}>Version {term.version} &middot; {term.type}</p>
            {term.content && (
              <div style={{ maxHeight: 200, overflow: 'auto', background: '#f9f9f9', padding: 12, borderRadius: 4, fontSize: 13, marginBottom: 12 }}>
                {term.content}
              </div>
            )}
            <button
              className="btn-primary"
              onClick={async () => {
                try {
                  await acceptTerms(term.id);
                  setPendingTerms((prev) => prev.filter((t) => t.id !== term.id));
                } catch (err) {
                  alert('Failed to accept terms: ' + (err.message || 'Unknown error'));
                }
              }}
            >
              I Accept
            </button>
          </div>
        ))}
      </div>
    );
  }

  if (page === 'admin' && user.role === 'admin') {
    return <AdminPage onBack={() => setPage('audits')} />;
  }
  if (page === 'org') {
    return <OrgPage user={user} onBack={() => setPage('audits')} />;
  }
  if (page === 'compare') {
    return <ComparePage onBack={() => setPage('audits')} />;
  }
  if (page === 'settings') {
    return <SettingsPage onBack={() => setPage('audits')} />;
  }
  if (page === 'analytics') {
    return <AnalyticsPage onBack={() => setPage('audits')} />;
  }
  if (page === 'billing') {
    return <BillingPage onBack={() => setPage('audits')} />;
  }
  if (page === 'api-explorer') {
    return <ApiExplorerPage onBack={() => setPage('audits')} />;
  }
  if (page === 'legal') {
    return <LegalAgentPage onBack={() => setPage('audits')} />;
  }
  if (page === 'advanced') {
    return <AdvancedPage onBack={() => setPage('audits')} />;
  }

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {isBeta && <BetaBanner />}
      <AuditPage
        user={user}
        onLogout={handleLogout}
        onAdmin={user.role === 'admin' ? () => setPage('admin') : null}
        onOrg={() => setPage('org')}
        onCompare={() => setPage('compare')}
        onSettings={() => setPage('settings')}
        onAnalytics={() => setPage('analytics')}
        onBilling={() => setPage('billing')}
        onApiExplorer={() => setPage('api-explorer')}
        onLegal={() => setPage('legal')}
        onAdvanced={() => setPage('advanced')}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    </>
  );
}

export default App;
