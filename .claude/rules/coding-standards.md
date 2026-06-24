# Coding Standards — auleg

## Language & Types
- JavaScript (Node.js 20+) — the server does not use TypeScript; write clear JSDoc comments on all public functions.
- Validate all API inputs at the route level using `express-validator` or inline validation.
- JWT handling belongs exclusively in `server/middleware/auth*` — no inline JWT operations in routes.
- Use `pino` / `pino-http` for structured JSON logging — no `console.log` in production paths.

## Framework Conventions
- **Express.js 5** — routes in `server/routes/`; business logic in service files; middleware in `server/middleware/`.
- **Prisma 7** — all DB access via generated client; no raw SQL. Schema changes only via migrations.
- **BullMQ + Redis** — async jobs (document processing, audits) go through BullMQ queues; no in-process blocking.
- **Anthropic/OpenAI** — AI audit logic routes through `audit-engine/` wrappers; do not call SDKs directly in route handlers.
- **Multer** — file uploads validated for type/size before processing; no unconstrained uploads.

## File Structure
- `server/` — Express API server (own package.json)
  - `server/routes/` — route handlers (thin)
  - `server/middleware/` — auth, rate-limit, validation
  - `server/lib/` — shared utilities
  - `server/prisma/` — Prisma schema and migrations (off-limits)
  - `server/uploads/` — uploaded files (transient — never commit)
- `audit-engine/` — DPA audit logic (off-limits for autonomous edits)
- `e2e/` — Playwright tests
- `legal/` — legal documents (off-limits)

## Style
- Pino structured logs — no bare `console.*`.
- Keep route handlers under 40 lines — extract service functions.
- No commented-out code in commits.
