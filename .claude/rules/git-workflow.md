# Git Workflow — auleg

## Branch Rules
- Never commit directly to `main`.
- Branch naming: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `refactor/<slug>`.
- All iterative work on a branch; human reviews before merge.

## Commit Convention
```
type(scope): short description

Types: feat, fix, chore, refactor, test, docs, perf
Examples:
  feat(audit): add GDPR Article 28 clause extractor
  fix(auth): handle SAML assertion timeout
  chore(prisma): add index on audit_reports.created_at
```
- One logical unit per commit.
- Always pass verify gate before committing.

## Pre-Approved Safe Commands
```bash
cd server && npm test
cd server && npm run test:coverage
cd server && npm run db:generate
npx playwright test e2e/critical-path.spec.js
git status / git diff / git log
```

## Commands Requiring Human Approval
```bash
cd server && npm run db:migrate:dev  # dev migration — confirm schema change
cd server && npm run db:migrate      # PROD migration — always human-approved
cd server && npm run db:seed         # modifies data — confirm env
npx playwright test                  # full E2E — confirm server is running
git push --force                     # NEVER
git push origin main                 # NEVER without PR + review
```

## Guardrails
- `db:migrate` (deploy) is never run autonomously against any shared environment.
- No force-push to any shared branch.
- No merging to `main` without passing verify gate + human review.
