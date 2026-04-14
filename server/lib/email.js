/**
 * Email service module.
 * 
 * When SENDGRID_API_KEY is set, sends real emails via SendGrid.
 * Falls back to console logging otherwise.
 * 
 * Supports: transactional emails (password reset, audit complete, share invite)
 *           and digest emails (daily/weekly audit summaries).
 * 
 * Enterprise: Uses BullMQ email queue when REDIS_URL is set for
 *             retry with exponential backoff, dead letter tracking.
 */

const logger = require('./logger');
const { emailsSent } = require('./metrics');

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.EMAIL_FROM || 'noreply@auleg.com';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Auleg';

let sgMail = null;
if (SENDGRID_KEY) {
  try {
    sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(SENDGRID_KEY);
    logger.info('Email: SendGrid enabled');
  } catch (e) {
    logger.warn('SendGrid package not installed, emails will be logged to console');
  }
}

// ─── BullMQ Email Queue ─────────────────────────────────
let emailQueue = null;
let emailWorker = null;

function initEmailQueue() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return false;

  try {
    const { Queue, Worker } = require('bullmq');
    const IORedis = require('ioredis');

    const connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    });

    emailQueue = new Queue('emails', {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: { age: 3 * 24 * 3600 },
        removeOnFail: { age: 30 * 24 * 3600 }
      }
    });

    emailWorker = new Worker('emails', async (job) => {
      const result = await sendEmailDirect(job.data);
      if (!result.sent) {
        throw new Error(result.error || 'Email delivery failed');
      }
      return result;
    }, {
      connection,
      concurrency: 5,
      limiter: { max: 30, duration: 60000 } // 30 emails/min
    });

    emailWorker.on('completed', (job) => {
      emailsSent.inc({ type: job.data.emailType || 'transactional', status: 'sent' });
      logger.debug({ to: job.data.to, type: job.data.emailType }, 'Email delivered');
    });

    emailWorker.on('failed', (job, err) => {
      emailsSent.inc({ type: job?.data?.emailType || 'transactional', status: 'failed' });
      logger.error({ to: job?.data?.to, err: err.message, attempts: job?.attemptsMade }, 'Email delivery failed');
    });

    logger.info('BullMQ email queue initialized');
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'Email queue init failed — sending synchronously');
    return false;
  }
}

initEmailQueue();

function isLive() {
  return !!sgMail;
}

/**
 * Send email directly (used by BullMQ worker or as fallback).
 */
async function sendEmailDirect({ to, subject, text, html }) {
  const msg = {
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject,
    text: text || subject,
    html: html || text || subject
  };

  if (sgMail) {
    try {
      await sgMail.send(msg);
      return { sent: true, provider: 'sendgrid' };
    } catch (err) {
      logger.error({ to, err: err.response?.body?.errors || err.message }, 'SendGrid error');
      return { sent: false, error: err.message };
    }
  }

  // Dev fallback: log to console
  logger.info({ to, subject }, 'Email sent (console mode)');
  return { sent: true, provider: 'console' };
}

/**
 * Send a single email — queued via BullMQ if available, else direct.
 */
async function sendEmail({ to, subject, text, html, emailType }) {
  if (emailQueue) {
    await emailQueue.add('send', { to, subject, text, html, emailType: emailType || 'transactional' });
    return { sent: true, provider: 'queued' };
  }

  const result = await sendEmailDirect({ to, subject, text, html });
  if (result.sent) {
    emailsSent.inc({ type: emailType || 'transactional', status: 'sent' });
  } else {
    emailsSent.inc({ type: emailType || 'transactional', status: 'failed' });
  }
  return result;
}

/**
 * Send password reset email.
 */
async function sendPasswordReset(email, resetToken) {
  const resetUrl = `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
  return sendEmail({
    to: email,
    subject: 'Auleg — Reset Your Password',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1a1a2e;">Reset Your Password</h2>
        <p>You requested a password reset for your Auleg account.</p>
        <p><a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Reset Password</a></p>
        <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">Auleg — AI-Powered DPA Auditor | www.auleg.com</p>
      </div>
    `
  });
}

