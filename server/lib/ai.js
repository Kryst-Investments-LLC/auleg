/**
 * AI Analysis Engine
 * 
 * Supports two modes controlled by AI_PROVIDER env var:
 *   - "openai"    → Uses OpenAI GPT-4 for analysis (requires OPENAI_API_KEY)
 *   - "anthropic" → Uses Anthropic Claude for analysis (requires ANTHROPIC_API_KEY)
 *   - unset/other → Falls back to built-in pattern-based analysis
 * 
 * Supports: executive summary, clause deep-dive, remediation suggestions,
 *           natural language search, and risk explanation.
 */

const AI_PROVIDER = (process.env.AI_PROVIDER || '').toLowerCase();
let llmClient = null;

if (AI_PROVIDER === 'openai' && process.env.OPENAI_API_KEY) {
  try {
    const OpenAI = require('openai');
    llmClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('AI Provider: OpenAI GPT-4');
  } catch (e) {
    console.warn('OpenAI package not installed, falling back to pattern-based AI');
  }
} else if (AI_PROVIDER === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    llmClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    console.log('AI Provider: Anthropic Claude');
  } catch (e) {
    console.warn('Anthropic package not installed, falling back to pattern-based AI');
  }
}

/**
 * Send a prompt to the configured LLM provider.
 * Returns the text response or null if no provider is configured.
 */
async function llmComplete(systemPrompt, userPrompt) {
  if (!llmClient) return null;

  try {
    if (AI_PROVIDER === 'openai') {
      const resp = await llmClient.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 2000,
        temperature: 0.3
      });
      return resp.choices[0]?.message?.content || null;
    }
    if (AI_PROVIDER === 'anthropic') {
      const resp = await llmClient.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });
      return resp.content[0]?.text || null;
    }
  } catch (err) {
    console.error(`LLM (${AI_PROVIDER}) error:`, err.message);
    return null;
  }

  return null;
}

// Extract clause scores as {clauseName: score} from report (handles both formats)
function extractClauseScores(report) {
  if (report.clause_scores && typeof report.clause_scores === 'object' && !Array.isArray(report.clause_scores) && Object.keys(report.clause_scores).length > 0) {
    return report.clause_scores;
  }
  const arr = (report.risk_profile && report.risk_profile.clause_scores) || [];
  const map = {};
  arr.forEach(c => { if (c.clause) map[c.clause] = c.score != null ? c.score : 0; });
  return map;
}

