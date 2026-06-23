/**
 * Durable scheduler for recurring background jobs (e.g. trial expiry).
 *
 * Replaces per-process setInterval timers, which are lost on restart and — in
 * cluster mode — run once per worker (duplicate work). When Redis is available
 * this uses a BullMQ repeatable job: the schedule survives restarts and runs
 * exactly once across the whole cluster. Without Redis (local dev) it falls
 * back to setInterval.
 */

const logger = require('./logger');

const HOUR_MS = 60 * 60 * 1000;

let queue = null;
let worker = null;
let intervalTimer = null;

/**
 * Run the trial-expiry job body. Kept tiny and idempotent.
 * @param {object} [deps] injectable for tests
 */
async function runTrialExpiry(deps = {}) {
  const { expireTrials } = deps.trial || require('./trial');
  const count = await expireTrials();
  logger.info({ count }, 'trial-expiry job ran');
  return count;
}

/**
 * Initialize the scheduler.
 * @param {object} [opts]
 * @param {string} [opts.redisUrl] defaults to process.env.REDIS_URL
 * @param {object} [opts.trial] injectable trial module (tests)
 * @returns {Promise<{backend:string}>}
 */
async function initScheduler(opts = {}) {
  const redisUrl = opts.redisUrl !== undefined ? opts.redisUrl : process.env.REDIS_URL;

  // Dev / no-Redis fallback: simple interval, runs once immediately.
  if (!redisUrl) {
    logger.warn('REDIS_URL not set — scheduler using in-process interval (not cluster-safe)');
    await runTrialExpiry(opts).catch(err => logger.error({ err: err.message }, 'trial-expiry failed'));
    intervalTimer = setInterval(
      () => runTrialExpiry(opts).catch(err => logger.error({ err: err.message }, 'trial-expiry failed')),
      HOUR_MS
    );
    intervalTimer.unref?.();
    return { backend: 'interval' };
  }

  const { Queue, Worker } = require('bullmq');
  const IORedis = require('ioredis');
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });

  queue = new Queue('scheduler', { connection });
  worker = new Worker('scheduler', async (job) => {
    if (job.name === 'trial-expiry') return runTrialExpiry(opts);
    return undefined;
  }, { connection });

  worker.on('failed', (job, err) => logger.error({ job: job?.name, err: err.message }, 'scheduler job failed'));

  // Repeatable hourly job — BullMQ dedupes by repeat key, so forking multiple
  // workers that each call add() still yields a single recurring schedule.
  await queue.add('trial-expiry', {}, {
    repeat: { every: HOUR_MS },
    jobId: 'trial-expiry',
    removeOnComplete: true,
    removeOnFail: 100
  });

  logger.info('Scheduler initialized with BullMQ (trial-expiry hourly)');
  return { backend: 'bullmq' };
}

async function shutdownScheduler() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}

module.exports = { initScheduler, shutdownScheduler, runTrialExpiry };