/**
 * Send audit completion notification email.
 */
async function sendAuditComplete(email, audit) {
  const dashboardUrl = `${process.env.CORS_ORIGIN || 'http://localhost:3000'}`;
  return sendEmail({
    to: email,
    subject: `Auleg — Audit Complete: ${audit.contractName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1a1a2e;">Audit Complete</h2>
        <p>Your DPA audit for <strong>${audit.contractName}</strong> has finished.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; color: #666;">Risk Level</td><td style="padding: 8px; font-weight: 600;">${audit.overallRisk || 'N/A'}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Risk Score</td><td style="padding: 8px; font-weight: 600;">${audit.riskScore || 0}/100</td></tr>
          <tr><td style="padding: 8px; color: #666;">Clauses Detected</td><td style="padding: 8px;">${audit.clausesDetected}</td></tr>
          <tr><td style="padding: 8px; color: #666;">Gaps Found</td><td style="padding: 8px;">${audit.gapsFound}</td></tr>
        </table>
        <p><a href="${dashboardUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Report</a></p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">Auleg — AI-Powered DPA Auditor | www.auleg.com</p>
      </div>
    `
  });
}

/**
 * Send share invitation email.
 */
async function sendShareInvite(email, sharedBy, auditName, shareToken) {
  const shareUrl = `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/shared?token=${shareToken}`;
  return sendEmail({
    to: email,
    subject: `Auleg — ${sharedBy} shared a DPA audit with you`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1a1a2e;">Audit Shared With You</h2>
        <p><strong>${sharedBy}</strong> shared the audit "<strong>${auditName}</strong>" with you on Auleg.</p>
        <p><a href="${shareUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Audit</a></p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">Auleg — AI-Powered DPA Auditor | www.auleg.com</p>
      </div>
    `
  });
}

/**
 * Send email digest (daily or weekly summary).
 */
async function sendDigest(email, userName, audits, period) {
  const dashboardUrl = `${process.env.CORS_ORIGIN || 'http://localhost:3000'}`;
  const totalAudits = audits.length;
  const criticalCount = audits.filter(a => a.overallRisk === 'Critical' || a.overallRisk === 'High').length;

  const auditRows = audits.slice(0, 10).map(a => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${a.contractName}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${a.overallRisk || 'N/A'}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${a.riskScore || 0}</td>
    </tr>
  `).join('');

  return sendEmail({
    to: email,
    subject: `Auleg — Your ${period} audit digest`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1a1a2e;">${period.charAt(0).toUpperCase() + period.slice(1)} Audit Digest</h2>
        <p>Hi ${userName || 'there'}, here's your ${period} summary:</p>
        <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <p style="margin: 0;"><strong>${totalAudits}</strong> audit${totalAudits !== 1 ? 's' : ''} completed${criticalCount > 0 ? ` — <span style="color: #e74c3c;">${criticalCount} high risk</span>` : ''}</p>
        </div>
        ${totalAudits > 0 ? `
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="background: #f0f0f0;">
            <th style="padding: 8px; text-align: left;">Contract</th>
            <th style="padding: 8px; text-align: left;">Risk</th>
            <th style="padding: 8px; text-align: left;">Score</th>
          </tr>
          ${auditRows}
        </table>` : ''}
        <p style="margin-top: 20px;"><a href="${dashboardUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open Dashboard</a></p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">Auleg — AI-Powered DPA Auditor | www.auleg.com</p>
      </div>
    `
  });
}

module.exports = {
  isLive,
  sendEmail,
  sendPasswordReset,
  sendAuditComplete,
  sendShareInvite,
  sendDigest,
  async shutdownEmailQueue() {
    if (emailWorker) await emailWorker.close();
    if (emailQueue) await emailQueue.close();
  }
};
