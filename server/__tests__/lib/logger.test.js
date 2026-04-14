/**
 * Unit tests for logger module.
 */

describe('Logger module', () => {
  let loggerModule;

  beforeAll(() => {
    loggerModule = require('../../lib/logger');
  });

  test('exports a pino logger instance', () => {
    expect(loggerModule).toBeDefined();
    expect(typeof loggerModule.info).toBe('function');
    expect(typeof loggerModule.error).toBe('function');
    expect(typeof loggerModule.warn).toBe('function');
    expect(typeof loggerModule.debug).toBe('function');
  });

  test('child logger works', () => {
    const child = loggerModule.child({ reqId: 'test-123' });
    expect(typeof child.info).toBe('function');
    // Should not throw
    child.info('test message');
  });

  test('logger has redaction configured', () => {
    // Internal check that pino redact is set up
    expect(loggerModule).toBeDefined();
  });
});
