const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

/**
 * ESLint flat config for the Auleg server (CommonJS, Node 20+).
 *
 * Philosophy: ESLint catches real bugs (undefined vars, dupe keys, unreachable
 * code); Prettier owns formatting (eslint-config-prettier disables conflicting
 * stylistic rules). Pervasive-but-harmless patterns are warnings, not errors,
 * so `npm run lint` gates CI on genuine defects only.
 */
module.exports = [
  {
    ignores: [
      'node_modules/**',
      'generated/**',
      'coverage/**',
      'data/**',
      'vex-data/**',
      'uploads/**',
      'prisma/migrations/**'
    ]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-prototype-builtins': 'warn',
      'no-console': 'off'
    }
  },
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js', '**/*.spec.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } }
  },
  prettier
];
