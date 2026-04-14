/**
 * Unit tests for server/lib/crypto.js
 * Tests AES-256-GCM encryption/decryption.
 */

describe('Crypto module', () => {
  let crypto;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-encryption-key-for-jest';
    crypto = require('../../lib/crypto');
  });

  test('encrypt returns encrypted, iv, and tag', () => {
    const result = crypto.encrypt('hello world');
    expect(result).toHaveProperty('encrypted');
    expect(result).toHaveProperty('iv');
    expect(result).toHaveProperty('tag');
    expect(result.encrypted).not.toBe('hello world');
    expect(result.iv).toHaveLength(32); // 16 bytes hex
    expect(result.tag).toHaveLength(32); // 16 bytes hex
  });

  test('decrypt returns original plaintext', () => {
    const plaintext = 'sensitive webhook secret!';
    const { encrypted, iv, tag } = crypto.encrypt(plaintext);
    const decrypted = crypto.decrypt(encrypted, iv, tag);
    expect(decrypted).toBe(plaintext);
  });

  test('decrypt fails with wrong tag', () => {
    const { encrypted, iv } = crypto.encrypt('test');
    const wrongTag = '00'.repeat(16);
    expect(() => crypto.decrypt(encrypted, iv, wrongTag)).toThrow();
  });

  test('decrypt fails with wrong iv', () => {
    const { encrypted, tag } = crypto.encrypt('test');
    const wrongIv = '00'.repeat(16);
    expect(() => crypto.decrypt(encrypted, wrongIv, tag)).toThrow();
  });

  test('different inputs produce different ciphertexts', () => {
    const r1 = crypto.encrypt('input A');
    const r2 = crypto.encrypt('input B');
    expect(r1.encrypted).not.toBe(r2.encrypted);
  });

  test('same input produces different ciphertexts (random IV)', () => {
    const r1 = crypto.encrypt('same input');
    const r2 = crypto.encrypt('same input');
    expect(r1.iv).not.toBe(r2.iv);
  });
});
