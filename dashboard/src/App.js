import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import { isLoggedIn, getMe, logout } from './api';
import AuthPage from './AuthPage';
import AuditPage from './AuditPage';
import AdminPage from './AdminPage';
import OrgPage from './OrgPage';
import ComparePage from './ComparePage';
import SettingsPage from './SettingsPage';
import AnalyticsPage from './AnalyticsPage';
import BillingPage from './BillingPage';
import ApiExplorerPage from './ApiExplorerPage';
import LandingPage from './LandingPage';
import OnboardingWizard from './OnboardingWizard';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [page, setPage] = useState('audits'); // landing | auth | audits | admin | org | compare | settings | analytics | billing | api-explorer

  useEffect(() => {
    if (isLoggedIn()) {
      getMe()
        .then(setUser)
        .catch(() => { logout(); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
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
    return <LandingPage onGetStarted={() => setPage('auth')} onSignIn={() => setPage('auth')} />;
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

  return (
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
    />
  );
}

export default App;
