# CLAUDE.md — auleg (Legal/DPA Audit Platform)

## Project Identity
- **Package:** `auleg` — Legal DPA (Data Processing Agreement) Audit Platform
- **Stack:** Express.js 5 (server/), Node.js 20+, Prisma 7 (PostgreSQL), JWT, Stripe, BullMQ, Redis, SendGrid, Passport/SAML, Anthropic Claude SDK, OpenAI, Pino, Jest, Playwright
- **Package manager:** `npm`
- **Layout:** Root contains Playwright E2E config; server code lives in `server/` with its own `package.json`

## Build / Test / Lint Commands
```bash
# From server/ directory:
cd server && npm run dev           # node --watch dev server
cd server && npm test              # Jest unit/integration suite
cd server && npm run test:coverage # Jest with coverage
cd server && npm run lint          # ESLint (flat config) — gates CI
cd server && npm run lint:fix      # ESLint autofix
cd server && npm run format        # Prettier write (local only; not gated)
cd server && npm run db:generate   # regenerate Prisma client
cd server && npm run db:migrate:dev # Prisma migrate dev (dev only)
cd server && npm run db:migrate    # Prisma migrate deploy (prod)

# From project root:
npx playwright test                # Playwright E2E (e2e/ dir)
```
> **ESLint is configured (flat config, `npm run lint`) and gates CI; there is still NO TypeScript.** The server is plain JavaScript, so the Jest suite + coverage remain the primary safety net for behavior — `npm run lint` catches defects (undefined vars, dupe keys, dead code) but not type errors. Lint errors fail CI; warnings (e.g. unused vars) do not. Prettier (`npm run format`) is available locally but is not a CI gate. Review JS changes carefully before committing.

## Workflow Rules
- **Plan Mode for tasks > 3 steps.** Use `/plan` before any multi-file change.
- **Research before high-stakes decisions.** For legal/DPA-audit questions (compliance interpretation, audit logic defensibility, jurisdictional requirements, what the legal-knowledge base should assert), run `/research <topic>` first — it does a retrieval-grounded, multi-perspective analysis and flags unsourced claims before you commit to a direction.
- Make small, incremental changes — one logical unit per commit.
- Run `cd server && npm test` after every change before committing.
- Commit with clear messages: `type(scope): description`.
- Work on a feature branch; no direct commits to `main`.
- Run Playwright E2E before opening a PR.

## Verification Gate

**Per-change (run after every edit before committing):**
```bash
cd server && npm test              # Jest suite — must pass
cd server && npm run test:coverage # coverage — must not regress
```

**Pre-PR (run once before opening a pull request):**
```bash
npx playwright test                # E2E — must pass (needs dev server on :3000)
```
> Do NOT run Playwright on every small change — it requires the full server + DB to be running. Use it as the PR gate only.

A task is **not done** until the per-change gate passes. Run Playwright once before the PR.
- If verify fails: fix and re-run.
- After **2 consecutive failures on the per-change gate**: STOP — report to human, wait for guidance.
- Maximum 2 auto-retry attempts per verify cycle (hard cap).

## Model Routing (Cost Control)
| Task | Model |
|------|-------|
| DPA audit logic design, legal compliance architecture, AI pipeline planning | **Opus** (`/model opus` or `/opusplan`) |
| Code edits, route handlers, test writing | **Sonnet** (default) |
| Simple lookups, one-liners | **Haiku** |

## Off-Limits Paths — Human Approval Required Per Session
These must NOT be edited autonomously. Explicit human sign-off required each session:

| Category | Paths |
|----------|-------|
| Auth / SSO | `server/routes/auth.js`, `server/routes/sso.js`, `server/routes/mfa.js`, `server/middleware/auth.js`, `server/middleware/rbac.js`, `server/middleware/csrf.js` |
| Billing / Payments | `server/routes/billing.js`, `server/routes/webhooks.js`, `server/lib/billing.js`, `server/lib/stripe.js` |
| Env / Secrets | `server/.env`, `.env.example`, `docker-compose.yml` (contains env references) |
| DB Migrations | `server/prisma/migrations/` — never run `migrate deploy` autonomously |
| Legal / Audit Advice | `audit-engine/`, `legal/`, `server/routes/legal.js`, `server/lib/legal-agent.js`, `server/lib/legal-knowledge.js` |

## Lessons Learned
<!-- Append discoveries here over time — do not delete entries -->