const CLAUSE_KNOWLEDGE = {
  audit_rights: {
    description: 'Right to audit data processing activities',
    gdprArticle: 'Article 28(3)(h)',
    riskWhenMissing: 'Without audit rights, the controller cannot verify processor compliance, creating significant regulatory risk.',
    bestPractice: 'Include annual audit rights with reasonable notice period (30 days), right to appoint third-party auditors, and processor obligation to cooperate.',
    remediation: 'Add clause granting controller the right to conduct or commission audits of processor\'s data processing activities, with at least annual frequency and 30-day notice requirement.'
  },
  breach_notification: {
    description: 'Obligation to notify of data breaches',
    gdprArticle: 'Article 33',
    riskWhenMissing: 'Non-compliance with breach notification can result in fines up to €10M or 2% of global turnover.',
    bestPractice: 'Require notification within 72 hours of becoming aware of a breach, with detailed incident information including affected data subjects.',
    remediation: 'Add breach notification clause requiring processor to notify controller without undue delay (within 72 hours maximum) of any personal data breach, including nature of breach, categories of data subjects affected, and recommended mitigation measures.'
  },
  data_subject_rights: {
    description: 'Support for data subject access requests',
    gdprArticle: 'Articles 15-22',
    riskWhenMissing: 'Inability to fulfill DSAR within 30 days exposes controller to complaints and regulatory action.',
    bestPractice: 'Processor must assist controller in responding to data subject requests within 5 business days, at no additional cost.',
    remediation: 'Add clause requiring processor to assist controller in responding to data subject rights requests (access, rectification, erasure, portability, restriction, objection) within 5 business days of notification.'
  },
  subprocessor_controls: {
    description: 'Governance over sub-processors',
    gdprArticle: 'Article 28(2)(4)',
    riskWhenMissing: 'Uncontrolled sub-processing creates data flow blind spots and potential unauthorized access.',
    bestPractice: 'Require prior written consent for sub-processors, maintain an up-to-date list, and flow-down equivalent obligations.',
    remediation: 'Add sub-processor clause requiring prior written authorization, maintained sub-processor register, equivalent contractual obligations flow-down, and right to object to new sub-processors within 14 days.'
  },
  security_measures: {
    description: 'Technical and organizational security controls',
    gdprArticle: 'Article 32',
    riskWhenMissing: 'Inadequate security measures can lead to breaches and significant regulatory penalties.',
    bestPractice: 'Specify encryption standards (AES-256 at rest, TLS 1.3 in transit), access controls, regular penetration testing, and SOC 2 certification.',
    remediation: 'Add comprehensive security clause specifying encryption (AES-256 at rest, TLS 1.3 in transit), role-based access control, annual penetration testing, vulnerability management, and incident response procedures.'
  },
  data_processing_purpose: {
    description: 'Defined scope and purpose of processing',
    gdprArticle: 'Article 28(3)',
    riskWhenMissing: 'Undefined processing purpose allows scope creep and potential purpose limitation violations.',
    bestPractice: 'Clearly define processing purposes, categories of data, data subjects, and duration with explicit prohibition on processing beyond scope.',
    remediation: 'Add detailed processing description clause specifying purpose of processing, categories of personal data, categories of data subjects, duration of processing, and explicit prohibition on processing beyond defined scope.'
  },
  data_retention: {
    description: 'Data retention and deletion policies',
    gdprArticle: 'Article 17, Article 28(3)(g)',
    riskWhenMissing: 'Indefinite retention violates storage limitation principle and increases breach impact surface.',
    bestPractice: 'Define specific retention periods aligned with processing purpose, with automatic deletion or return upon termination.',
    remediation: 'Add retention clause specifying maximum retention periods per data category, obligation to delete or return data upon contract termination within 30 days, and annual retention audit requirement.'
  },
  cross_border_transfer: {
    description: 'International data transfer safeguards',
    gdprArticle: 'Articles 44-49',
    riskWhenMissing: 'Unlawful international transfers can result in transfer suspensions and fines up to €20M.',
    bestPractice: 'Use Standard Contractual Clauses (SCCs), require transfer impact assessments, and specify approved jurisdictions.',
    remediation: 'Add cross-border transfer clause incorporating Standard Contractual Clauses (SCCs), requiring transfer impact assessments for each destination country, and listing approved jurisdictions with adequacy decisions.'
  },
  liability: {
    description: 'Liability and indemnification provisions',
    gdprArticle: 'Article 82',
    riskWhenMissing: 'Uncapped liability exposure for data protection violations.',
    bestPractice: 'Specify liability caps, indemnification obligations, and insurance requirements for data protection breaches.',
    remediation: 'Add liability clause with mutual indemnification for data protection violations, minimum cyber insurance coverage requirements, and clear allocation of responsibility between controller and processor.'
  },
  termination: {
    description: 'Contract termination and data handling',
    gdprArticle: 'Article 28(3)(g)',
    riskWhenMissing: 'No termination provisions leaves data in limbo and prevents orderly wind-down.',
    bestPractice: 'Include termination-for-cause rights, data return/deletion obligations, and transition assistance period.',
    remediation: 'Add termination clause with right to terminate for material breach (with 30-day cure period), data return or certified deletion within 30 days of termination, and 90-day transition assistance at reasonable rates.'
  }
};

/**
 * Generate executive summary from audit report data.
 * Uses LLM when configured, falls back to pattern-based generation.
 */
async function generateExecutiveSummary(audit, report) {
  // Try LLM-based summary first
  if (llmClient) {
    const clauseScores = extractClauseScores(report);
    const gaps = report.gap_report || [];
    const riskProfile = report.risk_profile || {};
    const systemPrompt = 'You are a GDPR/data protection compliance expert. Generate a professional executive summary for a DPA audit. Use markdown formatting with ## headers. Include: Key Findings, Risk Assessment, Priority Actions, and Regulatory References.';
    const userPrompt = `Contract: ${audit.contractName}\nAudit Date: ${new Date(audit.createdAt).toLocaleDateString()}\nOverall Risk: ${riskProfile.overall_risk || audit.overallRisk || 'Unknown'} (Score: ${riskProfile.score || audit.riskScore || 0}/100)\nClause Scores: ${JSON.stringify(clauseScores)}\nGaps Found: ${JSON.stringify(gaps.slice(0, 10))}\nTotal clauses analyzed: ${Object.keys(clauseScores).length}`;
    const llmResult = await llmComplete(systemPrompt, userPrompt);
    if (llmResult) return llmResult;
  }

  // Fallback: pattern-based summary
  return generateExecutiveSummaryPattern(audit, report);
}

