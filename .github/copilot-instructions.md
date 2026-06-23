# Copilot Instructions — auleg (Legal/DPA Audit Platform)
> Mirror of AGENTS.md. Update both files together when instructions change.

## Project Overview
Legal DPA audit platform. Stack: Express.js 5, Node.js 20+, Prisma 7 (PostgreSQL), JWT, Stripe, BullMQ, Redis, SendGrid, Passport/SAML, Anthropic Claude SDK, OpenAI, Pino, Jest, Playwright. Package manager: npm. Server code lives in `server/` subdirectory.

> CRITICAL: No TypeScript (ESLint IS configured). This project is plain JavaScript with no type-checking. ESLint runs via `npm run lint` and gates CI (errors fail, warnings don't). The Jest test suite and coverage report remain the primary safety net for behavior. Review all JS changes carefully.

## Key Commands
```
cd server && npm test                # Jest unit/integration suite
cd server && npm run test:coverage   # Jest with coverage (run after changes)
cd server && npm run dev             # node --watch dev server
npx playwright test                  # E2E — needs server on :3000 (pre-PR only)
```

## Verification Gate
Per-change: `cd server && npm test && npm run test:coverage`
Pre-PR: `npx playwright test` (needs dev server on :3000 — do NOT run per-change)

## Code Standards
- Plain JavaScript (no TypeScript; ESLint configured via `npm run lint`); 2-space indentation
- Express: thin routes → `server/lib/` service layer
- Prisma for DB; Pino for logging (no `console.log` in production paths)
- Write more tests — coverage is the safety net here
- Commit format: `type(scope): description`; feature branches only

## Off-Limits — Requires Human Approval
| Category | Paths |
|----------|-------|
| Auth / SSO | `server/routes/auth.js`, `server/routes/sso.js`, `server/routes/mfa.js`, `server/middleware/auth.js`, `server/middleware/rbac.js`, `server/middleware/csrf.js` |
| Billing | `server/routes/billing.js`, `server/routes/webhooks.js`, `server/lib/billing.js`, `server/lib/stripe.js` |
| Env | `server/.env`, `.env.example`, `docker-compose.yml` |
| DB Migrations | `server/prisma/migrations/` |
| Legal / Audit | `audit-engine/`, `legal/`, `server/routes/legal.js`, `server/lib/legal-agent.js`, `server/lib/legal-knowledge.js` |
