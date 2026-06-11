# Branch Protection Rules

Documented policy for `main` and `mvp` branches.
These rules must be configured in GitHub → Settings → Branches by a repo admin.

---

## `main`

| Rule | Setting |
|---|---|
| Require pull request before merging | **Yes** |
| Required approvals | **1** (from CODEOWNERS) |
| Require review from CODEOWNERS | **Yes** |
| Dismiss stale reviews on new commits | **Yes** |
| Require status checks to pass | **Yes** (see required checks below) |
| Require branches to be up to date | **Yes** |
| Require conversation resolution | **Yes** |
| Restrict who can push | **No one** (only merge via PR) |
| Allow force pushes | **No** |
| Allow deletions | **No** |

**Required status checks for `main`:**

- `lint` (pnpm lint)
- `typecheck` (pnpm typecheck)
- `test` (pnpm test)
- `build` (pnpm build)
- `commitlint` (PR title checked by CI)

These check names must match what devops-engineer configures in `.github/workflows/`.

---

## `mvp`

| Rule | Setting |
|---|---|
| Require pull request before merging | **Yes** |
| Required approvals | **1** (from CODEOWNERS) |
| Require review from CODEOWNERS | **Yes** |
| Dismiss stale reviews on new commits | **Yes** |
| Require status checks to pass | **Yes** (same set as main) |
| Require branches to be up to date | **Yes** |
| Require conversation resolution | **Yes** |
| Restrict who can push | **No one** (only merge via PR) |
| Allow force pushes | **No** |
| Allow deletions | **No** (`mvp` is the terminal delivery branch — never merged to main, never deleted) |

---

## Rationale

**No direct push to `main`:** `main` is always releasable. Any commit that lands there has been
reviewed, passed CI, and merged via PR. This is a hard invariant.

**No force-push on shared branches:** Force-pushing rewrites history that other agents may have
based work on. If you need to fix a commit, open a follow-up PR.

**CODEOWNERS review required:** Routes reviews to the right person automatically. An agent should
not approve their own PR; the orchestrator or CODEOWNERS reviewer approves.

**Branches must be up to date:** Prevents "merge now, break later" — your branch must include the
latest mvp changes before merging. Use `git rebase origin/mvp` before requesting review.

---

## Configuring via GitHub CLI

```bash
# Protect main:
gh api repos/EvaCodes-blockchain/polymarket/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["lint","typecheck","test","build"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"require_code_owner_reviews":true,"dismiss_stale_reviews":true}' \
  --field restrictions=null \
  --field allow_force_pushes=false \
  --field allow_deletions=false

# Note: mvp is a single branch — protection can be set directly via API or
# use the UI: Settings → Branches → Add rule → Branch name pattern: mvp
```

---

## MVP branch lifecycle

The mvp branch is created by the orchestrator at phase start and deleted after the mvp branch merges
into `main`. Deletion is allowed on `mvp` (see table above) to keep the branch list clean.

Agents should not delete the mvp branch themselves.