function generateExecutiveSummaryPattern(audit, report) {
  const clauseScores = extractClauseScores(report);
  const gaps = report.gap_report || [];
  const riskProfile = report.risk_profile || {};

  const totalClauses = Object.keys(clauseScores).length;
  const strongClauses = Object.entries(clauseScores).filter(([, s]) => s >= 80).map(([c]) => c);
  const weakClauses = Object.entries(clauseScores).filter(([, s]) => s > 0 && s < 50).map(([c]) => c);
  const missingClauses = Object.entries(clauseScores).filter(([, s]) => s === 0).map(([c]) => c);

  const riskLevel = riskProfile.overall_risk || audit.overallRisk || 'Unknown';
  const score = riskProfile.score || audit.riskScore || 0;

  let summary = `## Executive Summary\n\n`;
  summary += `**Contract:** ${audit.contractName}\n`;
  summary += `**Audit Date:** ${new Date(audit.createdAt).toLocaleDateString()}\n`;
  summary += `**Overall Risk Level:** ${riskLevel} (Score: ${score}/100)\n\n`;

  summary += `### Key Findings\n\n`;
  summary += `This DPA audit analyzed ${totalClauses} clause categories across the contract. `;

  if (missingClauses.length > 0) {
    summary += `**${missingClauses.length} critical clause(s) are entirely missing**, requiring immediate attention: ${missingClauses.map(c => c.replace(/_/g, ' ')).join(', ')}. `;
  }
  if (weakClauses.length > 0) {
    summary += `**${weakClauses.length} clause(s) have weak coverage** and need strengthening: ${weakClauses.map(c => c.replace(/_/g, ' ')).join(', ')}. `;
  }
  if (strongClauses.length > 0) {
    summary += `${strongClauses.length} clause(s) demonstrate adequate coverage. `;
  }

  summary += `\n\n### Risk Assessment\n\n`;
  if (riskLevel === 'Critical' || riskLevel === 'High') {
    summary += `This contract presents **${riskLevel.toLowerCase()} risk** for data protection compliance. Immediate remediation is recommended before proceeding with data processing activities. `;
    summary += `The most critical gaps involve ${[...missingClauses, ...weakClauses].slice(0, 3).map(c => c.replace(/_/g, ' ')).join(', ')}.\n\n`;
  } else if (riskLevel === 'Moderate') {
    summary += `This contract presents **moderate risk**. While foundational protections exist, several areas need improvement to achieve full regulatory compliance. `;
    summary += `Focus remediation efforts on ${weakClauses.slice(0, 3).map(c => c.replace(/_/g, ' ')).join(', ')}.\n\n`;
  } else {
    summary += `This contract presents **low risk** with generally adequate data protection provisions. Minor improvements may further strengthen compliance posture.\n\n`;
  }

  if (gaps.length > 0) {
    summary += `### Priority Actions\n\n`;
    gaps.slice(0, 5).forEach((g, i) => {
      const knowledge = CLAUSE_KNOWLEDGE[g.clause];
      summary += `${i + 1}. **${(g.clause || '').replace(/_/g, ' ')}**: ${g.description || knowledge?.riskWhenMissing || 'Requires attention'}\n`;
    });
  }

  summary += `\n### Regulatory References\n\n`;
  const affectedArticles = [...missingClauses, ...weakClauses]
    .map(c => CLAUSE_KNOWLEDGE[c]?.gdprArticle)
    .filter(Boolean);
  if (affectedArticles.length > 0) {
    summary += `Relevant GDPR articles requiring attention: ${[...new Set(affectedArticles)].join(', ')}\n`;
  } else {
    summary += `No critical GDPR article violations identified.\n`;
  }

  return summary;
}

/**
 * Deep-dive analysis for a specific clause.
 * Uses LLM when configured, falls back to pattern-based analysis.
 */
async function analyzeClause(clauseName, score, report) {
  if (llmClient) {
    const knowledge = CLAUSE_KNOWLEDGE[clauseName];
    const systemPrompt = 'You are a GDPR/data protection compliance expert. Analyze a specific DPA clause. Return a JSON object with fields: clause, displayName, score, status (missing/weak/partial/strong), description, gdprArticle, analysis, bestPractice, remediation (null if score>=80), riskLevel (critical/high/medium/low).';
    const userPrompt = `Clause: ${clauseName}\nScore: ${score}/100\nGDPR Article: ${knowledge?.gdprArticle || 'N/A'}\nDescription: ${knowledge?.description || clauseName}\nFull report context: ${JSON.stringify(report.risk_profile || {}).slice(0, 1000)}`;
    const llmResult = await llmComplete(systemPrompt, userPrompt);
    if (llmResult) {
      try {
        return JSON.parse(llmResult);
      } catch { /* fall through to pattern-based */ }
    }
  }

  return analyzeClausePattern(clauseName, score, report);
}

