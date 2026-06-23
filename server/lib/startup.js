/**
 * Startup helpers that must be safe under cluster mode / multiple instances.
 */

const logger = require('./logger');

// Arbitrary constant key for the Postgres advisory lock guarding KB seeding.
const KB_SEED_LOCK_KEY = 481516;

/**
 * Seed the legal knowledge base at most once, safely across cluster workers and
 * multiple containers.
 *
 *  - Short-circuits if the KB already has regulations (avoids the per-boot
 *    delete-and-recreate of articles that seedLegalDatabase performs).
 *  - Otherwise takes a Postgres session advisory lock so exactly one instance
 *    seeds while the others skip, then releases it.
 *
 * Never throws — seeding failure must not crash startup.
 *
 * @param {object} prisma Prisma client
 * @param {object} [opts]
 * @param {() => Promise<any>} [opts.seedFn] override seed function (tests)
 * @returns {Promise<{seeded:boolean, reason:string}>}
 */
async function seedLegalKbOnce(prisma, opts = {}) {
  try {
    const existing = await prisma.regulation.count();
    if (existing > 0) {
      logger.info({ regulations: existing }, 'Legal KB already seeded — skipping');
      return { seeded: false, reason: 'already-seeded' };
    }

    const rows = await prisma.$queryRaw`SELECT pg_try_advisory_lock(${KB_SEED_LOCK_KEY}) AS locked`;
    const locked = Array.isArray(rows) && rows[0] && (rows[0].locked === true || rows[0].locked === 't');
    if (!locked) {
      logger.info('Legal KB seed skipped — another instance holds the seed lock');
      return { seeded: false, reason: 'lock-held' };
    }

    try {
      const seedFn = opts.seedFn || require('./legal-knowledge').seedLegalDatabase;
      const result = await seedFn();
      logger.info(result, 'Legal KB seeded');
      return { seeded: true, reason: 'seeded' };
    } finally {
      await prisma.$queryRaw`SELECT pg_advisory_unlock(${KB_SEED_LOCK_KEY})`;
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Legal KB seed error');
    return { seeded: false, reason: 'error' };
  }
}

module.exports = { seedLegalKbOnce, KB_SEED_LOCK_KEY };
