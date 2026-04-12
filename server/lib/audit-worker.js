const path = require('path');
const fs = require('fs');
const prisma = require('./prisma');
const { dispatchWebhook } = require('./webhooks');
const { logActivity } = require('./activity');
const { notify } = require('./notifications');
const email = require('./email');

// Load audit engine data files (bundled in server/data/)
const ENGINE_DATA = path.resolve(__dirname, '../data');
const clauseDetection = JSON.parse(fs.readFileSync(path.join(ENGINE_DATA, 'clause-detection.json.hbs'), 'utf-8'));
const regulationMapping = JSON.parse(fs.readFileSync(path.join(ENGINE_DATA, 'regulation-mapping.json.hbs'), 'utf-8'));
const remediationLanguage = JSON.parse(fs.readFileSync(path.join(ENGINE_DATA, 'remediation-language.json.hbs'), 'utf-8'));

const queue = [];
let processing = false;

function enqueueAudit(auditId, contractPath, userId, userEmail) {
  queue.push({ auditId, contractPath, userId, userEmail });
  processNext();
}

async function processNext() {
  if (processing || queue.length === 0) return;
  processing = true;

  const job = queue.shift();
  try {
    await runAuditJob(job);
  } catch (err) {
    console.error(`Audit ${job.auditId} failed:`, err.message);
    try {
      await prisma.audit.update({
        where: { id: job.auditId },
        data: { status: 'failed' }
      });
      await dispatchWebhook(job.userId, 'audit.failed', {
        auditId: job.auditId,
        error: err.message
      });
      await notify(job.userId, 'audit.failed', 'Audit Failed', `Audit ${job.auditId} failed: ${err.message}`, { auditId: job.auditId });
    } catch {}
  }

  processing = false;
  if (queue.length > 0) setImmediate(processNext);
}

// ─── Text Extraction ──────────────────────────────────

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const pdf = new PDFParse({ data: new Uint8Array(buffer) });
    await pdf.load();
    const text = await pdf.getText();
    return text;
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

// ─── Clause Detection ──────────────────────────────────

function detectClauses(text) {
  const paragraphs = text.split(/(\r?\n){2,}/);
  const clauses = {};

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length < clauseDetection.heuristics.min_clause_length) continue;

    for (const key of Object.keys(clauseDetection.patterns)) {
      const regexList = clauseDetection.patterns[key];
      const keywords = clauseDetection.keywords[key] || [];

      let regexHit = false;
      for (const regex of regexList) {
        if (new RegExp(regex, 'i').test(trimmed)) {
          regexHit = true;
          break;
        }
      }

      let keywordHits = 0;
      for (const kw of keywords) {
        if (new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(trimmed)) {
          keywordHits++;
        }
      }

      const keywordScore = keywords.length > 0 ? keywordHits / keywords.length : 0;
      const confidence = regexHit ? 0.7 + (keywordScore * 0.3) : keywordScore;

      if (confidence >= clauseDetection.heuristics.confidence_threshold) {
        if (!clauses[key]) {
          clauses[key] = trimmed;
        }
      }
    }
  }

  return clauses;
}

// ─── Regulation Mapping ─────────────────────────────────

function mapRegulations(clauses) {
  const matrix = {};
  for (const clause of Object.keys(clauses)) {
    matrix[clause] = regulationMapping.mapping[clause] || [];
  }
  return matrix;
}

// ─── Gap Analysis ───────────────────────────────────────

function analyzeGaps(clauses) {
  const required = [
    'data_processing_purpose',
    'subprocessor_controls',
    'breach_notification',
    'data_subject_rights',
    'security_measures',
    'audit_rights'
  ];
  return required.filter(req => !clauses[req]);
}

// ─── Risk Scoring ───────────────────────────────────────

const FRAMEWORK_WEIGHTS = { GDPR: 5, CCPA: 3, 'ISO 27701': 2, 'SOC 2': 2 };

const SEVERITY_LIKELIHOOD = {
  breach_notification: [5, 4],
  subprocessor_controls: [4, 3],
  data_subject_rights: [4, 3],
  security_measures: [5, 3],
  audit_rights: [3, 2]
};

function getRegulatoryExposure(frameworkRefs) {
  let total = 0;
  for (const ref of frameworkRefs) {
    for (const [fw, weight] of Object.entries(FRAMEWORK_WEIGHTS)) {
      if (ref.startsWith(fw)) total += weight;
    }
  }
  if (total <= 0) return 1;
  return Math.min(5, Math.round(total / 3));
}

