# Intelligence Loops — Runbook

How Auleg's Phase 3 "moat" fits together: a chain that keeps the legal knowledge
base current and defensible, and makes each org's audits smarter over time —
something a stateless LLM wrapper structurally cannot replicate.

## The chain

```
STORM ──► review queue ──► deep researcher ──► KB ──► risk signals ──► audit scoring
(sourced,   (admin         (dedupe /         (enforcement   (computeRisk-   (audit-worker
 multi-      approve)        normalize         + guidance)    Signals)        biases LLM
 perspective)                ingest)                                          extraction)
                                                                                  │
                                          memory loop ◄────────────────────────────┘
                                   (org overrides bias future audits)
```

Each stage is independently testable; LLM and data backends are injectable.

## Stages

### 1. STORM — sourced knowledge generation
`lib/storm.js` · tests: `__tests__/lib/storm.test.js`

Generates legal-knowledge findings via multi-perspective question asking
(controller / processor / regulator / DPO) → retrieval → synthesis.
**Safety is deterministic:** a finding is emitted only if it carries a retrieved
`sourceUrl`; unsourced claims are dropped. Output is flagged `needsReview`.

- Retrieval backend: `lib/kb-retrieval.js` (`kbRetrieve`) grounds in the verified
  KB (enforcement + guidance with `sourceUrl`s). Override `opts.retrieve` for a
  web-search backend.
- LLM: `opts.complete` (defaults to the provider-agnostic `ai.llmComplete`).

### 2. Human-review gate
`lib/kb-review.js` · routes: `/api/memory/review*` (admin) · model: `KbReviewItem`

`enqueueFromStorm(topic)` runs STORM and queues its findings as **pending** —
they never reach the live KB unreviewed. An admin approves (→ ingest) or rejects.

- `GET /api/memory/review` — list pending
- `POST /api/memory/review/:id/approve` — ingest into the live KB
- `POST /api/memory/review/:id/reject` — discard (with a note)

### 3. Deep researcher — ingest + keep current
`lib/deep-researcher.js` · scheduler job: weekly `deep-research`

Normalizes, **dedupes**, and ingests findings into `EnforcementAction` /
`RegulatoryGuidance`, then recomputes clause risk signals when something new
lands. The data SOURCE is pluggable and defaults to a **no-op** — entries must
come from a verified feed or approved STORM findings, never raw hallucinations.

### 4. Risk signals → audit scoring
`lib/regulator-research.js` (`computeRiskSignals`, `enhanceAuditRisk`)

Turns recent enforcement/guidance into per-clause risk multipliers that elevate
scoring for clauses regulators are actively pursuing.

### 5. Memory loop — org learns from corrections
`lib/playbook.js` · routes: `/api/memory/overrides`, `/api/memory/playbook` ·
model: `AuditFindingOverride`

When a reviewer accepts/rejects/adjusts an AI finding, it's recorded and
aggregated per org into a **playbook** (per-clause tendency: stricter / lenient /
mixed). The audit worker loads the playbook and passes it as LLM context, so the
org's future audits reflect its standards.

## Data models & migrations

| Model | Migration | Purpose |
|-------|-----------|---------|
| `AuditFindingOverride` | `20260623214233_add_audit_finding_override` | memory loop |
| `KbReviewItem` | `20260623225250_add_kb_review_item` | review gate |

> Both are additive `CREATE TABLE`s, drift-verified. Apply with
> `prisma migrate deploy` (after baselining the prod DB — see the PR notes).

## Operate-it checklist

To turn the wired chain into a running system:

- [ ] **Apply the two migrations** to prod (baseline first if the DB was created
      with `db push`).
- [ ] **Configure an LLM** (`AI_PROVIDER` + key) — STORM and the audit extractor
      no-op without one.
- [ ] **Choose a STORM cadence & topics** — schedule `enqueueFromStorm(topic)`
      runs (e.g. per clause type, monthly). Today it is invoked on demand.
- [ ] **Staff the review queue** — assign an admin to clear
      `GET /api/memory/review`; nothing reaches the live KB until they approve.
- [ ] **(Optional) Wire a verified research source** for the deep researcher
      (`getResearchSource`) and/or a web-search `retrieve` backend for STORM.
      Until then the researcher's direct cycle is a no-op and STORM grounds on
      the existing KB.
- [ ] **Surface overrides in the UI** so reviewers record accept/reject/adjust
      (`POST /api/memory/overrides`) — that's what feeds the memory loop.
- [ ] **Build a small admin UI** for the review queue (list + approve/reject).
- [ ] **Monitor** the weekly `deep-research` job and `audit_queue_size` /
      `audit_job_duration` metrics.

## Safety properties (why this is defensible)

- **Sourced-only:** STORM drops findings without a `sourceUrl`.
- **Human-gated:** machine findings require admin approval before going live.
- **Deduped + normalized:** the researcher rejects duplicates and filters unknown
  clause keys before ingest.
- **Auditable:** approvals/rejections are written to the activity log
  (`kb.review.approve` / `kb.review.reject`).

## Testing

All stages have unit tests with injected LLM/data backends (no DB, no network):
`storm`, `kb-retrieval`, `deep-researcher`, `kb-review`, `playbook`, plus a
STORM→deep-researcher integration test. Run `cd server && npm test`.
