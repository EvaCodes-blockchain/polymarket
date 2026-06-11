## Summary

<!-- One sentence: what does this PR do? -->

## Scope & ownership

- **Target branch:** `mvp`
- **Workstream branch:** `feat/mvp/` or `fix/mvp/` <!-- full branch name -->
- **Owner:** <!-- your agent role: frontend-engineer | backend-engineer | contracts-engineer | devops-engineer | documentation-engineer -->
- **Files changed are within my ownership boundary:** [ ] yes

> If you changed files outside your CODEOWNERS boundary, stop and coordinate with the orchestrator.

## Checklist

- [ ] PR title is a valid conventional commit: `type(scope): description`
  - Allowed types: `feat` `fix` `chore` `docs` `refactor` `test` `ci` `perf` `revert`
  - Allowed scopes: `web` `api` `contracts` `infra` `e2e` `docs` `delivery` `deps`
- [ ] Branch is based on `mvp`, not `main`
- [ ] All changed files are within my CODEOWNERS ownership boundary
- [ ] CI passes (lint, typecheck, tests, build)
- [ ] No secrets, env values, or hard-coded ports committed (use `.env.example`)
- [ ] TypeScript strict — no `any` in committed code
- [ ] PR is small and focused on one concern

## Integration-contract changes

- [ ] This PR changes an API route shape, the Prisma schema, a contract ABI, or `contracts/deployments/*`

If checked: describe the change and confirm consumer workstreams have been notified via the
orchestrator before this PR was opened.

<!-- What changed in the shared interface / ABI? -->
<!-- BREAKING CHANGE? (rename, removal, type narrowing) — if so, add BREAKING CHANGE footer to commit -->

## Testing

<!-- How was this change tested? Unit tests? Manual smoke test? E2e? -->

## Related issues / PRs

<!-- Closes #<issue> | Depends on #<pr> -->
