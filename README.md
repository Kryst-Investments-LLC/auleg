# Auleg

Audit your DPAs in seconds, not weeks. Auleg is a Data Processing Agreement compliance platform that uses AI to analyze contracts, flag missing clauses, and track audit status across your organization.

## Architecture

```
dashboard/          React 19 SPA (CRA, port 3000)
server/             Express 5 API (port 4000)
  ├── routes/       31 route modules
  ├── middleware/   Auth, CSRF, RBAC, rate limiting, validation
  ├── lib/          Business logic (AI, billing, email, VEX, EPSS, etc.)
  └── prisma/       Schema & migrations (44 models)
e2e/                Playwright browser tests
audit-engine/       PDF extraction & audit scripts
```

| Layer     | Tech                                                    |
| --------- | ------------------------------------------------------- |
| Frontend  | React 19, Recharts                                     |
| API       | Express 5, Node.js                                     |
| Database  | PostgreSQL 16, Prisma 7                                |
| Cache     | Redis 7 (BullMQ job queue, EPSS score cache)           |
| AI        | OpenAI (GPT-4o) or Anthropic (Claude) — configurable   |
| Billing   | Stripe                                                  |
| Email     | SendGrid                                                |
| Auth      | JWT sessions, SAML/SSO (passport), API keys            |
| Deploy    | Docker Compose, Railway, Vercel (dashboard)             |

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Redis 7+ (optional for local dev)

### Setup

```bash
# Clone
git clone https://github.com/Kryst-Investments-LLC/auleg.git
cd auleg

# Environment
cp .env.example server/.env
# Edit server/.env — set JWT_SECRET and DATABASE_URL at minimum

# Server
cd server
npm install
npx prisma generate
npx prisma db push
npm run dev          # http://localhost:4000

# Dashboard (separate terminal)
cd dashboard
npm install
npm start            # http://localhost:3000
```

### Docker

```bash
cp .env.example .env
# Fill in required values: JWT_SECRET, POSTGRES_USER, POSTGRES_PASSWORD
docker compose up
```

## API

Interactive docs at `/api-docs` (Swagger UI) when the server is running.

Key route groups:

| Route                  | Description                          |
| ---------------------- | ------------------------------------ |
| `/api/auth`            | Register, login, SSO                 |
| `/api/audits`          | DPA audit CRUD & AI analysis         |
| `/api/templates`       | Reusable audit templates             |
| `/api/licenses`        | Third-party license management       |
| `/api/vex`             | VEX vulnerability statements         |
| `/api/epss`            | EPSS score lookup (cached)           |
| `/api/billing`         | Stripe subscription management       |
| `/api/webhooks`        | Outbound webhook delivery            |
| `/api/workflow`        | Multi-party review workflows         |
| `/api/analytics`       | Audit analytics & reporting          |
| `/api/v1`              | Public API (API-key authenticated)   |
| `/api/health`          | Health check                         |

## Testing

```bash
# Unit tests (server)
cd server
npm test

# Integration tests (requires running PostgreSQL)
npx jest --config jest.integration.config.js --forceExit --runInBand

# E2E tests (requires server + dashboard running)
cd ..
npx playwright test
```

## Environment Variables

See [.env.example](.env.example) for the full list. Required:

| Variable       | Description                              |
| -------------- | ---------------------------------------- |
| `JWT_SECRET`   | 256-bit secret for session tokens        |
| `DATABASE_URL` | PostgreSQL connection string             |

Optional: `AI_PROVIDER`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `SENDGRID_API_KEY`, `REDIS_URL`, `CORS_ORIGIN`.

## License

ISC
