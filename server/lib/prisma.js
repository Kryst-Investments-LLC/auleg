const { PrismaClient } = require('@prisma/client');
const path = require('path');

let prisma;

// Detect database provider from DATABASE_URL
const dbUrl = process.env.DATABASE_URL || '';
const isPostgres = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://');

if (isPostgres) {
  // PostgreSQL mode — native Prisma driver
  prisma = new PrismaClient();
  console.log('Database: PostgreSQL');
} else {
  // SQLite mode (default) — uses better-sqlite3 driver adapter
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const dbPath = path.resolve(__dirname, '..', 'dev.db');
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter });
  console.log('Database: SQLite');
}

module.exports = prisma;
