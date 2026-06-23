# Testing & Verification — auleg

## Test Runners
- **Jest** — server unit/integration (`server/jest.config.js` and `server/jest.integration.config.js`)
- **Playwright** — E2E critical path (`e2e/critical-path.spec.js`, `e2e/error-states.spec.js`)

## Commands
```bash
# From server/:
cd server && npm test                   # Jest: full suite
cd server && npm run test:coverage      # Jest: with coverage

# From project root:
npx playwright test                     # Playwright: E2E (serial, single worker)
npx playwright test e2e/critical-path.spec.js  # critical path only
```

## Verification Gate
**Per-change:** `cd server && npm test` + `cd server && npm run test:coverage`
**Pre-PR:** `npx playwright test` (needs server on :3000 — do not run per-change)

## Rules
- **ESLint is configured** (`npm run lint`, gates CI) but there is **no TypeScript** — so test coverage is still your primary safety net for behavior. Write more tests, not fewer. Run `npm run lint` before committing; lint errors fail CI (warnings don't).
- Write Jest tests for every new server route or service function.
- Unit tests must not hit the real DB — mock Prisma client or use in-memory.
- Integration tests (`jest.integration.config.js`) hit the local dev DB — never staging/prod.
- Playwright tests run serially (single worker, `fullyParallel: false`) — preserve this setting.
- Playwright is a pre-PR check only, not per-change — don't burn retries on environment setup failures.
- Do not commit `.only` or `.skip` in test files.
- After 2 consecutive verify failures on the per-change gate: stop and report to human. Do not loop further.
- Max retry cap: **2 attempts** per verify cycle.
