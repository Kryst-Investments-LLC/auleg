// Jest setup file
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.test') });

// Set test defaults
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests';
process.env.LOG_LEVEL = 'silent';
