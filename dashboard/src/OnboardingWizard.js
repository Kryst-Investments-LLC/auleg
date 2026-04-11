import React, { useState } from 'react';

const STEPS = [
  {
    title: 'Welcome to Auleg',
    description: 'Your AI-powered DPA compliance platform. Let\'s get you set up in 30 seconds.',
    icon: '👋'
  },
  {
    title: 'Upload a Contract',
    description: 'Upload a .txt, .pdf, or .docx Data Processing Agreement. Our AI will analyze it against GDPR, CCPA, ISO 27701, and SOC 2.',
    icon: '📄'
  },
  {
    title: 'Get Your Report',
    description: 'In seconds, you\'ll see clause detection, risk scores, gap analysis, and a remediation plan — all in one dashboard.',
    icon: '📊'
  },
  {
    title: 'You\'re all set!',
    description: 'Start auditing your first DPA now. You can always explore AI insights, batch uploads, and team features later.',
    icon: '🚀'
  }
];

export default function OnboardingWizard({ user, onComplete }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-progress">
          {STEPS.map((_, i) => (
            <div key={i} className={`onboarding-dot ${i <= step ? 'active' : ''}`} />
          ))}
        </div>

        <div className="onboarding-icon">{current.icon}</div>
        <h2>{current.title}</h2>
        {step === 0 && user?.name && (
          <p className="onboarding-greeting">Hi {user.name.split(' ')[0]}!</p>
        )}
        <p className="onboarding-desc">{current.description}</p>

        <div className="onboarding-actions">
          {step > 0 && (
            <button className="onboarding-btn-ghost" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {isLast ? (
            <button className="onboarding-btn-primary" onClick={onComplete}>
              Start Auditing &rarr;
            </button>
          ) : (
            <button className="onboarding-btn-primary" onClick={() => setStep(step + 1)}>
              Next
            </button>
          )}
        </div>

        <button className="onboarding-skip" onClick={onComplete}>
          Skip setup
        </button>
      </div>
    </div>
  );
}
