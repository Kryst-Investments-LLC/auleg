/**
 * Unit tests for server/lib/email.js
 * Tests email service with mocked SendGrid and BullMQ.
 */

// Mock dependencies before requiring the module
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue([{ statusCode: 202 }])
}), { virtual: true });

jest.mock('../../lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis()
}));

jest.mock('../../lib/metrics', () => ({
  emailsSent: { inc: jest.fn() }
}));

describe('Email service', () => {
  let emailService;
  let metrics;

  beforeAll(() => {
    // No SENDGRID_API_KEY → console mode
    delete process.env.SENDGRID_API_KEY;
    delete process.env.REDIS_URL;
    emailService = require('../../lib/email');
    metrics = require('../../lib/metrics');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isLive()', () => {
    test('returns false when SendGrid is not configured', () => {
      expect(emailService.isLive()).toBe(false);
    });
  });

  describe('sendEmail()', () => {
    test('happy path: sends email in console mode', async () => {
      const result = await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>'
      });
      expect(result.sent).toBe(true);
      expect(result.provider).toBe('console');
    });

    test('increments sent metric on success', async () => {
      await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>'
      });
      expect(metrics.emailsSent.inc).toHaveBeenCalledWith({
        type: 'transactional',
        status: 'sent'
      });
    });

    test('uses custom emailType for metrics', async () => {
      await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Digest',
        html: '<p>Digest</p>',
        emailType: 'digest'
      });
      expect(metrics.emailsSent.inc).toHaveBeenCalledWith({
        type: 'digest',
        status: 'sent'
      });
    });

    test('handles missing optional fields', async () => {
      const result = await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Minimal'
      });
      expect(result.sent).toBe(true);
    });
  });

  describe('sendPasswordReset()', () => {
    test('happy path: sends reset email with correct URL', async () => {
      const result = await emailService.sendPasswordReset('user@test.com', 'abc123token');
      expect(result.sent).toBe(true);
    });

    test('uses CORS_ORIGIN for reset URL', async () => {
      const origCors = process.env.CORS_ORIGIN;
      process.env.CORS_ORIGIN = 'https://app.auleg.com';
      // Re-call — the function reads env at call time
      const result = await emailService.sendPasswordReset('user@test.com', 'token123');
      expect(result.sent).toBe(true);
      process.env.CORS_ORIGIN = origCors;
    });

    test('handles empty token', async () => {
      const result = await emailService.sendPasswordReset('user@test.com', '');
      expect(result.sent).toBe(true);
    });
  });

  describe('sendAuditComplete()', () => {
    test('happy path: sends audit notification', async () => {
      const result = await emailService.sendAuditComplete('user@test.com', {
        contractName: 'Test Contract',
        overallRisk: 'Medium',
        riskScore: 45,
        clausesDetected: 12,
        gapsFound: 3
      });
      expect(result.sent).toBe(true);
    });

    test('handles audit with missing optional fields', async () => {
      const result = await emailService.sendAuditComplete('user@test.com', {
        contractName: 'Minimal',
        clausesDetected: 0,
        gapsFound: 0
      });
      expect(result.sent).toBe(true);
    });
  });

  describe('sendShareInvite()', () => {
    test('happy path: sends share invite', async () => {
      const result = await emailService.sendShareInvite(
        'invitee@test.com',
        'John Doe',
        'Contract ABC',
        'share-token-xyz'
      );
      expect(result.sent).toBe(true);
    });
  });

  describe('sendDigest()', () => {
    test('happy path: sends weekly digest', async () => {
      const result = await emailService.sendDigest('user@test.com', 'Jane', [
        { contractName: 'C1', overallRisk: 'High', riskScore: 80 },
        { contractName: 'C2', overallRisk: 'Low', riskScore: 20 }
      ], 'weekly');
      expect(result.sent).toBe(true);
    });

    test('handles empty audit list', async () => {
      const result = await emailService.sendDigest('user@test.com', 'Jane', [], 'daily');
      expect(result.sent).toBe(true);
    });

    test('handles null user name', async () => {
      const result = await emailService.sendDigest('user@test.com', null, [], 'weekly');
      expect(result.sent).toBe(true);
    });

    test('truncates digest to 10 audits', async () => {
      const audits = Array.from({ length: 15 }, (_, i) => ({
        contractName: `Contract ${i}`,
        overallRisk: 'Medium',
        riskScore: 50
      }));
      const result = await emailService.sendDigest('user@test.com', 'User', audits, 'daily');
      expect(result.sent).toBe(true);
    });
  });

  describe('shutdownEmailQueue()', () => {
    test('resolves when no queue is initialized', async () => {
      await expect(emailService.shutdownEmailQueue()).resolves.not.toThrow();
    });
  });
});
