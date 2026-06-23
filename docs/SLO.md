# Service Level Objectives (SLOs)

Performance and reliability targets for the Auleg API, the load-test gates that
enforce them, and the per-plan-tier limits that bound capacity.

## Latency SLOs (p95, steady state)

Measured at 100 concurrent users under the mixed workload in
`tests/load/k6-load-test.js`. Each is a hard k6 threshold — the load test fails
if breached.

| Operation class | Endpoint(s) | p95 target | p99 target |
|-----------------|-------------|-----------:|-----------:|
| Lightweight read | `GET /api/auth/me` | 800 ms | — |
| List read | `GET /api/audits` | 1500 ms | — |
| Status read | `GET /api/billing/trial` | 1500 ms | — |
| Auth | `POST /api/auth/login` | 2000 ms | — |
| Audit creation (enqueue) | `POST /api/audits` | 5000 ms | — |
| **All requests (aggregate)** | — | **3000 ms** | **5000 ms** |

> Audit *processing* is asynchronous (BullMQ). The 5 s budget covers
> enqueue/acknowledgement (HTTP), not end-to-end analysis. Analysis latency is
> tracked separately via the `audit_job_duration` Prometheus metric.

## Reliability SLOs

| Metric | Target | k6 gate |
|--------|--------|---------|
| Failed HTTP requests | < 1% | `http_req_failed: rate<0.01` |
| Application errors | < 1% | `errors: rate<0.01` |
| Functional checks passing | > 99% | `checks: rate>0.99` |
| 5xx responses | 0 sustained | error-budget burn alert |

**Error budget:** 1% over a rolling 30 days (~7h17m/month of degraded service).

## Throughput & capacity — per plan tier

API and audit throughput are bounded by per-tenant rate limits
(`server/middleware/tenant-rate-limit.js`), keyed by `orgId`.

| Plan | API requests / 15 min | Audit submissions / hour |
|------|----------------------:|-------------------------:|
| free | 100 | 10 |
| starter | 500 | 50 |
| pro | 1,500 | 200 |
| business | 5,000 | 1,000 |
| enterprise | 20,000 | 5,000 |

Over-limit requests receive `429` with a `Retry-After` header; audit submissions
over the hourly cap receive `429` with an upgrade hint. Plan is resolved from
the org's billing account and cached for 5 minutes.

## Audit worker concurrency

Async audit analysis runs on BullMQ workers (`server/lib/audit-worker.js`):

- **Per-worker concurrency:** `AUDIT_WORKER_CONCURRENCY` (default **2**).
- **Global rate limiter:** max **10 jobs/minute** per worker.
- Horizontal scaling: run more worker instances (cluster mode forks
  `CLUSTER_WORKERS`); BullMQ distributes jobs across them.

**Capacity guidance:** size total concurrency to the busiest tier's audit cap.
Enterprise allows 5,000 audits/hour ≈ 83/min; at ~10 jobs/min/worker that is
~8–9 worker slots. Tune `AUDIT_WORKER_CONCURRENCY` × instance count and the
per-worker `limiter.max` together, and watch `audit_queue_size` /
`audit_job_duration` to keep queue wait within the analysis SLO.

> **Recommended follow-up:** make worker concurrency / job-rate *plan-aware*
> (e.g. a priority lane for higher tiers) so a free-tier burst can't starve
> enterprise jobs. Today concurrency is global; fairness relies on the per-tenant
> submission rate limits above.

## Running the load test

```bash
# Staging only — never production. On-demand via the load-test-staging workflow,
# or locally against a staging URL:
k6 run --env BASE_URL=https://api-staging.auleg.com tests/load/k6-load-test.js
```

The run exits non-zero if any SLO threshold is breached, producing
`load-test-report.json` (uploaded as a CI artifact). Treat a red run as an SLO
regression, not a flake — investigate before release.
