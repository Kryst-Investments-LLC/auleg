/**
 * Redlining Engine
 * 
 * Analyzes DPA text clause-by-clause, identifies problem sentences,
 * and generates inline fix suggestions with confidence scores.
 */

const prisma = require('./prisma');
const { llmComplete } = require('./ai');

const CLAUSE_PATTERNS = {
  audit_rights: {
    keywords: ['audit', 'inspect', 'examination', 'access to premises', 'right to audit'],
    weakness: ['reasonable', 'at own expense', 'upon request only', 'with prior approval'],
    strength: ['annual audit', 'third-party auditor', 'without prior notice', 'at processor expense', 'unfettered access']
  },
  breach_notification: {
    keywords: ['breach', 'incident', 'unauthorized access', 'data breach', 'security incident'],
    weakness: ['as soon as practicable', 'reasonable time', 'promptly', 'without undue delay'],
    strength: ['within 24 hours', 'within 72 hours', 'immediately notify', 'written notification']
  },
  data_subject_rights: {
    keywords: ['data subject', 'access request', 'erasure', 'rectification', 'portability', 'right to be forgotten'],
    weakness: ['commercially reasonable', 'best efforts', 'where feasible'],
    strength: ['within 5 business days', 'at no additional cost', 'automated process', 'without delay']
  },
  subprocessor_controls: {
    keywords: ['sub-processor', 'subprocessor', 'subcontract', 'third party processor', 'onward transfer'],
    weakness: ['general written authorization', 'may engage', 'list available upon request'],
    strength: ['prior written consent', 'right to object', 'equivalent obligations', '14-day notice', 'flow-down']
  },
  security_measures: {
    keywords: ['encryption', 'security', 'technical measures', 'organizational measures', 'access control', 'pseudonymization'],
    weakness: ['appropriate measures', 'industry standard', 'commercially reasonable'],
    strength: ['AES-256', 'TLS 1.3', 'SOC 2', 'ISO 27001', 'penetration testing', 'role-based access']
  },
  cross_border_transfer: {
    keywords: ['transfer', 'international', 'third country', 'adequacy', 'standard contractual', 'SCCs', 'binding corporate rules'],
    weakness: ['may transfer', 'as necessary', 'in accordance with law'],
    strength: ['SCCs', 'transfer impact assessment', 'adequacy decision', 'approved jurisdictions', 'supplementary measures']
  },
  data_retention: {
    keywords: ['retention', 'deletion', 'destruction', 'return', 'storage limitation', 'data minimization'],
    weakness: ['reasonable period', 'as required by law', 'upon request'],
    strength: ['within 30 days', 'certified deletion', 'automatic purge', 'retention schedule']
  },
  data_processing_purpose: {
    keywords: ['purpose', 'scope', 'processing activities', 'categories of data', 'data subjects'],
    weakness: ['as needed', 'related purposes', 'may process'],
    strength: ['exhaustive list', 'sole purpose', 'explicitly prohibited', 'documented instructions']
  },
  liability: {
    keywords: ['liability', 'indemnif', 'damages', 'compensation', 'insurance'],
    weakness: ['limited liability', 'aggregate cap', 'excluding indirect'],
    strength: ['unlimited liability for breaches', 'cyber insurance', 'mutual indemnification', 'uncapped for willful']
  },
  termination: {
    keywords: ['termination', 'expiry', 'wind-down', 'transition', 'end of contract'],
    weakness: ['upon termination', 'may request', 'reasonable transition'],
    strength: ['within 30 days', 'certified deletion', 'transition assistance', 'right to terminate for cause']
  }
};

/**
 * Split document text into sentences for analysis.
 */
function splitIntoSentences(text) {
  // Split on period, question mark, exclamation, or semicolon followed by space or newline
  const raw = text.split(/(?<=[.!?;])\s+/);
  const sentences = [];
  let lineNum = 1;
  let pos = 0;
  for (const s of raw) {
    const trimmed = s.trim();
    if (trimmed.length < 10) { pos += s.length + 1; continue; } // skip tiny fragments
    const linesInSegment = s.substring(0, pos).split('\n').length;
    sentences.push({ text: trimmed, lineStart: lineNum, lineEnd: lineNum + (trimmed.split('\n').length - 1) });
    lineNum = linesInSegment;
    pos += s.length + 1;
  }
  return sentences;
}

/**
 * Detect which clause type a sentence belongs to.
 */
