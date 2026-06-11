# Release Process

How PolyMarket Social versions are tagged and changelogs generated.

---

## Phase-exit tags

Every phase ends with the orchestrator merging the epic into `main` and tagging.

| Tag | Phase | Description |
|---|---|---|
| `vMVP-phase0` | 0 — Foundations | Monorepo scaffolded, all agents' shells build, delivery docs in place |
| `vMVP-phase1` | 1 — Core feed + market | Feed read/write, market creation/resolution, wallet connect |
| `vMVP-phase2` | 2 — Social graph | Follow, notifications, activity feed |
| `vMVP-phase3` | 3 — Polish + hardening | Perf, security audit fixes, accessibility |
| `vMVP-1.0.0` | Final MVP | Production-ready; SemVer takes over from here |

Tags are **annotated** (not lightweight) so they carry a message:

```bash
git tag -a vMVP-phase0 -m "Phase 0 complete: monorepo + delivery foundations"
git push origin vMVP-phase0
```

---

## Tagging procedure (orchestrator only)

```bash
# 1. Ensure main is green in CI and all epic PRs are merged.
git checkout main
git pull origin main

# 2. Update CHANGELOG (see below).
# 3. Commit the changelog.
git add CHANGELOG.md
git commit -m "docs(delivery): update CHANGELOG for vMVP-phaseN"

# 4. Tag.
git tag -a vMVP-phaseN -m "Phase N complete: <one-line summary>"
git push origin main --tags
```

No agent performs these steps. Only the orchestrator does.

---

## Changelog generation

The changelog is derived from conventional commits between tags.

### Option A — conventional-changelog-cli

```bash
pnpm dlx conventional-changelog-cli \
  -p conventionalcommits \
  -i CHANGELOG.md \
  -s \
  -r 0
```

`-r 0` regenerates from all history. Use `-r 1` for incremental (append since last tag).

### Option B — git-cliff (preferred for monorepos)

Install once (or use via pnpm dlx):

```bash
pnpm add -D git-cliff          # or: pnpm dlx git-cliff ...
```

Run:

```bash
pnpm dlx git-cliff \
  --config cliff.toml \
  --tag vMVP-phaseN \
  -o CHANGELOG.md
```

A `cliff.toml` config is kept in the repo root (owned by git-engineer). It groups commits by
type (`feat`, `fix`, `chore`, etc.) and filters out `chore(deps)` bumps from the user-facing
sections.

### Changelog structure

```markdown
# Changelog

## [vMVP-phase1] — 2026-xx-xx
### Features
- feat(web): add FeedPage with infinite scroll (#42)
- feat(api): POST /posts endpoint with validation (#38)
- feat(contracts): JustifyMarket.sol — create and resolve (#35)

### Bug fixes
- fix(api): return 404 when post not found (#45)

### Breaking changes
- feat(shared)!: rename PostDTO.author to PostDTO.authorId (#40)

## [vMVP-phase0] — 2026-06-11
### Chores
- chore(infra): monorepo + Ganache docker-compose (#5)
- chore(delivery): CONTRIBUTING, branching model, PR templates (#4)
```

---

## SemVer after MVP

Once `vMVP-1.0.0` is tagged the project switches to standard SemVer:

- BREAKING CHANGE footer → **major** bump
- `feat:` → **minor** bump
- `fix:` / `chore:` / etc. → **patch** bump

Release PRs from this point follow the same epic/batch model but target a `release/x.y.z` branch
which is merge-committed into `main` and `develop` (if a develop branch exists).

---

## Hotfix procedure

For urgent fixes to a tagged release:

```bash
git checkout -b hotfix/<issue> vMVP-phaseN
# make fix, conventional-commit: fix(<scope>): ...
git push origin hotfix/<issue>
# open PR → main, get review
# after merge, tag patch: vMVP-phaseN-p1 (informal) or bump semver after 1.0
```
