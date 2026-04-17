import React from 'react';
import { Search, BarChart3, Map, AlertTriangle, Wrench, Bot } from 'lucide-react';

export default function LandingPage({ onGetStarted, onSignIn, isBeta }) {
  return (
    <div className="landing">
      {/* Beta Banner */}
      {isBeta && (
        <div className="beta-banner beta-banner__landing" role="status">
          <span className="beta-banner__icon" aria-hidden="true">🔒</span>
          PRIVATE BETA — This platform is currently in private beta testing. Public access coming soon.
        </div>
      )}

      {/* Nav */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-logo">
            Auleg
            {isBeta && <span className="beta-pill" aria-label="Beta release">BETA</span>}
          </div>
          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#pricing">Pricing</a>
            <button className="landing-btn-ghost" onClick={onSignIn}>Sign In</button>
            <button className="landing-btn-primary" onClick={onGetStarted}>Get Started</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-badge">AI-Powered Compliance</div>
        <h1>Audit your DPAs in<br /><span className="landing-gradient-text">seconds, not weeks</span></h1>
        <p className="landing-hero-sub">
          Auleg uses AI to analyze Data Processing Agreements against GDPR, CCPA, ISO 27701 and SOC 2 —
          detecting gaps, scoring risk, and generating remediation plans automatically.
        </p>
        <div className="landing-hero-actions">
          <button className="landing-btn-primary landing-btn-lg" onClick={onGetStarted}>
            Start Free Audit &rarr;
          </button>
          <button className="landing-btn-outline landing-btn-lg" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>
            See How It Works
          </button>
        </div>
        <div className="landing-hero-stats">
          <div><strong>10+</strong><span>GDPR Clauses</span></div>
          <div><strong>4</strong><span>Frameworks</span></div>
          <div><strong>&lt;30s</strong><span>Audit Time</span></div>
          <div><strong>100%</strong><span>Automated</span></div>
        </div>
      </section>

      {/* Features */}
      <section className="landing-section" id="features">
        <h2>Everything you need for DPA compliance</h2>
        <p className="landing-section-sub">From clause detection to remediation — one platform handles it all.</p>
        <div className="landing-features-grid">
          <div className="landing-feature-card">
            <Search className="landing-feature-icon" size={32} strokeWidth={1.75} aria-hidden="true" />
            <h3>Clause Detection</h3>
            <p>Automatically identifies data processing purpose, subprocessor controls, breach notification, and more using pattern matching and NLP.</p>
          </div>
          <div className="landing-feature-card">
            <BarChart3 className="landing-feature-icon" size={32} strokeWidth={1.75} aria-hidden="true" />
            <h3>Risk Scoring</h3>
            <p>Weighted risk scores across severity, likelihood, and regulatory exposure. Visual gauges and heatmaps show exactly where you stand.</p>
          </div>
          <div className="landing-feature-card">
            <Map className="landing-feature-icon" size={32} strokeWidth={1.75} aria-hidden="true" />
            <h3>Framework Mapping</h3>
            <p>Maps each clause to GDPR articles, CCPA sections, ISO 27701 controls, and SOC 2 criteria in a compliance matrix.</p>
          </div>
          <div className="landing-feature-card">
            <AlertTriangle className="landing-feature-icon" size={32} strokeWidth={1.75} aria-hidden="true" />
            <h3>Gap Analysis</h3>
            <p>Identifies missing required clauses and highlights high-risk areas that need immediate attention.</p>
          </div>
          <div className="landing-feature-card">
            <Wrench className="landing-feature-icon" size={32} strokeWidth={1.75} aria-hidden="true" />
            <h3>Remediation Plans</h3>
            <p>Generates suggested contract language with legal references for every gap and high-risk clause found.</p>
          </div>
          <div className="landing-feature-card">
            <Bot className="landing-feature-icon" size={32} strokeWidth={1.75} aria-hidden="true" />
            <h3>AI Insights</h3>
            <p>Executive summaries, clause analysis, natural language search, and risk explanations powered by AI.</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="landing-section landing-section-alt" id="how-it-works">
        <h2>How it works</h2>
        <p className="landing-section-sub">Three steps to a fully compliant DPA.</p>
        <div className="landing-steps">
          <div className="landing-step">
            <div className="landing-step-num">1</div>
            <h3>Upload your DPA</h3>
            <p>Drop your contract file (.txt, .pdf, .docx) — or paste the text directly.</p>
          </div>
          <div className="landing-step-arrow">→</div>
          <div className="landing-step">
            <div className="landing-step-num">2</div>
            <h3>AI analyzes it</h3>
            <p>Our engine detects clauses, maps regulations, scores risk, and finds gaps in seconds.</p>
          </div>
          <div className="landing-step-arrow">→</div>
          <div className="landing-step">
            <div className="landing-step-num">3</div>
            <h3>Get your report</h3>
            <p>Visual dashboard with risk gauges, clause scores, gap report, and remediation plan.</p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="landing-section" id="pricing">
        <h2>Simple, transparent pricing</h2>
        <p className="landing-section-sub">Start free. Upgrade when you need more.</p>
        <div className="landing-pricing-grid">
          <div className="landing-pricing-card">
            <h3>Free</h3>
            <div className="landing-price">$0<span>/month</span></div>
            <ul>
              <li>3 audits / month</li>
              <li>Basic risk scoring</li>
              <li>Gap analysis</li>
              <li>1 user</li>
            </ul>
            <button className="landing-btn-outline" onClick={onGetStarted}>Get Started</button>
          </div>
          <div className="landing-pricing-card">
            <h3>Starter</h3>
            <div className="landing-price">$29<span>/month</span></div>
            <ul>
              <li>25 audits / month</li>
              <li>Templates &amp; sharing</li>
              <li>Compliance reports</li>
              <li>500 MB storage</li>
              <li>5 team members</li>
            </ul>
            <button className="landing-btn-outline" onClick={onGetStarted}>Start Starter</button>
          </div>
          <div className="landing-pricing-card landing-pricing-featured">
            <div className="landing-pricing-badge">Most Popular</div>
            <h3>Pro</h3>
            <div className="landing-price">$99<span>/month</span></div>
            <ul>
              <li>100 audits / month</li>
              <li>Advanced dual AI analysis</li>
              <li>Batch uploads</li>
              <li>API access (5,000 calls)</li>
              <li>15 team members</li>
              <li>Webhooks &amp; integrations</li>
            </ul>
            <button className="landing-btn-primary" onClick={onGetStarted}>Start Pro Trial</button>
          </div>
          <div className="landing-pricing-card">
            <h3>Business</h3>
            <div className="landing-price">$249<span>/month</span></div>
            <ul>
              <li>500 audits / month</li>
              <li>Legal intelligence agents</li>
              <li>Custom scoring rules</li>
              <li>10 GB storage</li>
              <li>50 team members</li>
              <li>Admin panel</li>
            </ul>
            <button className="landing-btn-outline" onClick={onGetStarted}>Start Business</button>
          </div>
          <div className="landing-pricing-card">
            <h3>Enterprise</h3>
            <div className="landing-price">$999<span>/month</span></div>
            <ul>
              <li>Unlimited audits</li>
              <li>SSO &amp; RBAC</li>
              <li>Unlimited users &amp; storage</li>
              <li>Priority support &amp; SLA</li>
              <li>Dedicated account manager</li>
            </ul>
            <button className="landing-btn-outline" onClick={onSignIn}>Contact Sales</button>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="landing-cta">
        <h2>Ready to automate your DPA compliance?</h2>
        <p>Join teams who audit contracts in seconds instead of weeks.</p>
        <button className="landing-btn-primary landing-btn-lg" onClick={onGetStarted}>
          Get Started Free &rarr;
        </button>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-logo">Auleg</div>
          <div className="landing-footer-text">
            &copy; {new Date().getFullYear()} Auleg &mdash; www.auleg.com
          </div>
        </div>
      </footer>
    </div>
  );
}
