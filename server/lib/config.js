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
  if (process.env.JWT_SECRET === 'change-this-to-a-secure-random-string-in-production') {
    if (process.env.NODE_ENV !== 'development') {
      errors.push('JWT_SECRET is using the default insecure value. Set a secure random string.');
    } else {
      console.warn('WARNING: JWT_SECRET is using the default insecure value. Do not use in production.');
    }
  }

  if (process.env.NODE_ENV === 'production' && process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
    errors.push('STRIPE_WEBHOOK_SECRET is required when Stripe billing is enabled in production');
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
