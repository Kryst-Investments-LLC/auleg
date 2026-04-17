/**
 * Unit tests for server/lib/url-security.js
 * Tests SSRF protection: URL validation, private IP detection, DNS rebinding prevention.
 */

const mockDnsLookup = jest.fn();

jest.mock('dns', () => ({
  promises: {
    lookup: (...args) => mockDnsLookup(...args)
  }
}));

describe('URL Security module', () => {
  let urlSecurity;

  beforeAll(() => {
    urlSecurity = require('../../lib/url-security');
  });

  afterEach(() => {
    mockDnsLookup.mockReset();
  });

  describe('normalizeAndValidateOutboundUrl()', () => {
    // ─── Happy Path ───
    test('accepts valid HTTPS URL', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const result = await urlSecurity.normalizeAndValidateOutboundUrl('https://example.com/webhook');
      expect(result).toBe('https://example.com/webhook');
    });

    test('accepts valid HTTP URL', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const result = await urlSecurity.normalizeAndValidateOutboundUrl('http://example.com/hook');
      expect(result).toBe('http://example.com/hook');
    });

    test('accepts URL with port', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const result = await urlSecurity.normalizeAndValidateOutboundUrl('https://example.com:8443/webhook');
      expect(result).toBe('https://example.com:8443/webhook');
    });

    test('accepts URL with path and query params', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const result = await urlSecurity.normalizeAndValidateOutboundUrl('https://hooks.example.com/v1/receive?key=abc');
      expect(result).toBe('https://hooks.example.com/v1/receive?key=abc');
    });

    // ─── Invalid URL Format ───
    test('rejects invalid URL format', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('not-a-url'))
        .rejects.toThrow('Invalid URL format');
    });

    test('rejects empty string', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl(''))
        .rejects.toThrow('Invalid URL format');
    });

    // ─── Protocol Enforcement ───
    test('rejects ftp:// protocol', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('ftp://example.com/file'))
        .rejects.toThrow('URL must use http or https');
    });

    test('rejects file:// protocol', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('file:///etc/passwd'))
        .rejects.toThrow('URL must use http or https');
    });

    test('rejects javascript: protocol', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('javascript:alert(1)'))
        .rejects.toThrow();
    });

    // ─── Credential Stripping ───
    test('rejects URL with embedded credentials', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('https://user:pass@example.com'))
        .rejects.toThrow('URLs with embedded credentials are not allowed');
    });

    test('rejects URL with username only', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('https://admin@example.com'))
        .rejects.toThrow('URLs with embedded credentials are not allowed');
    });

    // ─── Blocked Hostnames (SSRF) ───
    test('rejects localhost', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('https://localhost/admin'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    test('rejects localhost.localdomain', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('https://localhost.localdomain/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    test('rejects subdomain of .localhost', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('https://evil.localhost/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    // ─── Private IP Ranges (SSRF) ───
    test('rejects 127.0.0.1 (loopback)', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('http://127.0.0.1:4000/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    test('rejects 10.x.x.x (private class A)', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('http://10.0.0.1/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    test('rejects 192.168.x.x (private class C)', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('http://192.168.1.1/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    test('rejects 172.16.x.x (private class B)', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('http://172.16.0.1/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    test('rejects 169.254.x.x (link-local / cloud metadata)', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('http://169.254.169.254/latest/meta-data/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    test('rejects 0.0.0.0', async () => {
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('http://0.0.0.0/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    // ─── DNS Rebinding Protection ───
    test('rejects hostname resolving to private IP', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('https://evil.example.com/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    test('rejects hostname resolving to loopback', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('https://sneaky.example.com/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    test('rejects unresolvable hostname', async () => {
      mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('https://nonexistent.invalid/'))
        .rejects.toThrow('Unable to resolve destination host');
    });

    test('rejects hostname with mixed public/private resolution', async () => {
      mockDnsLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.1', family: 4 }
      ]);
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('https://dual.example.com/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    test('rejects hostname resolving to empty addresses', async () => {
      mockDnsLookup.mockResolvedValue([]);
      await expect(urlSecurity.normalizeAndValidateOutboundUrl('https://empty.example.com/'))
        .rejects.toThrow('Private or loopback destinations are not allowed');
    });

    // ─── Error Status Codes ───
    test('errors have status 400', async () => {
      try {
        await urlSecurity.normalizeAndValidateOutboundUrl('not-valid');
      } catch (err) {
        expect(err.status).toBe(400);
      }
    });
  });
});
