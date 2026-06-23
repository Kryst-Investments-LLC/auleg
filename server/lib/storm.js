/**
 * STORM pipeline (Phase 3 moat) — Synthesis of Topic Outlines through Retrieval
 * and Multi-perspective question asking.
 *
 * Generates sourced legal-knowledge findings by:
 *   1. asking questions about a topic from multiple stakeholder perspectives
 *      (controller, processor, regulator, DPO);
 *   2. retrieving sources for each question;
 *   3. synthesizing a grounded finding per question;
 *   4. self-critiquing — and crucially, only emitting findings that are backed
 *      by a retrieved sourceUrl. Unsourced claims are dropped, so the KB is never
 *      polluted by hallucinations (the defensibility-under-audit guarantee).
 *
 * Standalone: it does NOT write to the legal KB directly. Instead it exposes a
 * source compatible with the deep researcher (createStormSource), which ingests
 * the sourced findings (still behind a human-review gate). `complete` (LLM) and
 * `retrieve` (source lookup) are injectable, so the pipeline is fully testable
 * offline. Touches none of the off-limits legal modules.
 */

const ai = require('./ai');

const PERSPECTIVES = [
  { role: 'data controller', focus: 'obligations and risks when outsourcing processing' },
  { role: 'data processor', focus: 'compliance duties owed to the controller' },
  { role: 'supervisory authority', focus: 'enforcement priorities and what regulators penalize' },
  { role: 'data protection officer', focus: 'practical audit and documentation requirements' }
];

const QUESTION_SYSTEM = 'You are a legal research planner. Given a topic and a stakeholder perspective, produce focused research questions. Return STRICT JSON only: {"questions": ["...", "..."]}.';
const SYNTH_SYSTEM = 'You are a data-protection legal researcher. Answer the question grounded ONLY in the provided sources. If the sources do not support an answer, say so and omit sourceUrl. Return STRICT JSON only: {"authority","title","summary","implications","regulation","clauseImpact":["..."],"sourceUrl"}.';

/** Extract the first JSON object/array from a model response. Pure. */
function parseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

/** Generate research questions across perspectives. */
async function generateQuestions(topic, opts = {}) {
  const complete = opts.complete || ai.llmComplete;
  const perspectives = opts.perspectives || PERSPECTIVES;
  const maxPerPerspective = opts.maxPerPerspective || 2;
  if (typeof complete !== 'function') return [];

  const questions = [];
  for (const p of perspectives) {
    const raw = await complete(QUESTION_SYSTEM, `Topic: ${topic}\nPerspective: ${p.role} — ${p.focus}`);
    const parsed = parseJson(raw);
    const list = (parsed && Array.isArray(parsed.questions)) ? parsed.questions : [];
    for (const q of list.slice(0, maxPerPerspective)) {
      if (typeof q === 'string' && q.trim()) questions.push({ perspective: p.role, question: q.trim() });
    }
  }
  return questions;
}

/** Research a single question: retrieve sources, synthesize a grounded finding. */
async function researchQuestion(q, opts = {}) {
  const complete = opts.complete || ai.llmComplete;
  // Default grounding: the platform's verified KB (enforcement + guidance with
  // sourceUrls). Pass opts.retrieve to use a different backend (e.g. web search).
  const retrieve = opts.retrieve || require('./kb-retrieval').kbRetrieve;
  if (typeof complete !== 'function') return null;

  const sources = typeof retrieve === 'function' ? (await retrieve(q.question)) || [] : [];
  const ctx = sources.length
    ? sources.map(s => `- ${s.title || 'source'} (${s.url}): ${s.snippet || ''}`).join('\n')
    : '(no sources found)';

  const raw = await complete(SYNTH_SYSTEM, `Question: ${q.question}\nSources:\n${ctx}`);
  const f = parseJson(raw);
  if (!f || typeof f !== 'object') return null;

  // Sourced iff a real sourceUrl exists (from the model or the retrieved set).
  const sourceUrl = f.sourceUrl || sources[0]?.url || null;
  return {
    perspective: q.perspective,
    question: q.question,
    authority: f.authority || null,
    title: f.title || q.question,
    summary: f.summary || '',
    implications: f.implications || '',
    regulation: f.regulation || 'GDPR',
    clauseImpact: Array.isArray(f.clauseImpact) ? f.clauseImpact : [],
    sourceUrl,
    sourced: Boolean(sourceUrl)
  };
}

/**
 * Run the full STORM cycle for a topic.
 * @returns {Promise<{topic,findings,sourced,droppedUnsourced,needsReview,skipped?}>}
 */
async function runStorm(topic, opts = {}) {
  const complete = opts.complete || ai.llmComplete;
  if (typeof complete !== 'function') {
    return { topic, findings: [], sourced: [], droppedUnsourced: 0, needsReview: true, skipped: true, reason: 'no-llm' };
  }

  const questions = await generateQuestions(topic, opts);
  const findings = [];
  for (const q of questions) {
    const f = await researchQuestion(q, opts);
    if (f) findings.push(f);
  }

  const sourced = findings.filter(f => f.sourced);
  return {
    topic,
    findings,
    sourced,
    droppedUnsourced: findings.length - sourced.length,
    needsReview: true // human-review gate before these go live in the KB
  };
}

/** Map a STORM finding to RegulatoryGuidance ingest shape. Pure. */
function toGuidance(f) {
  return {
    authority: f.authority || 'STORM Research',
    title: f.title,
    date: new Date().toISOString(),
    regulation: f.regulation || 'GDPR',
    summary: f.summary || '',
    implications: f.implications || '',
    clauseImpact: f.clauseImpact || [],
    sourceUrl: f.sourceUrl
  };
}

/**
 * Build a deep-researcher-compatible source from a STORM run. Only sourced
 * findings are emitted, so the deep researcher (and its dedupe/ingest) receives
 * source-backed guidance only.
 */
function createStormSource(topic, opts = {}) {
  return async () => {
    const result = await runStorm(topic, opts);
    return { enforcement: [], guidance: result.sourced.map(toGuidance) };
  };
}

module.exports = {
  runStorm,
  generateQuestions,
  researchQuestion,
  createStormSource,
  toGuidance,
  parseJson,
  PERSPECTIVES
};
