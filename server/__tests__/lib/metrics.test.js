/**
 * Unit tests for metrics module.
 */

describe('Metrics module', () => {
  let metrics;

  beforeAll(() => {
    metrics = require('../../lib/metrics');
  });

  test('exports a Prometheus registry', () => {
    expect(metrics.register).toBeDefined();
    expect(typeof metrics.register.metrics).toBe('function');
  });

  test('exports custom metrics', () => {
    expect(metrics.httpRequestDuration).toBeDefined();
    expect(metrics.httpRequestTotal).toBeDefined();
    expect(metrics.auditJobDuration).toBeDefined();
    expect(metrics.auditJobsTotal).toBeDefined();
    expect(metrics.auditQueueSize).toBeDefined();
    expect(metrics.emailsSent).toBeDefined();
  });

  test('metricsMiddleware is a function', () => {
    expect(typeof metrics.metricsMiddleware).toBe('function');
  });

  test('registry returns metrics string', async () => {
    const output = await metrics.register.metrics();
    expect(typeof output).toBe('string');
    expect(output).toContain('auleg_');
  });

  test('can increment a counter', () => {
    metrics.auditJobsTotal.inc({ status: 'complete' });
    // No error = pass
  });

  test('can observe histogram', () => {
    metrics.auditJobDuration.observe({ status: 'complete' }, 5.5);
    // No error = pass
  });
});
