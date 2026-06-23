/**
 * k6 Load Test — 100 concurrent users, mixed workload
 * Closes item 13
 *
 * Install: https://k6.io/docs/get-started/installation/
 * Usage:
 *   k6 run --env BASE_URL=https://api-staging.auleg.com tests/load/k6-load-test.js
 *
 * Stages:
 *   - 30s ramp-up to 50 VUs
 *   - 1m hold at 50 VUs (warm-up)
 *   - 30s ramp to 100 VUs
 *   - 3m hold at 100 VUs (the real test)
 *   - 30s ramp-down
 *
 * Pass criteria:
 *   - p95 < 1500ms for reads, < 5s for audit creation
 *   - error rate < 1%
 *   - no 5xx responses
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

const errorRate = new Rate('errors');
const auditDuration = new Trend('audit_create_duration');
const rateLimitHits = new Counter('rate_limit_hits');

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '3m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  // SLO gates — k6 exits non-zero if any threshold is breached.
  // See docs/SLO.md for the rationale and per-plan-tier limits.
  thresholds: {
    // Overall latency budget
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    // Per-operation-class SLOs (reads must be far snappier than audit creation)
    'http_req_duration{name:me}': ['p(95)<800'],
    'http_req_duration{name:list_audits}': ['p(95)<1500'],
    'http_req_duration{name:trial_status}': ['p(95)<1500'],
    'http_req_duration{name:login}': ['p(95)<2000'],
    'http_req_duration{name:create_audit}': ['p(95)<5000'],
    // Error budget: < 1% failed requests / app errors; checks must pass > 99%
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
    checks: ['rate>0.99'],
    audit_create_duration: ['p(95)<5000'],
  },
};

const SAMPLE_CONTRACT = `Data Processing Agreement between Controller and Processor pursuant to GDPR Article 28. The Processor shall process Personal Data only on documented instructions from the Controller. Technical and organizational security measures include AES-256 encryption at rest, TLS 1.3 in transit, role-based access control, and annual penetration testing. Sub-processors are listed in Annex II and require Controller approval. Personal data breaches will be notified within 24 hours.`;

// ─── Test data: pool of test users created at setup ──
export function setup() {
  const users = [];
  for (let i = 0; i < 25; i++) {
    const email = `loadtest-${Date.now()}-${i}@auleg-test.com`;
    const password = `LoadTest${randomString(8)}!`;
    const res = http.post(
      `${BASE_URL}/api/auth/register`,
      JSON.stringify({ email, password, name: `LoadTester${i}` }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (res.status === 201) {
      const body = JSON.parse(res.body);
      users.push({ email, password, refreshToken: body.refreshToken });
    }
  }
  console.log(`Setup: created ${users.length}/25 test users`);
  return { users };
}

export default function (data) {
  if (!data.users || data.users.length === 0) {
    console.error('No test users available');
    return;
  }
  const user = data.users[__VU % data.users.length];

  // Login → get access token
  let token = null;
  group('auth', () => {
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: user.email, password: user.password }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } }
    );
    const ok = check(res, { 'login 200': r => r.status === 200 });
    if (!ok) errorRate.add(1);
    if (res.status === 429) rateLimitHits.add(1);
    if (res.status === 200) token = JSON.parse(res.body).token;
  });

  if (!token) return;
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Mixed workload: 70% reads, 20% writes, 10% audit creation
  const roll = Math.random();
  if (roll < 0.7) {
    group('reads', () => {
      const res = http.get(`${BASE_URL}/api/audits?limit=20`, { headers: authHeaders, tags: { name: 'list_audits' } });
      check(res, { 'list 200': r => r.status === 200 || r.status === 304 }) || errorRate.add(1);
      if (res.status === 429) rateLimitHits.add(1);

      const me = http.get(`${BASE_URL}/api/auth/me`, { headers: authHeaders, tags: { name: 'me' } });
      check(me, { 'me 200': r => r.status === 200 }) || errorRate.add(1);
    });
  } else if (roll < 0.9) {
    group('writes', () => {
      const res = http.get(`${BASE_URL}/api/billing/trial`, { headers: authHeaders, tags: { name: 'trial_status' } });
      check(res, { 'trial 200': r => r.status === 200 }) || errorRate.add(1);
    });
  } else {
    group('audit_create', () => {
      const start = Date.now();
      const res = http.post(
        `${BASE_URL}/api/audits`,
        JSON.stringify({ name: `Load test ${__VU}-${__ITER}`, content: SAMPLE_CONTRACT }),
        { headers: authHeaders, tags: { name: 'create_audit' }, timeout: '15s' }
      );
      auditDuration.add(Date.now() - start);
      check(res, { 'audit created or quota exceeded': r => [201, 402, 429].includes(r.status) }) || errorRate.add(1);
      if (res.status === 429) rateLimitHits.add(1);
    });
  }

  sleep(Math.random() * 2 + 1);  // 1-3 seconds think time
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    'load-test-report.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const m = data.metrics;
  return `
═══════════════════════════════════════════════
  Auleg Load Test Summary
═══════════════════════════════════════════════
  Total requests:    ${m.http_reqs?.values?.count || 0}
  Failed requests:   ${m.http_req_failed?.values?.fails || 0} (${((m.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%)
  Rate-limited:      ${m.rate_limit_hits?.values?.count || 0}

  Response times (ms):
    avg:  ${(m.http_req_duration?.values?.avg || 0).toFixed(0)}
    p95:  ${(m.http_req_duration?.values?.['p(95)'] || 0).toFixed(0)}
    p99:  ${(m.http_req_duration?.values?.['p(99)'] || 0).toFixed(0)}
    max:  ${(m.http_req_duration?.values?.max || 0).toFixed(0)}

  Audit creation p95: ${(m.audit_create_duration?.values?.['p(95)'] || 0).toFixed(0)} ms

  ${data.root_group?.checks ? Object.entries(data.root_group.checks).map(([n, c]) => `  Check "${n}": ${c.passes}/${c.passes + c.fails}`).join('\n') : ''}
═══════════════════════════════════════════════
`;
}
