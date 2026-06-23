const path = require('path');
const fs = require('fs');
const prisma = require('./prisma');
const { dispatchWebhook } = require('./webhooks');
const { logActivity } = require('./activity');
const { notify } = require('./notifications');
const email = require('./email');
const logger = require('./logger');
const { auditJobDuration, auditJobsTotal, auditQueueSize } = require('./metrics');
// Audit analyzer — LLM-primary clause detection with deterministic fallback
const auditAnalyzer = require('./audit-analyzer');

// ─── BullMQ Queue (Redis-backed, persistent) ───────────
let auditQueue = null;
let auditWorker = null;
let usingBullMQ = false;

// In-memory fallback (for dev/test without Redis)
const memQueue = [];
let memProcessing = false;

function initBullMQ() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    // In production the in-memory queue is not acceptable — it loses jobs on
    // restart. config.validateEnv() already fails startup, but guard here too.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('REDIS_URL is required in production — refusing to start with the non-durable in-memory audit queue.');
    }
    logger.warn('REDIS_URL not set — using in-memory queue (not production-safe)');
    return false;
  }

  try {
    const { Queue, Worker } = require('bullmq');
    const IORedis = require('ioredis');

    const connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    });

    auditQueue = new Queue('audits', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 7 * 24 * 3600 }, // 7 days
        removeOnFail: { age: 30 * 24 * 3600 } // 30 days
      }
    });

    auditWorker = new Worker('audits', async (job) => {
      const start = Date.now();
      try {
        await runAuditJob(job.data);
        const durationSec = (Date.now() - start) / 1000;
        auditJobDuration.observe({ status: 'complete' }, durationSec);
        auditJobsTotal.inc({ status: 'complete' });
      } catch (err) {
        const durationSec = (Date.now() - start) / 1000;
        auditJobDuration.observe({ status: 'failed' }, durationSec);
        auditJobsTotal.inc({ status: 'failed' });
        logger.error({ auditId: job.data.auditId, err: err.message }, 'Audit job failed');
        // Mark audit as failed in DB
        try {
          await prisma.audit.update({
            where: { id: job.data.auditId },
            data: { status: 'failed' }
          });
          await dispatchWebhook(job.data.userId, 'audit.failed', {
            auditId: job.data.auditId,
            error: err.message
          });
          await notify(job.data.userId, 'audit.failed', 'Audit Failed',
            `Audit ${job.data.auditId} failed: ${err.message}`,
            { auditId: job.data.auditId });
        } catch (e) {
          logger.error({ err: e.message }, 'Failed to update audit status');
        }
        throw err; // Let BullMQ handle retries
      }
    }, {
      connection,
      concurrency: Number(process.env.AUDIT_WORKER_CONCURRENCY || 2),
      limiter: {
        max: 10,
        duration: 60000 // Max 10 jobs per minute
      }
    });

    auditWorker.on('completed', (job) => {
      logger.info({ auditId: job.data.auditId }, 'Audit job completed');
    });

    auditWorker.on('failed', (job, err) => {
      logger.error({ auditId: job?.data?.auditId, err: err.message, attempts: job?.attemptsMade }, 'Audit job failed');
    });

    auditWorker.on('error', (err) => {
      logger.error({ err: err.message }, 'Audit worker error');
    });

    usingBullMQ = true;
    logger.info('BullMQ audit queue initialized with Redis');
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'BullMQ init failed — falling back to in-memory queue');
    return false;
  }
}

// Initialize on load
initBullMQ();

async function enqueueAudit(auditId, contractPath, userId, userEmail) {
  const jobData = { auditId, contractPath, userId, userEmail };

  if (usingBullMQ && auditQueue) {
    await auditQueue.add('audit', jobData, {
      jobId: auditId, // Deduplicate by audit ID
      priority: 1
    });
    const counts = await auditQueue.getJobCounts();
    auditQueueSize.set(counts.waiting + counts.active);
    logger.info({ auditId }, 'Audit enqueued via BullMQ');
  } else {
    // In-memory fallback
    memQueue.push(jobData);
    auditQueueSize.set(memQueue.length);
    processNextMem();
  }
}

async function processNextMem() {
  if (memProcessing || memQueue.length === 0) return;
  memProcessing = true;

  const job = memQueue.shift();
  const start = Date.now();
  try {
    await runAuditJob(job);
    auditJobDuration.observe({ status: 'complete' }, (Date.now() - start) / 1000);
    auditJobsTotal.inc({ status: 'complete' });
  } catch (err) {
    auditJobDuration.observe({ status: 'failed' }, (Date.now() - start) / 1000);
    auditJobsTotal.inc({ status: 'failed' });
    logger.error({ auditId: job.auditId, err: err.message }, 'Audit job failed (in-memory)');
    try {
      await prisma.audit.update({
        where: { id: job.auditId },
        data: { status: 'failed' }
      });
      await dispatchWebhook(job.userId, 'audit.failed', {
        auditId: job.auditId,
        error: err.message
      });
      await notify(job.userId, 'audit.failed', 'Audit Failed',
        `Audit ${job.auditId} failed: ${err.message}`,
        { auditId: job.auditId });
    } catch (e) {
      logger.error({ err: e.message }, 'Failed to update audit status after failure');
    }
  }

  memProcessing = false;
  auditQueueSize.set(memQueue.length);
  if (memQueue.length > 0) setImmediate(processNextMem);
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
    const result = await pdf.getText();
    // v2: getText() returns { pages, text, total }
    return result.text || '';
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

// ─── Main Audit Job ─────────────────────────────────────

async function runAuditJob(job) {
  // 1. Extract text
  const text = await extractText(job.contractPath);
  if (!text || text.trim().length < 50) {
    throw new Error('Document is empty or too short to analyze');
  }

  // 2-6. Analysis: LLM-primary clause detection (falls back to deterministic
  // regex when no AI_PROVIDER is configured), then deterministic scoring.
  const analysis = await auditAnalyzer.analyze(text);
  logger.info({ auditId: job.auditId, extractor: analysis.extractor }, 'Audit analysis complete');

  // 7. Build report
  const report = {
    contract: job.contractPath,
    clauses: analysis.clauses,
    compliance_matrix: analysis.compliance_matrix,
    gap_report: analysis.gap_report,
    risk_profile: analysis.risk_profile,
    remediation_plan: analysis.remediation_plan,
    extractor: analysis.extractor,
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
    detail: `${updated.contractName} -> ${updated.overallRisk}(${updated.riskScore})`,
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
      logger.error({ err: e.message }, 'Audit completion email failed')
    );
  }
}

async function getQueueStatus() {
  if (usingBullMQ && auditQueue) {
    const counts = await auditQueue.getJobCounts();
    return {
      queued: counts.waiting,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      backend: 'bullmq'
    };
  }
  return { queued: memQueue.length, processing: memProcessing, backend: 'memory' };
}

async function shutdownWorker() {
  if (auditWorker) {
    await auditWorker.close();
    logger.info('BullMQ audit worker shut down');
  }
  if (auditQueue) {
    await auditQueue.close();
    logger.info('BullMQ audit queue closed');
  }
}

module.exports = { enqueueAudit, getQueueStatus, shutdownWorker };
