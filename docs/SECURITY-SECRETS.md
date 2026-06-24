# Secrets Inventory & Rotation Checklist

Scope: every secret/credential the Auleg server consumes, where it comes from,
how sensitive it is, and how to rotate it safely. Produced from a scan of the
committed tree (`.env.example`, `docker-compose.yml`, and all server code).

## Scan result (committed tree)

| Check | Result |
|-------|--------|
| Real secrets committed to git (`.env`, `.pem`, `.key`, tokens) | ✅ None — only `.env.example` (placeholders) is tracked |
| Insecure secret fallbacks in **production** code | ✅ None — the only `process.env.X \|\| 'literal'` fallbacks are in test setup files |
| Hardcoded credentials in `docker-compose.yml` | ✅ None — all via `${VAR:?err}` required-guards; Redis requires auth; DB port not exposed; read-only rootfs |
| Default insecure `JWT_SECRET` blocked in prod | ✅ `config.validateEnv()` exits if the placeholder value is used in production |

## Findings to fix

| ID | Severity | Finding | Action |
|----|----------|---------|--------|
| **S1** | **High** | `crypto.js` derives the AES-256-GCM at-rest key from `WEBHOOK_ENCRYPTION_KEY` **or falls back to `JWT_SECRET`**. `WEBHOOK_ENCRYPTION_KEY` is undocumented and usually unset, so JWT_SECRET is the de-facto encryption key. Rotating `JWT_SECRET` then breaks decryption of all stored webhook secrets. | Set a **dedicated `WEBHOOK_ENCRYPTION_KEY`** (32+ random bytes) **before launch**, while no/low data is encrypted. Add it to `.env.example` and the secret store. |
| **S2** | Medium | `validateEnv()` checks `JWT_SECRET` is present and not the placeholder, but not its **length/entropy**. A short secret passes. | Use ≥ 32 random bytes. A non-fatal length warning was added to `config.collectErrors()`. |
| **S3** | Low | `/metrics` is **unauthenticated when `METRICS_TOKEN` is unset** (the token is optional). | Set `METRICS_TOKEN` in production and require it at the edge. |
| **S4** | Low | `WEBHOOK_ENCRYPTION_KEY` missing from `.env.example`, so operators don't know to set it (feeds S1). | Document it in `.env.example` (off-limits path — owner to add). |

## Secret inventory

| Secret | Required | Used for | Sensitivity | Notes |
|--------|----------|----------|-------------|-------|
| `JWT_SECRET` | **Yes** | Session/JWT signing; **fallback** at-rest encryption key (S1) | Critical | Rotating it invalidates all sessions **and** (today) breaks webhook-secret decryption — see S1 |
| `WEBHOOK_ENCRYPTION_KEY` | Recommended | AES-256-GCM encryption of webhook secrets at rest | Critical | Set a dedicated value; decouples from `JWT_SECRET` |
| `DATABASE_URL` (`POSTGRES_USER`/`POSTGRES_PASSWORD`) | **Yes** | Postgres connection | Critical | Rotate user password at the DB, then update the URL |
| `REDIS_URL` / `REDIS_PASSWORD` | **Yes (prod)** | BullMQ durable queue / cache | High | Required in prod (enforced); rotate password + URL together |
| `STRIPE_SECRET_KEY` | If billing | Stripe API | Critical | Rotate via Stripe dashboard (roll key) |
| `STRIPE_WEBHOOK_SECRET` | If billing | Verify Stripe webhook signatures | High | Required in prod when `STRIPE_SECRET_KEY` set (enforced) |
| `OPENAI_API_KEY` | If `AI_PROVIDER=openai` | LLM clause extraction/analysis | High | Provider dashboard rotation |
| `ANTHROPIC_API_KEY` | If `AI_PROVIDER=anthropic` | LLM clause extraction/analysis | High | Provider dashboard rotation |
| `SENDGRID_API_KEY` | If email | Transactional email | High | Rotate via SendGrid |
| `METRICS_TOKEN` | Recommended | Protect `/metrics` | Medium | If unset, `/metrics` is open (S3) |
| `SENTRY_DSN` | Optional | Error reporting | Low | Not a write credential; low risk |

## Pre-launch secret tasks

- [ ] Generate and set a dedicated `WEBHOOK_ENCRYPTION_KEY` (S1) — do this **before** any webhook secrets are stored
- [ ] Confirm `JWT_SECRET` is ≥ 32 random bytes (S2) and not the placeholder
- [ ] Set `METRICS_TOKEN` (S3)
- [ ] Verify all secrets live only in the platform secret store (Railway variables / Vault) — never in the image, repo, or logs
- [ ] Rotate any secret that was ever pasted into chat, a ticket, or committed historically

## Rotation procedures

**General:** rotate from the secret store, redeploy, verify health, then revoke the old value. Keep old+new valid during the overlap window where the provider allows it.

- **`JWT_SECRET`** — ⚠️ Two coupled effects: (1) all active sessions are invalidated (users re-login); (2) **until S1 is fixed**, any data encrypted by `crypto.js` becomes undecryptable. Order of operations: first set a dedicated `WEBHOOK_ENCRYPTION_KEY` and migrate existing encrypted rows, *then* `JWT_SECRET` can be rotated freely. Until then, treat `JWT_SECRET` as non-rotatable without a re-encryption plan.
- **`WEBHOOK_ENCRYPTION_KEY`** — re-encrypt existing ciphertext: decrypt with the old key, re-encrypt with the new key, in a one-off migration. Don't rotate without that step.
- **`DATABASE_URL` password** — change the Postgres role password, update the URL secret, redeploy. Brief connection blip; use a connection drain if possible.
- **`REDIS_PASSWORD`** — update Redis auth + `REDIS_URL` together; in-flight jobs may retry.
- **`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`** — roll in Stripe dashboard; update both secrets; re-verify a test webhook.
- **`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `SENDGRID_API_KEY`** — create new key at provider, deploy, revoke old. No data impact (the engine falls back to deterministic analysis if an LLM key is briefly absent).
- **`METRICS_TOKEN`** — rotate freely; only affects `/metrics` scrapers.

## Cadence

- Routine rotation: every 90 days for write-capable API keys (Stripe, SendGrid, LLM, DB).
- Immediate rotation: on suspected exposure, employee offboarding, or any commit/log leak.
