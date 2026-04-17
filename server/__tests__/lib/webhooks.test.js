/**
 * Unit tests for server/lib/webhooks.js
 * Tests webhook dispatch with mocked Prisma, crypto, and fetch.
 */

const crypto = require('crypto');

jest.mock('../../lib/prisma', () => ({
  webhook: {
    findMany: jest.fn()
  }
}));

jest.mock('../../lib/url-security', () => ({
  normalizeAndValidateOutboundUrl: jest.fn()
}));

jest.mock('../../lib/crypto', () => ({
  decrypt: jest.fn()
}));

// Mock global fetch
global.fetch = jest.fn();

describe('Webhooks module', () => {
  let webhooks;
  let prisma;
  let urlSecurity;
  let cryptoMod;

  beforeAll(() => {
    webhooks = require('../../lib/webhooks');
    prisma = require('../../lib/prisma');
    urlSecurity = require('../../lib/url-security');
    cryptoMod = require('../../lib/crypto');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('dispatchWebhook()', () => {
    const mockWebhook = {
      id: 'wh1',
      url: 'https://hooks.example.com/receive',
      events: 'audit.complete,audit.create',
      active: true,
      secretEncrypted: 'enc',
      secretIv: 'iv',
      secretTag: 'tag'
    };

    test('happy path: dispatches webhook for matching event', async () => {
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      urlSecurity.normalizeAndValidateOutboundUrl.mockResolvedValue('https://hooks.example.com/receive');
      cryptoMod.decrypt.mockReturnValue('webhook-secret-123');
      global.fetch.mockResolvedValue({ ok: true });

      await webhooks.dispatchWebhook('user1', 'audit.complete', { auditId: 'a1' });

      expect(prisma.webhook.findMany).toHaveBeenCalledWith({
        where: { userId: 'user1', active: true }
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.example.com/receive',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Webhook-Event': 'audit.complete'
          })
        })
      );
    });

    test('sends HMAC-SHA256 signature in header', async () => {
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      urlSecurity.normalizeAndValidateOutboundUrl.mockResolvedValue(mockWebhook.url);
      cryptoMod.decrypt.mockReturnValue('my-secret');
      global.fetch.mockResolvedValue({ ok: true });

      await webhooks.dispatchWebhook('user1', 'audit.complete', { id: '123' });

      const fetchCall = global.fetch.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    test('skips webhook when event does not match', async () => {
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);

      await webhooks.dispatchWebhook('user1', 'user.deleted', { userId: 'u1' });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('skips webhook when URL validation fails (SSRF)', async () => {
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      urlSecurity.normalizeAndValidateOutboundUrl.mockRejectedValue(new Error('Private IP'));

      await webhooks.dispatchWebhook('user1', 'audit.complete', {});

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('skips webhook when secret decryption fails', async () => {
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      urlSecurity.normalizeAndValidateOutboundUrl.mockResolvedValue(mockWebhook.url);
      cryptoMod.decrypt.mockImplementation(() => { throw new Error('Decryption failed'); });

      await webhooks.dispatchWebhook('user1', 'audit.complete', {});

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('handles no webhooks for user', async () => {
      prisma.webhook.findMany.mockResolvedValue([]);

      await webhooks.dispatchWebhook('user1', 'audit.complete', {});

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('handles database error gracefully', async () => {
      prisma.webhook.findMany.mockRejectedValue(new Error('DB connection lost'));

      // Should not throw
      await expect(webhooks.dispatchWebhook('user1', 'audit.complete', {}))
        .resolves.not.toThrow();
    });

    test('dispatches to multiple matching webhooks', async () => {
      const hooks = [
        { ...mockWebhook, id: 'wh1' },
        { ...mockWebhook, id: 'wh2', url: 'https://other.example.com/hook' }
      ];
      prisma.webhook.findMany.mockResolvedValue(hooks);
      urlSecurity.normalizeAndValidateOutboundUrl.mockImplementation(url => Promise.resolve(url));
      cryptoMod.decrypt.mockReturnValue('secret');
      global.fetch.mockResolvedValue({ ok: true });

      await webhooks.dispatchWebhook('user1', 'audit.complete', {});

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('handles fetch failure gracefully (fire-and-forget)', async () => {
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      urlSecurity.normalizeAndValidateOutboundUrl.mockResolvedValue(mockWebhook.url);
      cryptoMod.decrypt.mockReturnValue('secret');
      global.fetch.mockRejectedValue(new Error('Network timeout'));

      // Should not throw even if fetch fails
      await expect(webhooks.dispatchWebhook('user1', 'audit.complete', {}))
        .resolves.not.toThrow();
    });

    test('includes timestamp and event in payload body', async () => {
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      urlSecurity.normalizeAndValidateOutboundUrl.mockResolvedValue(mockWebhook.url);
      cryptoMod.decrypt.mockReturnValue('secret');
      global.fetch.mockResolvedValue({ ok: true });

      await webhooks.dispatchWebhook('user1', 'audit.create', { name: 'Test' });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.event).toBe('audit.create');
      expect(body.timestamp).toBeDefined();
      expect(body.data).toEqual({ name: 'Test' });
    });
  });
});
