# AGENTS.md — auleg (Legal/DPA Audit Platform)
> Universal agent instructions. Read by Claude Code, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Aider, Zed, and Warp.
> Claude-specific behavior (model routing, /plan) lives in CLAUDE.md on top of this file.

## Project Overview
Legal DPA (Data Processing Agreement) audit platform (`auleg`).
Stack: Express.js 5 (server/), Node.js 20+, Prisma 7 (PostgreSQL), JWT, Stripe, BullMQ, Redis, SendGrid, Passport/SAML, Anthropic Claude SDK, OpenAI, Pino, Jest, Playwright.
Package manager: **npm**.
Layout: Root contains Playwright E2E config; server code lives in `server/` with its own `package.json`.

> **CRITICAL — No TypeScript (ESLint IS configured):** This project is plain JavaScript with no type-checking step. ESLint (flat config) runs via `npm run lint` and gates CI — lint errors fail CI, warnings do not. Because there are no types, the Jest test suite and coverage report remain the primary safety net for behavior. Review all JS changes more carefully before suggesting them.

## Build & Test Commands
```bash
# From server/ directory:
cd server && npm run dev             # node --watch dev server
cd server && npm test                # Jest unit/integration suite
cd server && npm run test:coverage   # Jest with coverage report
cd server && npm run db:generate     # regenerate Prisma client
cd server && npm run db:migrate:dev  # Prisma migrate dev (dev only)
cd server && npm run db:migrate      # Prisma migrate deploy (prod)

# From project root:
npx playwright test                  # Playwright E2E (e2e/ dir, needs server on :3000)
```

## Verification Gate
**Per-change:** `cd server && npm test && npm run test:coverage`
**Pre-PR:** `npx playwright test` (needs dev server on :3000 — do NOT run per-change; it burns retries on environment setup failures)
After 2 consecutive per-change failures: stop and report to the human. Do not loop.

## Code Standards
- Plain JavaScript (ES modules where configured); no TypeScript
- 2-space indentation
- Express route handlers: thin — delegate to service layer in `server/lib/`
- Prisma for all DB access — no raw SQL outside Prisma queries
- Pino for structured logging — no `console.log` in production paths
- Write more tests, not fewer — coverage is the safety net here
- Commit format: `type(scope): description`
- Feature branches only — no direct commits to `main`

## Architecture
- Server entry: `server/index.js` or `server/app.js`
- Routes: `server/routes/`
- Middleware: `server/middleware/`
- Shared logic: `server/lib/`
- Audit engine: `audit-engine/`
- Legal knowledge: `legal/`
- E2E tests: `e2e/` (project root, Playwright)

## Off-Limits — Human Approval Required Per Session
Do not edit any of these paths autonomously. Each requires explicit sign-off in the current session.

| Category | Paths |
|----------|-------|
| Auth / SSO | `server/routes/auth.js`, `server/routes/sso.js`, `server/routes/mfa.js`, `server/middleware/auth.js`, `server/middleware/rbac.js`, `server/middleware/csrf.js` |
| Billing / Payments | `server/routes/billing.js`, `server/routes/webhooks.js`, `server/lib/billing.js`, `server/lib/stripe.js` |
| Env / Secrets | `server/.env`, `.env.example`, `docker-compose.yml` (contains env references) |
| DB Migrations | `server/prisma/migrations/` — never run `migrate deploy` autonomously |
| Legal / Audit Advice | `audit-engine/`, `legal/`, `server/routes/legal.js`, `server/lib/legal-agent.js`, `server/lib/legal-knowledge.js` |