function analyzeClausePattern(clauseName, score, report) {
  const knowledge = CLAUSE_KNOWLEDGE[clauseName];
  if (!knowledge) {
    return {
      clause: clauseName,
      score,
      analysis: `No detailed knowledge available for clause "${clauseName}".`,
      recommendation: 'Consult with a data protection specialist for detailed analysis.'
    };
  }

  let status, analysis;
  if (score === 0) {
    status = 'missing';
    analysis = `This clause is **entirely absent** from the contract. ${knowledge.riskWhenMissing}`;
  } else if (score < 50) {
    status = 'weak';
    analysis = `This clause has **weak coverage** (score: ${score}/100). While some language exists, it falls short of regulatory requirements. ${knowledge.riskWhenMissing}`;
  } else if (score < 80) {
    status = 'partial';
    analysis = `This clause has **partial coverage** (score: ${score}/100). The core requirement is addressed but lacks specificity or completeness.`;
  } else {
    status = 'strong';
    analysis = `This clause has **strong coverage** (score: ${score}/100). The contract adequately addresses this requirement.`;
  }

  return {
    clause: clauseName,
    displayName: clauseName.replace(/_/g, ' '),
    score,
    status,
    description: knowledge.description,
    gdprArticle: knowledge.gdprArticle,
    analysis,
    bestPractice: knowledge.bestPractice,
    remediation: score < 80 ? knowledge.remediation : null,
    riskLevel: score === 0 ? 'critical' : score < 50 ? 'high' : score < 80 ? 'medium' : 'low'
  };
}

/**
 * Generate AI-powered remediation plan.
 * Uses LLM when configured, falls back to pattern-based generation.
 */
async function generateRemediationPlan(audit, report) {
  if (llmClient) {
    const clauseScores = extractClauseScores(report);
    const systemPrompt = 'You are a GDPR/data protection compliance expert. Generate a remediation plan for a DPA audit. Return a JSON object with fields: generatedAt, contractName, totalItems, criticalCount, highCount, mediumCount, estimatedTotalHours, items (array of {priority, priorityLabel, clause, displayName, currentScore, targetScore, gdprArticle, issue, suggestedLanguage, effort, estimatedTimeHours, regulatoryImpact}).';
    const userPrompt = `Contract: ${audit.contractName}\nClause Scores: ${JSON.stringify(clauseScores)}\nGaps: ${JSON.stringify((report.gap_report || []).slice(0, 10))}`;
    const llmResult = await llmComplete(systemPrompt, userPrompt);
    if (llmResult) {
      try {
        return JSON.parse(llmResult);
      } catch { /* fall through to pattern-based */ }
    }
  }

  return generateRemediationPlanPattern(audit, report);
}

