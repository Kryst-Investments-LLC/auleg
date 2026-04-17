/**
 * Integration tests — Health (/api/health)
 *
 * Tests health and readiness endpoints against real infrastructure.
 */
const request = require('supertest');
const app = require('../../index');
const prisma = require('../../lib/prisma');

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/health', () => {
  test('returns healthy status', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('Auleg API');
    expect(res.body.timestamp).toBeDefined();
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('GET /api/health/ready', () => {
  test('reports database connectivity', async () => {
    const res = await request(app).get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database).toBe('connected');
  });
});

describe('404 handler', () => {
  test('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});
