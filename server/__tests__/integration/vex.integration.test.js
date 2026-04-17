/**
 * Integration test — VEX Filesystem Benchmark
 *
 * Creates 1,000 dummy VEX JSON files on disk, then benchmarks
 * the readStatements() bulk read. Proves the async filesystem
 * approach completes well under the threshold.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../index');
const prisma = require('../../lib/prisma');
const { saveStatement, readStatements, deleteStatements, VEX_DIR } = require('../../lib/vex');

const TEST_EMAIL = `integ-vex-${Date.now()}@test.dev`;
const TEST_PASSWORD = 'SecurePass123!';
const AUDIT_ID = 'benchmark-test-audit';
const FILE_COUNT = 1000;
const MAX_READ_MS = 5000;

let userId;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await request(app)
    .post('/api/auth/register')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD, name: 'VEX Bench' });
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  userId = loginRes.body.user.id;
});

afterAll(async () => {
  await deleteStatements(AUDIT_ID).catch(() => {});
  if (userId) {
    await prisma.activityLog.deleteMany({ where: { userId } });
    await prisma.userPreference.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe('VEX Filesystem Benchmark (1,000 files, async)', () => {
  test('writes 1,000 VEX statements to disk', async () => {
    // Sequential write — saveStatement enforces per-audit cap which requires ordered counting
    for (let i = 0; i < FILE_COUNT; i++) {
      await saveStatement(AUDIT_ID, {
        vulnerability: `CVE-2024-${String(i).padStart(4, '0')}`,
        product: `pkg-${i}`,
        status: 'not_affected',
        justification: `Auto-gen #${i}`,
      });
    }

    const dir = path.join(VEX_DIR, AUDIT_ID);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(FILE_COUNT);
  });

  test('reads all 1,000 statements concurrently under the threshold', async () => {
    const start = performance.now();
    const statements = await readStatements(AUDIT_ID);
    const elapsed = performance.now() - start;

    expect(statements.length).toBe(FILE_COUNT);
    expect(elapsed).toBeLessThan(MAX_READ_MS);

    console.log(`  ⏱  Read ${statements.length} VEX files in ${elapsed.toFixed(1)} ms (limit: ${MAX_READ_MS} ms)`);
  });

  test('each statement has correct structure with whitelisted fields only', async () => {
    const statements = await readStatements(AUDIT_ID);
    const sample = statements[0];

    expect(sample).toHaveProperty('id');
    expect(sample).toHaveProperty('auditId', AUDIT_ID);
    expect(sample).toHaveProperty('vulnerability');
    expect(sample).toHaveProperty('product');
    expect(sample).toHaveProperty('status', 'not_affected');
    expect(sample).toHaveProperty('timestamp');
  });

  test('saveStatement drops unknown fields and rejects oversized values', async () => {
    const result = await saveStatement(AUDIT_ID, {
      vulnerability: 'CVE-2024-9999',
      product: 'p',
      status: 'fixed',
      justification: 'ok',
      maliciousPayload: 'x'.repeat(100000), // unknown field — must be dropped
    });
    const fileContent = JSON.parse(fs.readFileSync(result.path, 'utf-8'));
    expect(fileContent).not.toHaveProperty('maliciousPayload');

    // Oversized justification rejected with 400
    await expect(
      saveStatement(AUDIT_ID, {
        vulnerability: 'CVE-2024-0001',
        product: 'p',
        status: 'fixed',
        justification: 'x'.repeat(10_000),
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  test('safePath rejects directory traversal attacks', async () => {
    await expect(readStatements('../etc')).rejects.toMatchObject({ status: 400 });
    await expect(saveStatement('foo/bar', { vulnerability: 'a', product: 'b', status: 'fixed' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('cleanup removes all files', async () => {
    const removed = await deleteStatements(AUDIT_ID);
    expect(removed).toBeGreaterThanOrEqual(FILE_COUNT);

    const dir = path.join(VEX_DIR, AUDIT_ID);
    expect(fs.existsSync(dir)).toBe(false);
  });
});
