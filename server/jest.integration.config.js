module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/integration/**/*.test.js'],
  setupFiles: ['<rootDir>/__tests__/integration/setup.js'],
  testTimeout: 30000
};