function scoreRisk(clauses, matrix, gaps) {
  const clauseScores = [];
  let totalScore = 0;

  for (const clauseKey of Object.keys(clauses)) {
    const frameworkRefs = matrix[clauseKey] || [];
    const regExposure = getRegulatoryExposure(frameworkRefs);
    const [sev, lik] = SEVERITY_LIKELIHOOD[clauseKey] || [3, 2];
    const clauseScore = Math.round(((sev * 0.5) + (lik * 0.3) + (regExposure * 0.2)) * 20);

    totalScore += clauseScore;
    clauseScores.push({
      clause: clauseKey,
      severity: sev,
      likelihood: lik,
      regulatory_exposure: regExposure,
      score: clauseScore
    });
  }

  const overall = clauseScores.length > 0 ? Math.round(totalScore / clauseScores.length) : 0;
  const riskLevel = overall <= 20 ? 'Low' : overall <= 50 ? 'Moderate' : overall <= 75 ? 'High' : 'Critical';

  return {
    overall_risk: riskLevel,
    score: overall,
    clause_scores: clauseScores,
    missing_clauses: gaps
  };
}

// ─── Remediation ────────────────────────────────────────

function generateRemediation(gaps, clauseScores) {
  const remediation = [];

  for (const gap of gaps) {
    const template = remediationLanguage.templates[gap];
    if (template) {
      remediation.push({
        clause: gap,
        action: 'missing',
        title: template.title,
        severity: template.severity,
        suggested_language: template.suggested_language,
        references: template.references
      });
    } else {
      remediation.push({
        clause: gap,
        action: 'missing',
        title: `Add clause: ${gap}`,
        severity: 'Moderate',
        suggested_language: 'No template available. Consult legal counsel.',
        references: []
      });
    }
  }

  for (const cs of clauseScores) {
    if (cs.score >= 70) {
      const template = remediationLanguage.templates[cs.clause];
      if (template) {
        remediation.push({
          clause: cs.clause,
          action: 'strengthen',
          title: `Strengthen: ${template.title}`,
          severity: template.severity,
          risk_score: cs.score,
          suggested_language: template.suggested_language,
          references: template.references
        });
      }
    }
  }

  return remediation;
}

// ─── Main Audit Job ─────────────────────────────────────

async function runAuditJob(job) {
  // 1. Extract text
  const text = await extractText(job.contractPath);
  if (!text || text.trim().length < 50) {
    throw new Error('Document is empty or too short to analyze');
  }

  // 2. Detect clauses
  const clauses = detectClauses(text);

  // 3. Map regulations
  const matrix = mapRegulations(clauses);

  // 4. Gap analysis
  const gaps = analyzeGaps(clauses);

  // 5. Risk scoring
  const risk = scoreRisk(clauses, matrix, gaps);

  // 6. Remediation
  const remediation = generateRemediation(gaps, risk.clause_scores);

  // 7. Build report
  const report = {
    contract: job.contractPath,
    clauses,
    compliance_matrix: matrix,
    gap_report: gaps,
    risk_profile: risk,
    remediation_plan: remediation,
    generated: new Date().toISOString()
  };

  const reportRaw = JSON.stringify(report, null, 2);

  // 8. Update database
  const data = {
    status: 'complete',
    reportJson: reportRaw,
    riskScore: report.risk_profile.score ?? null,
    overallRisk: report.risk_profile.overall_risk ?? null,
    clausesDetected: Object.keys(report.clauses).length,
    gapsFound: report.gap_report.length
  };

  const updated = await prisma.audit.update({
    where: { id: job.auditId },
    data
  });

  // 9. Activity log + webhook + notification
  await logActivity('audit.complete', {
    detail: `${updated.contractName} → ${updated.overallRisk}(${updated.riskScore})`,
    userId: job.userId,
    userEmail: job.userEmail
  });

  await dispatchWebhook(job.userId, 'audit.complete', {
    auditId: job.auditId,
    contractName: updated.contractName,
    status: 'complete',
    riskScore: updated.riskScore,
    overallRisk: updated.overallRisk,
    clausesDetected: updated.clausesDetected,
    gapsFound: updated.gapsFound
  });

  await notify(job.userId, 'audit.complete',
    'Audit Complete',
    `${updated.contractName} — Risk: ${updated.overallRisk || 'N/A'} (${updated.riskScore ?? '?'})`,
    { auditId: job.auditId, contractName: updated.contractName }
  );

  if (email.isLive() && job.userEmail) {
    await email.sendAuditComplete(job.userEmail, updated).catch(e =>
      console.error('Audit email failed:', e.message)
    );
  }
}

function getQueueStatus() {
  return { queued: queue.length, processing };
}

module.exports = { enqueueAudit, getQueueStatus };
