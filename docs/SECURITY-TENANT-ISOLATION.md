# Per-Tenant Data Isolation Audit

Scope: verify that no user/tenant can read or mutate another tenant's resources
via the API (IDOR / broken object-level authorization). Method: traced every
by-`id` database read/write in `server/routes/*` and checked each for an
ownership/org scope before the operation.

## Verdict

**No exploitable cross-tenant IDOR found.** The codebase consistently uses one
of two safe patterns before any by-id mutation, and registration cannot
self-escalate privileges. One defense-in-depth finding (implicit super-admin) is
documented below.

## Tenancy model

- Resources carry `userId` and (optionally) `orgId`.
- `lib/access.js` provides the canonical helpers: `buildUserOrgScope` (scopes a
  query by `OR: [{userId}, {orgId}]`), `requireScopedRecord`, and
  `requireAccessibleAudit`.
- Two safe patterns are used throughout:
  1. **Scoped fetch** — `findFirst({ where: { id, ...scope } })` then 404 if null.
  2. **Check-then-act** — `findUnique({ where: { id } })` then an explicit
     `record.userId === req.user.id` (or org) check before mutating.

## Per-resource verification

| Resource / route | By-id op | Guard | Result |
|------------------|----------|-------|--------|
| Audits (`audits.js`) | get/delete | `requireAccessibleAudit` (userId OR orgId) | ✅ scoped |
| Audit compare/export | findFirst | `{ id, userId }` | ✅ scoped |
| Licenses (`licenses.js`) | patch/delete | scoped `findFirst` (buildUserOrgScope) → 404 → write | ✅ scoped |
| Templates (`templates.js`) | delete | `findFirst({ id, userId })` → 404 → delete | ✅ scoped |
| Schedules (`schedules.js`) | delete | `findFirst({ id, userId })` → 404 → delete | ✅ scoped |
| Scoring rules (`scoring-rules.js`) | delete | `findFirst({ id, userId })` → 404 → delete | ✅ scoped |
| API keys (`api-keys.js`) | delete | `findFirst({ id, userId })` → 404 → delete | ✅ scoped |
| Shares (`shares.js`) | delete | `findUnique` + `share.audit.userId === req.user.id` | ✅ ownership-checked |
| Comments (`comments.js`) | put/delete | `comment.userId === req.user.id` (or admin); parent validated vs auditId | ✅ ownership-checked |
| Org member remove (`orgs.js`) | update | requireRole(admin) + `target.orgId === admin.orgId` | ✅ org-scoped |
| Admin user role/delete (`admin.js`) | update/delete | requireRole(admin) + `req.user.orgId && target.orgId !== req.user.orgId → 403` | ⚠️ see finding |

Registration (`auth.js`) creates users with **no role and no orgId**, falling to
the schema default `role = "auditor"`. New signups therefore cannot reach
`requireRole('admin')` routes — privilege escalation via self-registration is
not possible.

## Finding — implicit super-admin (defense-in-depth, Medium)

`admin.js` gates cross-org access with `if (req.user.orgId && target.orgId !==
req.user.orgId) return 403`. The guard is conditioned on the admin **having** an
`orgId`. An `admin` whose `orgId` is null is therefore treated as an
unrestricted platform super-admin (can list/modify/delete users in any org, and
`GET /users` returns all users via `whereClause = {}`).

- **Exploitable today?** No. Self-registration yields `auditor`/no-org. An
  admin+no-org user only arises by deliberate promotion, and removing a member
  from an org resets them to `auditor` (`orgs.js`). The super-admin path is
  reachable only by intentional manual setup.
- **Why it's still a risk:** authorization is *implicit* — "absence of orgId"
  silently means "global access." Any future path that produces an admin without
  an org (a seed script, SSO JIT provisioning, an org-deletion edge case) would
  silently grant platform-wide access with no explicit opt-in.
- **Recommendation:** make super-admin explicit — a dedicated `isSuperAdmin`
  boolean or a distinct `superadmin` role — instead of inferring it from a null
  `orgId`. Then org-admins with no org default to *no* cross-org access (fail
  closed). Not changed here because it is an auth-semantics decision on a live
  system; flagged for owner sign-off (auth/* and rbac are off-limits paths).

## Observation — userId-only scoping limits org collaboration (not a vuln)

Templates, schedules, scoring rules, and comment-creation scope by `userId`
only, not `orgId`. This is *more* restrictive than necessary (org members can't
collaborate on these), so it is a product/functionality gap, not a data leak.

## Regression coverage

`__tests__/integration/tenant-isolation.integration.test.js` encodes the
contract: a second tenant (B) is denied read, list, comment, and delete on
tenant A's audit (404/403), while the owner retains access. Runs in CI against
the ephemeral Postgres.
