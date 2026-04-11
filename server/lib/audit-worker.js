const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const prisma = require('./prisma');
const { dispatchWebhook } = require('./webhooks');
const { logActivity } = require('./activity');
const { notify } = require('./notifications');
const email = require('./email');

const PLATFORM_ROOT = path.resolve(__dirname, '../../');
const AUDIT_OUTPUT = path.join(PLATFORM_ROOT, 'audit-output');

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

function runAuditJob(job) {
  return new Promise((resolve, reject) => {
    const auditScript = path.join(PLATFORM_ROOT, 'audit-engine', 'run-audit.ps1');
    // Per-audit output directory to avoid race conditions
    const jobOutputDir = path.join(AUDIT_OUTPUT, job.auditId);
    if (!fs.existsSync(jobOutputDir)) fs.mkdirSync(jobOutputDir, { recursive: true });

    const child = spawn('pwsh', [
      '-File', auditScript,
      '-ContractPath', job.contractPath
    ], {
      cwd: PLATFORM_ROOT,
      env: { ...process.env, AUDIT_OUTPUT_DIR: jobOutputDir },
      timeout: 120000
    });

    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', async (code) => {
      try {
        // Check both per-audit dir and fallback global dir
        let reportPath = path.join(jobOutputDir, 'audit_report.json');
        if (!fs.existsSync(reportPath)) {
          reportPath = path.join(AUDIT_OUTPUT, 'audit_report.json');
        }

        if (!fs.existsSync(reportPath)) {
          await prisma.audit.update({
            where: { id: job.auditId },
            data: { status: 'failed' }
          });
          await dispatchWebhook(job.userId, 'audit.failed', {
            auditId: job.auditId,
            error: 'No report generated'
          });
          await notify(job.userId, 'audit.failed', 'Audit Failed', 'No report was generated for your audit.', { auditId: job.auditId });
          return resolve();
        }

        const reportRaw = fs.readFileSync(reportPath, 'utf-8');
        const report = JSON.parse(reportRaw);

        const data = {
          status: 'complete',
          reportJson: reportRaw,
          riskScore: report.risk_profile?.score ?? null,
          overallRisk: report.risk_profile?.overall_risk ?? null,
          clausesDetected: report.clauses ? Object.keys(report.clauses).length : 0,
          gapsFound: Array.isArray(report.gap_report) ? report.gap_report.length : 0
        };

        const updated = await prisma.audit.update({
          where: { id: job.auditId },
          data
        });

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

        // Send audit completion email
        if (email.isLive() && job.userEmail) {
          await email.sendAuditComplete(job.userEmail, updated).catch(e =>
            console.error('Audit email failed:', e.message)
          );
        }

        resolve();
      } catch (err) {
        reject(err);
      }
    });

    child.on('error', reject);
  });
}

function getQueueStatus() {
  return { queued: queue.length, processing };
}

module.exports = { enqueueAudit, getQueueStatus };
