import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import { isLoggedIn, getMe, logout, checkBetaStatus } from './api';
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

function BetaBanner() {
  return (
    <div style={{
      background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
      color: '#fff',
      textAlign: 'center',
      padding: '8px 16px',
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: '0.5px',
      position: 'sticky',
      top: 0,
      zIndex: 9999
    }}>
      🚀 BETA — You're using Auleg in beta mode. All features are free during the beta period.
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isBeta, setIsBeta] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [page, setPage] = useState('audits');

  useEffect(() => {
    const init = async () => {
      // Check beta mode
      try {
        const beta = await checkBetaStatus();
        setIsBeta(beta);

        if (beta && !isLoggedIn()) {
          // Beta mode: create a guest session
          setUser({
            id: 'beta-guest',
            email: 'beta@auleg.com',
            name: 'Beta User',
            role: 'member',
            isBetaGuest: true
          });
          setLoading(false);
          return;
        }
      } catch {}

      if (isLoggedIn()) {
        try {
          const me = await getMe();
          setUser(me);
        } catch {
          logout();
        }
      }
      setLoading(false);
    };
    init();
  }, []);

  const handleLogin = (user) => {
    setUser(user);
    const onboarded = localStorage.getItem('auleg_onboarded');
    if (!onboarded) {
      setShowOnboarding(true);
    }
    setPage('audits');
  };

  const handleLogout = () => {
    logout();
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

  if (!user) {
    if (page === 'auth') {
      return <AuthPage onLogin={handleLogin} onBack={() => setPage('landing')} />;
    }
    return <LandingPage onGetStarted={() => setPage('auth')} onSignIn={() => setPage('auth')} isBeta={isBeta} />;
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
      />
    </>
  );
}

export default App;
