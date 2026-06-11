# Branching & Batch Model

Detailed reference for the PolyMarket Social delivery model. See `CONTRIBUTING.md` for the
hands-on how-to; this doc covers the rationale and walks through a concrete worked example.

---

## Branch hierarchy

```
main
 │   (protected; never pushed to directly)
 │
 ├── epic/phase0-foundations
 │    ├── feat/phase0-foundations/monorepo-root        (devops-qa)
 │    ├── feat/phase0-foundations/ganache-infra         (devops-qa)
 │    ├── feat/phase0-foundations/web-scaffold          (frontend-dev)
 │    ├── feat/phase0-foundations/api-scaffold          (backend-dev)
 │    ├── feat/phase0-foundations/contracts-scaffold    (contracts-dev)
 │    └── feat/phase0-foundations/delivery-docs         (git-engineer)
 │
 ├── epic/phase1-feed-market
 │    ├── feat/phase1-feed-market/shared-dtos           (devops-qa)   ← contract PR
 │    ├── feat/phase1-feed-market/api-posts             (backend-dev)
 │    ├── feat/phase1-feed-market/web-feed              (frontend-dev)
 │    └── feat/phase1-feed-market/market-contract       (contracts-dev)
 │
 └── ...
```

### Why agents branch off epics, not main

- `main` is always deployable. An in-progress feature breaks that invariant.
- Epics act as a long-lived integration branch: agents can merge small PRs into the epic
  continuously and run cross-workstream integration tests before anything touches `main`.
- Epics map to phases / major feature areas — they have a natural lifecycle (open at phase start,
  merge at phase close) that gives the orchestrator a clear gate.

---

## Batch definition

A **batch** is the smallest unit of demoable, CI-green progress on an epic.

Batches are declared by the orchestrator. Each batch has:
- A **name** (e.g. "feed read-path")
- A **list of PRs** (one per workstream that participates)
- An **integration-contract PR** if any shared types or ABIs change (always first)
- A **done condition**: all batch PRs merged into the epic, CI green, feature demoable end-to-end

Batches within an epic are numbered sequentially: batch-1, batch-2, …

---

## Worked example: "feed read-path" batch

**Context:** Phase 1. We want to display a paginated list of open markets as posts in a feed.
Three workstreams participate; shared types must exist before consumers implement.

### Step 1 — Orchestrator announces the batch

```
Batch: phase1-feed-market / batch-1 / feed-read-path

Components:
  A. feat/phase1-feed-market/shared-dtos       (devops-qa)
     Adds PostDTO, FeedPageDTO, MarketSummaryDTO to packages/shared

  B. feat/phase1-feed-market/api-posts-read    (backend-dev)
     Implements GET /posts/:id and GET /feed (paginated)

  C. feat/phase1-feed-market/web-feed-ui       (frontend-dev)
     Implements FeedPage and PostCard components

Order: A must merge before B and C open (integration-contract rule).
B and C may be developed in parallel; they open PRs once A merges.
```

### Step 2 — devops-qa opens PR A

Branch `feat/phase1-feed-market/shared-dtos` off `epic/phase1-feed-market`.

```typescript
// packages/shared/src/post.dto.ts  (new file, owned by devops-qa)
export interface PostDTO {
  id: string;
  authorId: string;
  marketId: string;
  body: string;
  createdAt: string; // ISO-8601
}

export interface FeedPageDTO {
  posts: PostDTO[];
  nextCursor: string | null;
}
```

PR title: `feat(shared): add PostDTO, FeedPageDTO, MarketSummaryDTO`

Orchestrator reviews and merges (squash) into `epic/phase1-feed-market`.

### Step 3 — backend-dev and frontend-dev rebase and open PRs B & C

Both rebase their branches onto the updated epic:

```bash
git fetch origin
git rebase origin/epic/phase1-feed-market
```

PR B imports `PostDTO` from `packages/shared` — no local type definitions.
PR C imports `FeedPageDTO` from `packages/shared` — same contract.

### Step 4 — Batch closes

Both PRs pass CI. Orchestrator squash-merges B and C into the epic.
Epic branch is green. Batch 1 is done.

### Step 5 — Phase close (when all batches done)

Orchestrator merges epic into `main` with a merge commit and tags `vMVP-phase1`.

---

## Branch lifecycle summary

| State | Action | Who |
|---|---|---|
| Phase starts | `git checkout -b epic/<name> main` | orchestrator |
| Agent starts work | `git checkout -b feat/<epic>/<scope> epic/<name>` | agent |
| Agent done | Opens PR → epic/<name> | agent |
| PR approved | Squash-merge into epic | orchestrator / reviewer |
| All batch PRs in | Declare batch done, optionally tag `batch/<epic>/<n>` | orchestrator |
| All batches in epic done | Merge epic into main with merge commit, tag phase | orchestrator |

---

## Naming conventions quick-reference

```
epic/<name>                      main integration branch for a phase/feature
feat/<epic>/<scope>              new feature workstream
fix/<epic>/<scope>               bug fix within an epic
chore/<epic>/<scope>             tooling / infra / config within an epic
refactor/<epic>/<scope>          refactor (no behaviour change)
```

`<scope>` should be a short kebab-case description (2–4 words max), e.g.:
- `web-scaffold`, `ganache-infra`, `shared-dtos`, `market-contract`

---

## Conflict resolution

Cross-workstream conflicts are rare when file ownership is respected. If they occur:

1. The agent whose PR was opened second rebases onto the updated epic.
2. If the conflict is in a file the agent does not own (should not happen), escalate to the
   orchestrator immediately — do not resolve cross-boundary conflicts yourself.
3. If the conflict is in a shared file (`packages/shared`, `packages/contracts`), the orchestrator
   mediates a new integration-contract PR that resolves the conflict, and both consumers rebase.