function generateRemediationPlanPattern(audit, report) {
  const clauseScores = extractClauseScores(report);
  const items = [];

  const sorted = Object.entries(clauseScores).sort((a, b) => a[1] - b[1]);

  sorted.forEach(([clause, score]) => {
    if (score >= 80) return;
    const knowledge = CLAUSE_KNOWLEDGE[clause];
    if (!knowledge) return;

    items.push({
      priority: score === 0 ? 1 : score < 50 ? 2 : 3,
      priorityLabel: score === 0 ? 'Critical' : score < 50 ? 'High' : 'Medium',
      clause,
      displayName: clause.replace(/_/g, ' '),
      currentScore: score,
      targetScore: 85,
      gdprArticle: knowledge.gdprArticle,
      issue: score === 0 ? `${knowledge.description} clause is missing entirely` : `${knowledge.description} clause has insufficient coverage`,
      suggestedLanguage: knowledge.remediation,
      effort: score === 0 ? 'High — requires new clause drafting' : 'Medium — requires clause amendment',
      estimatedTimeHours: score === 0 ? 4 : 2,
      regulatoryImpact: knowledge.riskWhenMissing
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    contractName: audit.contractName,
    totalItems: items.length,
    criticalCount: items.filter(i => i.priority === 1).length,
    highCount: items.filter(i => i.priority === 2).length,
    mediumCount: items.filter(i => i.priority === 3).length,
    estimatedTotalHours: items.reduce((sum, i) => sum + i.estimatedTimeHours, 0),
    items: items.sort((a, b) => a.priority - b.priority)
  };
}

/**
 * Natural language search — parse user query into structured search params
 */
function parseNaturalLanguageQuery(query) {
  const q = query.toLowerCase().trim();
  const result = { filters: {}, explanation: '' };

  // Risk level detection
  if (/\b(critical|high.?risk|dangerous|severe)\b/.test(q)) {
    result.filters.risk = 'Critical';
    result.explanation += 'Filtering for critical risk audits. ';
  } else if (/\b(high)\b/.test(q) && /\b(risk)\b/.test(q)) {
    result.filters.risk = 'High';
    result.explanation += 'Filtering for high risk audits. ';
  } else if (/\b(moderate|medium|mid)\b/.test(q)) {
    result.filters.risk = 'Moderate';
    result.explanation += 'Filtering for moderate risk audits. ';
  } else if (/\b(low.?risk|safe|good|compliant)\b/.test(q)) {
    result.filters.risk = 'Low';
    result.explanation += 'Filtering for low risk audits. ';
  }

  // Status detection
  if (/\b(complete|completed|done|finished)\b/.test(q)) {
    result.filters.status = 'complete';
    result.explanation += 'Showing completed audits. ';
  } else if (/\b(processing|running|pending|in.?progress)\b/.test(q)) {
    result.filters.status = 'processing';
    result.explanation += 'Showing audits in progress. ';
  } else if (/\b(fail|error|broken)\b/.test(q)) {
    result.filters.status = 'failed';
    result.explanation += 'Showing failed audits. ';
  }

  // Time detection
  if (/\b(today|this morning|tonight)\b/.test(q)) {
    result.filters.from = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    result.explanation += 'From today. ';
  } else if (/\b(this week|past week|last 7 days)\b/.test(q)) {
    result.filters.from = new Date(Date.now() - 7 * 86400000).toISOString();
    result.explanation += 'From the past 7 days. ';
  } else if (/\b(this month|past month|last 30 days)\b/.test(q)) {
    result.filters.from = new Date(Date.now() - 30 * 86400000).toISOString();
    result.explanation += 'From the past 30 days. ';
  }

  // Clause mention — check multi-word phrases first, then single words
  const clausePhrases = [
    [/\baudit.?rights?\b/, 'audit_rights'],
    [/\bbreach.?notification\b/, 'breach_notification'],
    [/\bdata.?subject.?rights?\b/, 'data_subject_rights'],
    [/\bdsar\b/, 'data_subject_rights'],
    [/\baccess.?request\b/, 'data_subject_rights'],
    [/\bsub.?processor\b/, 'subprocessor_controls'],
    [/\bsecurity.?measures?\b/, 'security_measures'],
    [/\bencryption\b/, 'security_measures'],
    [/\bprocessing.?purpose\b/, 'data_processing_purpose'],
    [/\bretention\b/, 'data_retention'],
    [/\bcross.?border\b/, 'cross_border_transfer'],
    [/\binternational.?transfer\b/, 'cross_border_transfer'],
    [/\bliabilit\w*\b/, 'liability'],
    [/\bindemni\w*\b/, 'liability'],
    [/\btermination\b/, 'termination'],
    [/\bbreach\b/, 'breach_notification'],
    [/\bnotification\b/, 'breach_notification'],
    [/\bsecurity\b/, 'security_measures'],
  ];
  for (const [regex, clause] of clausePhrases) {
    if (regex.test(q)) {
      result.filters.clauseFocus = clause;
      result.explanation += `Focus on ${clause.replace(/_/g, ' ')} clauses. `;
      break;
    }
  }

  // Sort detection
  if (/\b(worst|highest risk|most risky|riskiest)\b/.test(q)) {
    result.filters.sort = 'riskScore';
    result.filters.order = 'desc';
    result.explanation += 'Sorted by highest risk. ';
  } else if (/\b(best|lowest risk|safest)\b/.test(q)) {
    result.filters.sort = 'riskScore';
    result.filters.order = 'asc';
    result.explanation += 'Sorted by lowest risk. ';
  } else if (/\b(recent|latest|newest)\b/.test(q)) {
    result.filters.sort = 'createdAt';
    result.filters.order = 'desc';
    result.explanation += 'Sorted by most recent. ';
  } else if (/\b(oldest|first|earliest)\b/.test(q)) {
    result.filters.sort = 'createdAt';
    result.filters.order = 'asc';
    result.explanation += 'Sorted by oldest. ';
  }

  // Text search — remaining meaningful words
  const stopWords = new Set(['show', 'me', 'find', 'get', 'list', 'all', 'the', 'with', 'that', 'are', 'is', 'a', 'an', 'and', 'or', 'from', 'in', 'of', 'to', 'for', 'my', 'audits', 'contracts', 'results', 'which', 'where', 'what', 'how', 'many', 'issues', 'missing']);
  const clauseStopWords = new Set(['breach', 'notification', 'audit', 'rights', 'security', 'measures', 'subject', 'retention', 'transfer', 'liability', 'termination', 'subprocessor', 'encryption', 'purpose', 'dsar', 'international', 'cross', 'border', 'indemnification']);
  const words = q.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  const searchableWords = words.filter(w => !clauseStopWords.has(w) &&
    !['critical', 'high', 'moderate', 'low', 'complete', 'completed', 'done', 'processing', 'failed', 'today', 'week', 'month', 'worst', 'best', 'recent', 'oldest', 'risk', 'risky'].includes(w));
  if (searchableWords.length > 0) {
    result.filters.search = searchableWords.join(' ');
    result.explanation += `Text search: "${searchableWords.join(' ')}". `;
  }

  if (!result.explanation) {
    result.explanation = 'Showing all audits (no specific filters detected). ';
  }

  return result;
}

/**
 * Generate risk explanation for a specific audit.
 * Uses LLM when configured, falls back to pattern-based analysis.
 */
async function explainRisk(audit, report) {
  if (llmClient) {
    const clauseScores = extractClauseScores(report);
    const systemPrompt = 'You are a GDPR/data protection compliance expert. Explain the risk assessment for a DPA audit. Return a JSON object with fields: riskScore, riskLevel, explanation (markdown string), factors (array of {clause, impact, weight, explanation}), recommendation (string).';
    const userPrompt = `Contract: ${audit.contractName}\nRisk Score: ${audit.riskScore || 0}/100\nRisk Level: ${audit.overallRisk || 'Unknown'}\nClause Scores: ${JSON.stringify(clauseScores)}`;
    const llmResult = await llmComplete(systemPrompt, userPrompt);
    if (llmResult) {
      try {
        return JSON.parse(llmResult);
      } catch { /* fall through to pattern-based */ }
    }
  }

  return explainRiskPattern(audit, report);
}

function explainRiskPattern(audit, report) {
  const clauseScores = extractClauseScores(report);
  const riskScore = audit.riskScore || 0;
  const riskLevel = audit.overallRisk || 'Unknown';
  const factors = [];

  Object.entries(clauseScores).forEach(([clause, score]) => {
    const knowledge = CLAUSE_KNOWLEDGE[clause];
    if (!knowledge) return;
    if (score === 0) {
      factors.push({
        clause,
        impact: 'critical',
        weight: 15,
        explanation: `${knowledge.description} is completely missing. ${knowledge.riskWhenMissing}`
      });
    } else if (score < 50) {
      factors.push({
        clause,
        impact: 'high',
        weight: 10,
        explanation: `${knowledge.description} has weak coverage (${score}/100). Key regulatory requirements under ${knowledge.gdprArticle} are not adequately addressed.`
      });
    } else if (score < 80) {
      factors.push({
        clause,
        impact: 'medium',
        weight: 5,
        explanation: `${knowledge.description} has partial coverage (${score}/100). While basics are present, ${knowledge.gdprArticle} compliance could be improved.`
      });
    }
  });

  factors.sort((a, b) => b.weight - a.weight);

  return {
    riskScore,
    riskLevel,
    explanation: `This contract has a risk score of **${riskScore}/100** (${riskLevel}). ${factors.length > 0 ? 'The following factors contribute to the risk assessment:' : 'All clause categories meet acceptable thresholds.'}`,
    factors,
    recommendation: riskScore > 70
      ? 'Immediate legal review recommended before proceeding with data processing.'
      : riskScore > 40
      ? 'Address high-priority gaps before contract execution.'
      : 'Contract is generally compliant. Consider minor improvements for best practice alignment.'
  };
}

module.exports = {
  generateExecutiveSummary,
  analyzeClause,
  generateRemediationPlan,
  parseNaturalLanguageQuery,
  explainRisk,
  CLAUSE_KNOWLEDGE
};
