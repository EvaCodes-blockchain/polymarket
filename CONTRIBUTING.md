# Contributing to PolyMarket Social ("Justify")

Single source of truth for how work flows through git on this project.
Read this before opening a branch or PR.

---

## Table of contents

1. [Branching model](#1-branching-model)
2. [Batches](#2-batches)
3. [Conventional commits](#3-conventional-commits)
4. [Commit template setup](#4-commit-template-setup)
5. [Local commit-msg hook (husky)](#5-local-commit-msg-hook-husky)
6. [PR rules](#6-pr-rules)
7. [Integration-contract changes](#7-integration-contract-changes)
8. [Squash & epic merge](#8-squash--epic-merge)
9. [Phase-exit tags & changelog](#9-phase-exit-tags--changelog)

---

## 1. Branching model

```
main  (always releasable, protected)
 └── mvp                   long-lived integration branch for the CEO MVP scope
      └── feat/mvp/<scope>-<topic>   per-agent workstream branch
      └── fix/mvp/<scope>-<topic>    bug fix within the MVP
      └── chore/mvp/<scope>-<topic>  infra / tooling within the MVP
```

**Rules:**

- Agents branch off `mvp`, **never directly off `main`**.
- `main` is **never** updated by this team — `mvp` is the terminal delivery branch (see §8).
- Force-push is disabled on `main` and `mvp`. Rebase your workstream branch locally before
  opening a PR; never rebase a shared branch.
- Branch names must follow the pattern above — the PR template enforces this by convention and
  CODEOWNERS routes review accordingly.

**Naming examples:**

| Branch | Purpose |
|---|---|
| `mvp` | MVP integration branch (all batches land here) |
| `feat/mvp/web-signin-modal` | frontend-engineer's sign-in modal |
| `feat/mvp/contracts-market-amm` | contracts-engineer's AMM |
| `fix/mvp/api-follow-count` | backend-engineer bug fix |

---

## 2. Batches

A **batch** is a coherent, independently-shippable set of PRs that land into the `mvp` branch
together and leave it green in CI and demoable.

**Lifecycle of a batch:**

1. Orchestrator announces the batch and its component PRs (one per workstream).
2. **Integration-contract PRs land first** — API route shapes / Prisma schema (`web/prisma`,
   `web/src/app/api`) and contract ABIs + deployed addresses (`contracts/deployments`) get their
   own small PRs merged before any consumer PR opens. This gives consumers a stable base to
   import from. See §7.
3. Consumer PRs (frontend, backend, etc.) are opened once the contract PR is merged and the `mvp`
   branch is updated.
4. All batch PRs pass CI. The orchestrator declares the batch done.
5. The `mvp` branch is tagged informally (e.g. `batch/mvp/<n>`) for rollback reference if needed.

**Example — "follow flow" batch (CEO-2):**

```
Batch PRs (in order):
  1. feat/mvp/api-follow         (backend-engineer)  — Prisma Follow model, POST/DELETE /api/social/follow
  2. feat/mvp/web-profile-follow (frontend-engineer) — profile header, Follow/Following toggle
```
PR 1 merges first. PR 2 is opened once PR 1 lands; it consumes the announced API shape and does
not redefine it.

---

## 3. Conventional commits

Commit messages **must** follow [Conventional Commits v1.0](https://www.conventionalcommits.org/).

```
<type>(<scope>): <short description>

[optional body]

[optional footer: BREAKING CHANGE: ..., Closes #<issue>]
```

**Types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`, `revert`

**Allowed scopes** (enforced by commitlint):

| Scope | Owned by |
|---|---|
| `web` | frontend-engineer |
| `api` | backend-engineer |
| `contracts` | contracts-engineer |
| `infra` | devops-engineer |
| `e2e` | devops-engineer |
| `docs` | documentation-engineer |
| `delivery` | devops-engineer |
| `deps` | any (dependency bumps) |

**Examples:**

```
feat(web): add sign-in modal wired to NextAuth
fix(api): return 404 when profile not found
chore(infra): add web service to docker-compose
docs(delivery): add batch lifecycle to CONTRIBUTING
feat(contracts)!: rename MarketAMM.buy to buyOutcome

BREAKING CHANGE: consumers must update all MarketAMM.buy call sites to buyOutcome
```

A `BREAKING CHANGE` footer (or `!` after the scope) triggers a minor version bump in the
changelog and **requires** a note in the PR description's "Integration-contract changes" section.

---

## 4. Commit template setup

A `.gitmessage` template is included in the repo root. Wire it up locally:

```bash
git config commit.template .gitmessage
```

Run this once per local clone. It pre-fills the commit editor with the type/scope structure and
reminds you of the allowed scopes.

---

## 5. Local commit-msg hook (husky)

commitlint catches malformed messages before they reach CI. devops-engineer installs husky in the root
`package.json`; once that is done, each developer runs:

```bash
# one-time per clone, after pnpm install:
pnpm exec husky install
```

If husky is not yet installed, validate manually:

```bash
echo "feat(web): test message" | pnpm exec commitlint
```

**Husky wiring steps for devops-engineer** (see orchestrator handoff note):

1. Add `husky` to root `devDependencies` and `"prepare": "husky install"` to root `package.json`.
2. Create `.husky/commit-msg` with content:
   ```sh
   #!/usr/bin/env sh
   . "$(dirname -- "$0")/_/husky.sh"
   npx --no -- commitlint --edit "$1"
   ```
3. Make it executable: `chmod +x .husky/commit-msg`
4. Commit the `.husky/` directory.

Developers do not need to do anything beyond `pnpm install` (the `prepare` script runs
`husky install` automatically).

---

## 6. PR rules

- **Small and focused:** one workstream, one concern. A PR that touches files across ownership
  boundaries will be rejected unless it is an explicitly approved integration-contract PR.
- **Single owner:** the PR author owns all changed files per CODEOWNERS. If you need changes in
  another owner's path, open a separate PR and coordinate through the orchestrator.
- **Title = commit message:** the squash-merge commit title is taken from the PR title. It must
  be a valid conventional commit (`feat(web): ...`).
- **Checklist:** fill out every item in the PR template before requesting review.
- **No direct push to `main`:** all changes arrive via PR. `main` only advances on epic merges.
- **No force-push on shared branches:** `epic/*` and `main` are protected.

---

## 7. Integration-contract changes

Any change to an API route shape, the Prisma schema (`web/prisma/schema.prisma`), a Solidity
ABI, or the deployed-address artifact (`contracts/deployments/ganache.json`) is an
**integration-contract change**.

Rules:
1. Open a dedicated PR for the contract change alone — do not bundle it with consumer changes.
2. Mark the PR description's "Integration-contract changes" checkbox.
3. Notify the orchestrator before merging; the orchestrator gates consumer PRs until this lands.
4. If the change is breaking (rename, removal, type narrowing), include a `BREAKING CHANGE:` footer
   in the commit and a migration note in the PR body.
5. Consumer workstreams rebase onto the `mvp` branch after the contract PR merges.

---

## 8. Squash & epic merge

**Workstream PR → `mvp` branch:** squash-merge. One clean commit per PR on the `mvp` branch.
The squash commit title must be the PR's conventional-commit title.

**`mvp` is the terminal branch for MVP work — it is NEVER merged into `main`.**
All delivery happens on `mvp`; `main` belongs to the upstream project and is not touched
by this team. At MVP completion the orchestrator tags the `mvp` branch:

```bash
# orchestrator performs this at MVP completion (on the mvp branch):
git tag vMVP-1.0.0 mvp
git push origin vMVP-1.0.0
```

No one — agent or orchestrator — pushes to `main` or merges `mvp` into `main`.

---

## 9. Phase-exit tags & changelog

At each milestone the orchestrator tags the `mvp` branch:

| Tag | Meaning |
|---|---|
| `mvp-phase0` | Foundations complete (workspaces, scaffolds, contracts deployed to Ganache) |
| `mvp-ceo1` … `mvp-ceo4` | Each CEO flow demoable end-to-end |
| `vMVP-1.0.0` | All four CEO flows green — MVP complete on the `mvp` branch |

**Generating the changelog:**

```bash
# requires conventional-changelog-cli installed globally or via pnpm dlx:
pnpm dlx conventional-changelog-cli -p conventionalcommits -i CHANGELOG.md -s -r 0
```

Or using git-cliff (preferred for monorepos):

```bash
pnpm dlx git-cliff --config cliff.toml -o CHANGELOG.md
```

The changelog is committed by the orchestrator as `docs(delivery): update CHANGELOG for vMVP-phaseN`
immediately before the phase tag.
