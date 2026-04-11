import React, { useState, useEffect, useRef } from 'react';
import {
  legalGetRegulations,
  legalGetRegulation,
  legalGetEnforcement,
  legalGetGuidance,
  legalGetTrends,
  legalChat,
  legalGetChats,
  legalGetChat,
  legalDraftClause,
  legalSeedDatabase,
} from './api';

const TABS = ['Chat', 'Regulations', 'Enforcement', 'Guidance', 'Trends', 'Draft Clause'];

export default function LegalAgentPage({ onBack }) {
  const [tab, setTab] = useState('Chat');
  const [seeded, setSeeded] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatId, setChatId] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const chatEndRef = useRef(null);

  // Regulation state
  const [regulations, setRegulations] = useState([]);
  const [selectedReg, setSelectedReg] = useState(null);
  const [regDetail, setRegDetail] = useState(null);
  const [regsLoading, setRegsLoading] = useState(false);

  // Enforcement state
  const [enforcement, setEnforcement] = useState([]);
  const [enfLoading, setEnfLoading] = useState(false);

  // Guidance state
  const [guidance, setGuidance] = useState([]);
  const [guidLoading, setGuidLoading] = useState(false);

  // Trends state
  const [trends, setTrends] = useState(null);
  const [trendsLoading, setTrendsLoading] = useState(false);

  // Draft state
  const [draftType, setDraftType] = useState('audit_rights');
  const [draftReg, setDraftReg] = useState('GDPR');
  const [draftLang, setDraftLang] = useState('');
  const [draftResult, setDraftResult] = useState(null);
  const [draftLoading, setDraftLoading] = useState(false);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await legalSeedDatabase();
      setSeeded(true);
    } catch (e) { console.error(e); }
    setSeeding(false);
  };

  // Load data when tab changes
  useEffect(() => {
    if (tab === 'Regulations' && regulations.length === 0) loadRegulations();
    if (tab === 'Enforcement' && enforcement.length === 0) loadEnforcement();
    if (tab === 'Guidance' && guidance.length === 0) loadGuidance();
    if (tab === 'Trends' && !trends) loadTrends();
    if (tab === 'Chat' && chatHistory.length === 0) loadChatHistory();
    // eslint-disable-next-line
  }, [tab]);

  const loadRegulations = async () => {
    setRegsLoading(true);
    try { const r = await legalGetRegulations(); setRegulations(r.regulations || []); } catch (e) { console.error(e); }
    setRegsLoading(false);
  };

  const loadRegDetail = async (code) => {
    setSelectedReg(code);
    try { const r = await legalGetRegulation(code); setRegDetail(r); } catch (e) { console.error(e); }
  };

  const loadEnforcement = async () => {
    setEnfLoading(true);
    try { const r = await legalGetEnforcement(); setEnforcement(r.actions || []); } catch (e) { console.error(e); }
    setEnfLoading(false);
  };

  const loadGuidance = async () => {
    setGuidLoading(true);
    try { const r = await legalGetGuidance(); setGuidance(r.guidance || []); } catch (e) { console.error(e); }
    setGuidLoading(false);
  };

  const loadTrends = async () => {
    setTrendsLoading(true);
    try { const r = await legalGetTrends(); setTrends(r); } catch (e) { console.error(e); }
    setTrendsLoading(false);
  };

  const loadChatHistory = async () => {
    try { const r = await legalGetChats(); setChatHistory(r.chats || []); } catch (e) { console.error(e); }
  };

  const loadChat = async (id) => {
    try {
      const r = await legalGetChat(id);
      setChatId(r.chat.id);
      setChatMessages((r.chat.messages || []).map(m => ({ role: m.role, content: m.content })));
    } catch (e) { console.error(e); }
  };

  const sendMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    setChatLoading(true);
    try {
      const r = await legalChat(msg, chatId, null);
      setChatId(r.chatId);
      setChatMessages(prev => [...prev, { role: 'assistant', content: r.answer, sources: r.sources }]);
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error: could not get response.' }]);
    }
    setChatLoading(false);
  };

  const newChat = () => {
    setChatMessages([]);
    setChatId(null);
    loadChatHistory();
  };

  const handleDraft = async () => {
    setDraftLoading(true);
    setDraftResult(null);
    try {
      const r = await legalDraftClause(draftType, draftReg, draftLang || undefined);
      setDraftResult(r);
    } catch (e) { console.error(e); }
    setDraftLoading(false);
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Legal Intelligence</h1>
          <p className="subtitle">AI-powered legal advisor, regulation browser, and enforcement monitor</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!seeded && (
            <button className="action-btn" onClick={handleSeed} disabled={seeding}>
              {seeding ? 'Seeding...' : 'Seed Legal Database'}
            </button>
          )}
          <button className="action-btn" onClick={onBack}>← Back</button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="legal-tabs">
        {TABS.map(t => (
          <button key={t} className={`legal-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* Chat Tab */}
      {tab === 'Chat' && (
        <div className="legal-chat-container">
          <div className="legal-chat-sidebar">
            <button className="action-btn" onClick={newChat} style={{ width: '100%', marginBottom: 12 }}>+ New Chat</button>
            <div className="legal-chat-history">
              {chatHistory.map(c => (
                <div key={c.id} className={`legal-chat-history-item ${chatId === c.id ? 'active' : ''}`} onClick={() => loadChat(c.id)}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'Untitled'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{new Date(c.createdAt).toLocaleDateString()}</div>
                </div>
              ))}
              {chatHistory.length === 0 && <div className="subtitle" style={{ fontSize: 12, padding: 8 }}>No conversations yet</div>}
            </div>
          </div>
          <div className="legal-chat-main">
            <div className="legal-chat-messages">
              {chatMessages.length === 0 && (
                <div className="legal-chat-empty">
                  <h3>Legal Expert Agent</h3>
                  <p>Ask about GDPR, CCPA, data processing clauses, enforcement actions, or get clause drafting help.</p>
                  <div className="legal-chat-suggestions">
                    {['What are the GDPR requirements for data breach notification?',
                      'How do I draft a cross-border transfer clause?',
                      'What recent enforcement actions relate to audit rights?',
                      'Compare GDPR and CCPA consent requirements'].map(s => (
                      <button key={s} className="legal-chat-suggestion" onClick={() => { setChatInput(s); }}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`legal-chat-msg ${m.role}`}>
                  <div className="legal-chat-msg-role">{m.role === 'user' ? 'You' : 'Legal Expert'}</div>
                  <div className="legal-chat-msg-content">{m.content}</div>
                  {m.sources && m.sources.length > 0 && (
                    <div className="legal-chat-sources">
                      <span style={{ fontSize: 11, fontWeight: 600 }}>Sources:</span>
                      {m.sources.map((s, j) => (
                        <span key={j} className="legal-source-tag">{s.regulation || s.type} {s.article || ''}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {chatLoading && (
                <div className="legal-chat-msg assistant">
                  <div className="legal-chat-msg-role">Legal Expert</div>
                  <div className="legal-chat-msg-content typing">Thinking...</div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="legal-chat-input-row">
              <input
                className="legal-chat-input"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                placeholder="Ask the legal expert..."
                disabled={chatLoading}
              />
              <button className="action-btn primary" onClick={sendMessage} disabled={chatLoading || !chatInput.trim()}>Send</button>
            </div>
          </div>
        </div>
      )}

      {/* Regulations Tab */}
      {tab === 'Regulations' && (
        <div className="legal-section">
          {regsLoading ? <div className="subtitle">Loading regulations...</div> : (
            <div className="legal-reg-grid">
              {regulations.map(r => (
                <div key={r.code} className={`legal-reg-card ${selectedReg === r.code ? 'selected' : ''}`} onClick={() => loadRegDetail(r.code)}>
                  <div className="legal-reg-code">{r.code}</div>
                  <div className="legal-reg-name">{r.name}</div>
                  <div className="legal-reg-meta">{r.jurisdiction} • {r._count?.articles || 0} articles</div>
                </div>
              ))}
              {regulations.length === 0 && <div className="subtitle">No regulations found. Click "Seed Legal Database" to populate.</div>}
            </div>
          )}
          {regDetail && (
            <div className="legal-reg-detail">
              <h3>{regDetail.regulation?.name || selectedReg}</h3>
              <p className="subtitle">{regDetail.regulation?.jurisdiction} — Effective: {regDetail.regulation?.effectiveDate ? new Date(regDetail.regulation.effectiveDate).toLocaleDateString() : 'N/A'}</p>
              <div className="legal-articles-list">
                {(regDetail.regulation?.articles || []).map(a => (
                  <div key={a.id} className="legal-article-card">
                    <div className="legal-article-header">
                      <span className="legal-article-num">Art. {a.articleNum}</span>
                      <span className="legal-article-title">{a.title}</span>
                      {a.relevance && <span className="legal-relevance-tag">{a.relevance}</span>}
                    </div>
                    <div className="legal-article-summary">{a.summary}</div>
                    {a.relatedClauses && (
                      <div className="legal-related-clauses">
                        {a.relatedClauses.split(',').map((c, i) => <span key={i} className="legal-clause-tag">{c.trim()}</span>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Enforcement Tab */}
      {tab === 'Enforcement' && (
        <div className="legal-section">
          {enfLoading ? <div className="subtitle">Loading enforcement actions...</div> : (
            <div className="legal-enforcement-list">
              {enforcement.map(a => (
                <div key={a.id} className="legal-enforcement-card">
                  <div className="legal-enf-header">
                    <span className={`legal-severity ${a.severity}`}>{a.severity?.toUpperCase()}</span>
                    <span className="legal-enf-authority">{a.authority}</span>
                    <span className="legal-enf-date">{new Date(a.date).toLocaleDateString()}</span>
                  </div>
                  <div className="legal-enf-entity">{a.entity} ({a.country})</div>
                  {a.fineAmount > 0 && (
                    <div className="legal-enf-fine">€{a.fineAmount.toLocaleString()}</div>
                  )}
                  <div className="legal-enf-desc">{a.description}</div>
                  {a.clauseImpact && (
                    <div className="legal-enf-clauses">
                      Impact: {a.clauseImpact.split(',').map((c, i) => <span key={i} className="legal-clause-tag">{c.trim()}</span>)}
                    </div>
                  )}
                </div>
              ))}
              {enforcement.length === 0 && <div className="subtitle">No enforcement actions found. Seed the database first.</div>}
            </div>
          )}
        </div>
      )}

      {/* Guidance Tab */}
      {tab === 'Guidance' && (
        <div className="legal-section">
          {guidLoading ? <div className="subtitle">Loading guidance documents...</div> : (
            <div className="legal-guidance-list">
              {guidance.map(g => (
                <div key={g.id} className="legal-guidance-card">
                  <div className="legal-guid-header">
                    <span className="legal-guid-authority">{g.authority}</span>
                    <span className="legal-guid-date">{new Date(g.publishedDate).toLocaleDateString()}</span>
                  </div>
                  <div className="legal-guid-title">{g.title}</div>
                  <div className="legal-guid-summary">{g.summary}</div>
                  {g.implications && <div className="legal-guid-implications"><strong>Implications:</strong> {g.implications}</div>}
                  {g.clauseImpact && (
                    <div className="legal-guid-clauses">
                      {g.clauseImpact.split(',').map((c, i) => <span key={i} className="legal-clause-tag">{c.trim()}</span>)}
                    </div>
                  )}
                </div>
              ))}
              {guidance.length === 0 && <div className="subtitle">No guidance found. Seed the database first.</div>}
            </div>
          )}
        </div>
      )}

      {/* Trends Tab */}
      {tab === 'Trends' && (
        <div className="legal-section">
          {trendsLoading ? <div className="subtitle">Loading trends...</div> : trends ? (
            <div>
              <div className="legal-trends-summary">
                <div className="legal-trend-stat">
                  <div className="legal-trend-number">{trends.summary?.totalEnforcement || 0}</div>
                  <div className="legal-trend-label">Enforcement Actions</div>
                </div>
                <div className="legal-trend-stat">
                  <div className="legal-trend-number">€{((trends.summary?.totalFines || 0) / 1e6).toFixed(1)}M</div>
                  <div className="legal-trend-label">Total Fines</div>
                </div>
                <div className="legal-trend-stat">
                  <div className="legal-trend-number">{trends.summary?.totalGuidance || 0}</div>
                  <div className="legal-trend-label">Guidance Docs</div>
                </div>
              </div>

              {trends.hotAreas && trends.hotAreas.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <h3>Hot Areas</h3>
                  <div className="legal-hot-areas">
                    {trends.hotAreas.map((h, i) => (
                      <div key={i} className="legal-hot-area-card">
                        <div className="legal-hot-clause">{h.clause}</div>
                        <div className="legal-hot-detail">{h.enforcementCount} enforcement actions • {h.guidanceCount} guidance docs</div>
                        <div className="legal-hot-risk">Risk multiplier: {h.riskMultiplier}x</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {trends.recommendations && trends.recommendations.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <h3>Recommendations</h3>
                  <ul className="legal-recommendations">
                    {trends.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : <div className="subtitle">No trend data. Seed the database first.</div>}
        </div>
      )}

      {/* Draft Clause Tab */}
      {tab === 'Draft Clause' && (
        <div className="legal-section">
          <div className="legal-draft-form">
            <div className="legal-draft-row">
              <label>Clause Type</label>
              <select value={draftType} onChange={e => setDraftType(e.target.value)} className="legal-select">
                <option value="audit_rights">Audit Rights</option>
                <option value="breach_notification">Breach Notification</option>
                <option value="cross_border_transfer">Cross-Border Transfer</option>
                <option value="subprocessor_controls">Subprocessor Controls</option>
                <option value="security_measures">Security Measures</option>
              </select>
            </div>
            <div className="legal-draft-row">
              <label>Regulation</label>
              <select value={draftReg} onChange={e => setDraftReg(e.target.value)} className="legal-select">
                <option value="GDPR">GDPR</option>
                <option value="UK-GDPR">UK GDPR</option>
                <option value="CCPA">CCPA / CPRA</option>
                <option value="LGPD">LGPD (Brazil)</option>
                <option value="POPIA">POPIA (South Africa)</option>
                <option value="DPDPA">DPDPA (India)</option>
                <option value="PIPEDA">PIPEDA (Canada)</option>
              </select>
            </div>
            <div className="legal-draft-row">
              <label>Current Language (optional)</label>
              <textarea value={draftLang} onChange={e => setDraftLang(e.target.value)} rows={3} placeholder="Paste existing clause language to improve..." className="legal-textarea" />
            </div>
            <button className="action-btn primary" onClick={handleDraft} disabled={draftLoading}>
              {draftLoading ? 'Drafting...' : 'Generate Clause'}
            </button>
          </div>
          {draftResult && (
            <div className="legal-draft-result">
              <h3>Drafted Clause</h3>
              <pre className="legal-draft-text">{draftResult.clause}</pre>
              {draftResult.explanation && (
                <div style={{ marginTop: 16 }}>
                  <h4>Explanation</h4>
                  <p>{draftResult.explanation}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
