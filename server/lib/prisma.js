const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL environment variable is not set');
  console.error('Set DATABASE_URL to a PostgreSQL connection string');
  process.exit(1);
}

const adapter = new PrismaPg({
  connectionString,
  client_encoding: 'UTF8'
});

const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

module.exports = prisma;