function detectClauseType(sentence) {
  const lower = sentence.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  for (const [clause, patterns] of Object.entries(CLAUSE_PATTERNS)) {
    let score = 0;
    for (const kw of patterns.keywords) {
      if (lower.includes(kw)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = clause;
    }
  }
  return bestScore >= 2 ? bestMatch : null;
}

/**
 * Analyze a sentence for weaknesses and generate a confidence score.
 */
function analyzeSentence(sentence, clauseType) {
  const lower = sentence.toLowerCase();
  const patterns = CLAUSE_PATTERNS[clauseType];
  if (!patterns) return null;

  let weaknessCount = 0;
  let strengthCount = 0;
  const weaknesses = [];
  const strengths = [];

  for (const w of patterns.weakness) {
    if (lower.includes(w)) { weaknessCount++; weaknesses.push(w); }
  }
  for (const s of patterns.strength) {
    if (lower.includes(s)) { strengthCount++; strengths.push(s); }
  }

  // If no weaknesses found, this sentence is fine
  if (weaknessCount === 0 && strengthCount > 0) return null;
  if (weaknessCount === 0 && strengthCount === 0) return null;

  const severity = weaknessCount >= 3 ? 'critical' : weaknessCount >= 2 ? 'high' : 'medium';
  const confidence = Math.min(0.95, 0.5 + (weaknessCount * 0.15) + (strengthCount > 0 ? -0.1 : 0));

  return { weaknesses, strengths, severity, confidence, weaknessCount };
}

/**
 * Generate a suggested fix for a weak sentence.
 */
async function generateSuggestion(sentence, clauseType, weaknesses, auditContext) {
  // Try LLM first
  if (llmComplete) {
    const systemPrompt = `You are a senior data protection attorney specializing in DPA redlining. 
Given a problematic sentence from a Data Processing Agreement, provide a replacement sentence that:
1. Fixes the identified weaknesses
2. Maintains the original intent
3. Adds specific, measurable obligations
4. References applicable GDPR articles
Return ONLY the replacement sentence text, no explanation.`;

    const userPrompt = `Original sentence: "${sentence}"
Clause type: ${clauseType.replace(/_/g, ' ')}
Identified weaknesses: ${weaknesses.join(', ')}
Context: This is from a DPA clause about ${clauseType.replace(/_/g, ' ')}.`;

    const llmResult = await llmComplete(systemPrompt, userPrompt);
    if (llmResult) return llmResult.trim();
  }

  // Fallback: pattern-based suggestions
  return generatePatternSuggestion(sentence, clauseType, weaknesses);
}

function generatePatternSuggestion(sentence, clauseType, weaknesses) {
  const templates = {
    audit_rights: 'The Controller shall have the right to conduct, or appoint an independent third-party auditor to conduct, annual audits of the Processor\'s data processing activities with thirty (30) days\' written notice, at the Processor\'s expense.',
    breach_notification: 'The Processor shall notify the Controller in writing within twenty-four (24) hours of becoming aware of any Personal Data Breach, providing full details including the nature of the breach, categories of data subjects affected, likely consequences, and measures taken to address the breach.',
    data_subject_rights: 'The Processor shall assist the Controller in responding to all Data Subject Rights requests within five (5) business days of notification, at no additional cost, including requests for access, rectification, erasure, restriction, portability, and objection.',
    subprocessor_controls: 'The Processor shall not engage any Sub-processor without obtaining the Controller\'s prior specific written consent, shall maintain a current register of all Sub-processors, and shall impose equivalent data protection obligations on each Sub-processor through a written contract.',
    security_measures: 'The Processor shall implement and maintain appropriate technical and organizational measures including AES-256 encryption at rest, TLS 1.3 in transit, role-based access controls, annual penetration testing by an accredited third party, and shall maintain SOC 2 Type II certification.',
    cross_border_transfer: 'The Processor shall not transfer Personal Data outside the EEA without the Controller\'s prior written consent, shall execute Standard Contractual Clauses (SCCs) for each transfer, and shall conduct a Transfer Impact Assessment documenting the legal framework of the destination country.',
    data_retention: 'The Processor shall delete or return all Personal Data within thirty (30) days of termination of the Agreement, provide written certification of deletion, and shall not retain any copies unless required by applicable law with documented justification.',
    data_processing_purpose: 'The Processor shall process Personal Data solely for the purposes explicitly set out in Annex 1, exclusively on the documented instructions of the Controller, and shall immediately inform the Controller if an instruction infringes applicable data protection law.',
    liability: 'Each party shall indemnify the other against all losses, costs, and damages arising from any breach of this Agreement or applicable data protection law, including regulatory fines, without limitation for breaches caused by willful misconduct or gross negligence.',
    termination: 'Either party may terminate this Agreement immediately upon written notice if the other party materially breaches any data protection obligation and fails to cure such breach within thirty (30) days of written notice, and the Processor shall provide ninety (90) days of transition assistance.'
  };

  return templates[clauseType] || sentence;
}

/**
 * Generate explanation for a redline suggestion.
 */
function generateExplanation(clauseType, weaknesses, severity) {
  const explanations = {
    audit_rights: 'This clause lacks specific audit frequency, notice periods, or third-party auditor rights required under GDPR Article 28(3)(h).',
    breach_notification: 'The notification timeline is vague. GDPR Article 33 requires notification within 72 hours — this clause should specify a concrete timeframe.',
    data_subject_rights: 'The assistance obligations lack specificity. GDPR Articles 15-22 require concrete response timelines and comprehensive support.',
    subprocessor_controls: 'Sub-processor governance is insufficient. GDPR Article 28(2) requires prior written authorization and equivalent contractual obligations.',
    security_measures: 'Security measures are described in vague terms. GDPR Article 32 requires specific, state-of-the-art technical and organizational measures.',
    cross_border_transfer: 'Transfer safeguards are inadequate. GDPR Articles 44-49 require specific mechanisms (SCCs, BCRs) and transfer impact assessments.',
    data_retention: 'Retention/deletion obligations lack concrete timelines. GDPR Article 28(3)(g) requires clear data return or deletion upon termination.',
    data_processing_purpose: 'Processing scope is too broad. GDPR Article 28(3) requires specific, documented purposes and instructions from the controller.',
    liability: 'Liability provisions may not adequately cover data protection violations. GDPR Article 82 establishes rights to compensation.',
    termination: 'Termination provisions lack clear data handling obligations. GDPR Article 28(3)(g) requires data return/deletion upon termination.'
  };

  let explanation = explanations[clauseType] || `This clause has potential weaknesses in the ${clauseType.replace(/_/g, ' ')} area.`;
  if (weaknesses.length > 0) {
    explanation += ` Identified issues: use of vague language ("${weaknesses.join('", "')}").`;
  }
  return explanation;
}

/**
 * Run full redline analysis on a document.
 * Returns array of redline suggestions.
 */
async function analyzeDocument(text, auditId) {
  const sentences = splitIntoSentences(text);
  const redlines = [];

  for (const sent of sentences) {
    const clauseType = detectClauseType(sent.text);
    if (!clauseType) continue;

    const analysis = analyzeSentence(sent.text, clauseType);
    if (!analysis) continue;

    const suggestedText = await generateSuggestion(sent.text, clauseType, analysis.weaknesses);
    const explanation = generateExplanation(clauseType, analysis.weaknesses, analysis.severity);

    redlines.push({
      auditId,
      clause: clauseType,
      originalText: sent.text,
      suggestedText,
      explanation,
      severity: analysis.severity,
      confidence: analysis.confidence,
      lineStart: sent.lineStart,
      lineEnd: sent.lineEnd
    });
  }

  return redlines;
}

/**
 * Save redlines to database.
 */
async function saveRedlines(redlines) {
  if (redlines.length === 0) return [];
  const created = [];
  for (const r of redlines) {
    const saved = await prisma.redline.create({ data: r });
    created.push(saved);
  }
  return created;
}

/**
 * Get redlines for an audit.
 */
async function getRedlines(auditId, filters = {}) {
  const where = { auditId };
  if (filters.clause) where.clause = filters.clause;
  if (filters.severity) where.severity = filters.severity;
  if (filters.status) where.status = filters.status;
  return prisma.redline.findMany({ where, orderBy: { lineStart: 'asc' } });
}

/**
 * Update redline status (accept, reject, modify).
 */
async function updateRedlineStatus(id, status, modifiedText) {
  const data = { status };
  if (modifiedText && status === 'modified') {
    data.suggestedText = modifiedText;
  }
  return prisma.redline.update({ where: { id }, data });
}

/**
 * Generate a redlined document (original text with inline track-changes markers).
 */
async function generateRedlinedDocument(auditId, text) {
  const redlines = await getRedlines(auditId);
  if (redlines.length === 0) return { text, redlineCount: 0 };

  // Sort by position in document (descending so replacements don't shift indices)
  const accepted = redlines.filter(r => r.status === 'accepted' || r.status === 'modified');
  let result = text;

  // Apply accepted changes
  for (const r of accepted.reverse()) {
    const idx = result.indexOf(r.originalText);
    if (idx !== -1) {
      result = result.substring(0, idx) + r.suggestedText + result.substring(idx + r.originalText.length);
    }
  }

  return { text: result, redlineCount: accepted.length, totalSuggestions: redlines.length };
}

module.exports = {
  analyzeDocument,
  saveRedlines,
  getRedlines,
  updateRedlineStatus,
  generateRedlinedDocument,
  detectClauseType,
  analyzeSentence,
  splitIntoSentences
};
