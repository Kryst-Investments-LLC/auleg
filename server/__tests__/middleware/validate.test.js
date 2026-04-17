/**
 * Unit tests for server/middleware/validate.js
 * Tests input sanitization, field validation, email validation, and pagination.
 */

describe('Validate middleware', () => {
  let validate;

  beforeAll(() => {
    validate = require('../../middleware/validate');
  });

  // ─── sanitizeString ───
  describe('sanitizeString()', () => {
    test('trims whitespace', () => {
      expect(validate.sanitizeString('  hello  ')).toBe('hello');
    });

    test('strips null bytes', () => {
      expect(validate.sanitizeString('hello\0world')).toBe('helloworld');
    });

    test('truncates to maxLen', () => {
      expect(validate.sanitizeString('abcdefgh', 5)).toBe('abcde');
    });

    test('returns non-string values unchanged', () => {
      expect(validate.sanitizeString(42)).toBe(42);
      expect(validate.sanitizeString(null)).toBeNull();
      expect(validate.sanitizeString(undefined)).toBeUndefined();
      expect(validate.sanitizeString(true)).toBe(true);
    });

    test('handles empty string', () => {
      expect(validate.sanitizeString('')).toBe('');
    });

    test('handles string with only null bytes', () => {
      expect(validate.sanitizeString('\0\0\0')).toBe('');
    });

    test('handles string with only whitespace', () => {
      expect(validate.sanitizeString('   ')).toBe('');
    });
  });

  // ─── sanitizeObject ───
  describe('sanitizeObject()', () => {
    test('sanitizes nested object values', () => {
      const input = { name: '  Alice\0 ', nested: { val: ' Bob ' } };
      const result = validate.sanitizeObject(input);
      expect(result.name).toBe('Alice');
      expect(result.nested.val).toBe('Bob');
    });

    test('truncates arrays to 500 items', () => {
      const arr = Array.from({ length: 600 }, (_, i) => `item${i}`);
      const result = validate.sanitizeObject(arr);
      expect(result).toHaveLength(500);
    });

    test('limits object keys to 100', () => {
      const obj = {};
      for (let i = 0; i < 150; i++) obj[`key${i}`] = 'val';
      const result = validate.sanitizeObject(obj);
      expect(Object.keys(result)).toHaveLength(100);
    });

    test('handles max depth', () => {
      const deep = { a: { b: { c: { d: { e: { f: 'deep' } } } } } };
      const result = validate.sanitizeObject(deep, 3);
      expect(result.a.b.c).toBeDefined();
    });

    test('handles null', () => {
      expect(validate.sanitizeObject(null)).toBeNull();
    });

    test('handles undefined', () => {
      expect(validate.sanitizeObject(undefined)).toBeUndefined();
    });

    test('handles plain string', () => {
      expect(validate.sanitizeObject(' hello\0 ')).toBe('hello');
    });

    test('handles numbers and booleans unchanged', () => {
      expect(validate.sanitizeObject(42)).toBe(42);
      expect(validate.sanitizeObject(true)).toBe(true);
    });
  });

  // ─── sanitizeBody middleware ───
  describe('sanitizeBody()', () => {
    test('sanitizes request body', () => {
      const req = { body: { name: '  test\0 ', email: ' user@test.com ' } };
      const res = {};
      const next = jest.fn();

      validate.sanitizeBody(req, res, next);
      expect(req.body.name).toBe('test');
      expect(req.body.email).toBe('user@test.com');
      expect(next).toHaveBeenCalled();
    });

    test('skips null body', () => {
      const req = { body: null };
      const next = jest.fn();
      validate.sanitizeBody(req, {}, next);
      expect(next).toHaveBeenCalled();
    });

    test('skips Buffer body', () => {
      const req = { body: Buffer.from('binary data') };
      const next = jest.fn();
      validate.sanitizeBody(req, {}, next);
      expect(next).toHaveBeenCalled();
      expect(Buffer.isBuffer(req.body)).toBe(true);
    });
  });

  // ─── requireFields middleware ───
  describe('requireFields()', () => {
    test('calls next when all fields present', () => {
      const middleware = validate.requireFields('email', 'password');
      const req = { body: { email: 'a@b.com', password: 'secret' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('returns 400 for missing fields', () => {
      const middleware = validate.requireFields('email', 'password');
      const req = { body: { email: 'a@b.com' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('password') })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 400 for empty string values', () => {
      const middleware = validate.requireFields('name');
      const req = { body: { name: '' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('returns 400 for null values', () => {
      const middleware = validate.requireFields('name');
      const req = { body: { name: null } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('handles missing body entirely', () => {
      const middleware = validate.requireFields('email');
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ─── validateEmail middleware ───
  describe('validateEmail()', () => {
    test('accepts valid email', () => {
      const req = { body: { email: 'user@example.com' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validate.validateEmail(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('rejects invalid email format', () => {
      const req = { body: { email: 'not-an-email' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validate.validateEmail(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid email format' })
      );
    });

    test('passes when no email in body', () => {
      const req = { body: {} };
      const next = jest.fn();
      validate.validateEmail(req, {}, next);
      expect(next).toHaveBeenCalled();
    });

    test('rejects email with spaces', () => {
      const req = { body: { email: 'user @test.com' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validate.validateEmail(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('accepts email with subdomain', () => {
      const req = { body: { email: 'user@mail.example.co.uk' } };
      const next = jest.fn();
      validate.validateEmail(req, {}, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // ─── validatePagination middleware ───
  describe('validatePagination()', () => {
    test('passes valid page and limit', () => {
      const req = { query: { page: '2', limit: '25' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validate.validatePagination(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.query.page).toBe(2);
      expect(req.query.limit).toBe(25);
    });

    test('rejects page < 1', () => {
      const req = { query: { page: '0' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validate.validatePagination(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('rejects negative page', () => {
      const req = { query: { page: '-5' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validate.validatePagination(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('rejects non-numeric page', () => {
      const req = { query: { page: 'abc' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validate.validatePagination(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('caps limit at 100', () => {
      const req = { query: { limit: '500' } };
      const res = {};
      const next = jest.fn();

      validate.validatePagination(req, res, next);
      expect(req.query.limit).toBe(100);
    });

    test('passes with no pagination params', () => {
      const req = { query: {} };
      const next = jest.fn();
      validate.validatePagination(req, {}, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
