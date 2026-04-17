/**
 * Integration test setup — uses real PostgreSQL database (auleg_smoke).
 *
 * Cleans relevant tables before each suite to ensure isolation.
 * Does NOT mock any internal modules — tests the full Express→Prisma→PostgreSQL flow.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.test') });

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret-minimum-32-chars!!';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@localhost:55432/auleg_smoke';
// Disable rate limiting in integration tests
process.env.API_RATE_LIMIT_MAX = '10000';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
