/**
 * Tests for cluster-safe legal-KB seeding guard.
 * Prisma is fully mocked; the off-limits seed function is injected.
 */

const { seedLegalKbOnce } = require('../../lib/startup');

function mockPrisma({ count = 0, locked = true } = {}) {
  return {
    regulation: { count: jest.fn().mockResolvedValue(count) },
    $queryRaw: jest.fn().mockResolvedValue([{ locked }])
  };
}

describe('startup.seedLegalKbOnce', () => {
  test('skips when KB already seeded (count > 0) and never seeds', async () => {
    const prisma = mockPrisma({ count: 12 });
    const seedFn = jest.fn();
    const res = await seedLegalKbOnce(prisma, { seedFn });
    expect(res).toEqual({ seeded: false, reason: 'already-seeded' });
    expect(seedFn).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled(); // no lock taken
  });

  test('skips when another instance holds the advisory lock', async () => {
    const prisma = mockPrisma({ count: 0, locked: false });
    const seedFn = jest.fn();
    const res = await seedLegalKbOnce(prisma, { seedFn });
    expect(res).toEqual({ seeded: false, reason: 'lock-held' });
    expect(seedFn).not.toHaveBeenCalled();
  });

  test('seeds when empty and lock acquired, then releases the lock', async () => {
    const prisma = mockPrisma({ count: 0, locked: true });
    const seedFn = jest.fn().mockResolvedValue({ regulations: 7 });
    const res = await seedLegalKbOnce(prisma, { seedFn });
    expect(res).toEqual({ seeded: true, reason: 'seeded' });
    expect(seedFn).toHaveBeenCalledTimes(1);
    // lock acquired + released => two raw calls
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  test('never throws — returns error reason on failure', async () => {
    const prisma = { regulation: { count: jest.fn().mockRejectedValue(new Error('db down')) } };
    const res = await seedLegalKbOnce(prisma, { seedFn: jest.fn() });
    expect(res).toEqual({ seeded: false, reason: 'error' });
  });

  test('releases the lock even if seeding throws', async () => {
    const prisma = mockPrisma({ count: 0, locked: true });
    const seedFn = jest.fn().mockRejectedValue(new Error('seed boom'));
    const res = await seedLegalKbOnce(prisma, { seedFn });
    expect(res).toEqual({ seeded: false, reason: 'error' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2); // lock + unlock (finally)
  });
});
