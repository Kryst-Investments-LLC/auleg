/**
 * Environment configuration validator.
 * Validates required environment variables on startup.
 */

const REQUIRED = ['JWT_SECRET'];
const OPTIONAL_DEFAULTS = {
  PORT: '4000',
  CORS_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'development'
};

function validateEnv() {
  const errors = [];

  for (const key of REQUIRED) {
    if (!process.env[key] || process.env[key].trim() === '') {
      errors.push(`Missing required environment variable: ${key}`);
    }
  }

  // Warn on insecure defaults
  if (process.env.JWT_SECRET === 'change-this-to-a-secure-random-string-in-production' && process.env.NODE_ENV === 'production') {
    errors.push('JWT_SECRET is using the default insecure value in production');
  }

  // Set optional defaults
  for (const [key, defaultVal] of Object.entries(OPTIONAL_DEFAULTS)) {
    if (!process.env[key]) process.env[key] = defaultVal;
  }

  if (errors.length > 0) {
    console.error('=== CONFIGURATION ERRORS ===');
    errors.forEach(e => console.error(`  ✗ ${e}`));
    console.error('===========================');
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateEnv };
