/**
 * Tests for the durable scheduler — focuses on the no-Redis dev fallback path
 * (the BullMQ path requires a live Redis and is exercised in integration/CI).
 */

const { initScheduler, shutdownScheduler, runTrialExpiry } = require('../../lib/scheduler');

afterEach(async () => {
  await shutdownScheduler();
});

describe('scheduler.runTrialExpiry', () => {
  test('invokes the injected trial module and returns the count', async () => {
    const expireTrials = jest.fn().mockResolvedValue(7);
    const count = await runTrialExpiry({ trial: { expireTrials } });
    expect(expireTrials).toHaveBeenCalledTimes(1);
    expect(count).toBe(7);
  });
});

describe('scheduler.initScheduler (no Redis)', () => {
  test('falls back to interval backend and runs trial expiry once immediately', async () => {
    const expireTrials = jest.fn().mockResolvedValue(0);
    const result = await initScheduler({ redisUrl: '', trial: { expireTrials } });
    expect(result.backend).toBe('interval');
    expect(expireTrials).toHaveBeenCalledTimes(1); // immediate run on startup
  });
});
