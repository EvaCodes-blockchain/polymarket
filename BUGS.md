# Known Bugs & Issues — MVP

Lightweight bug log for the `mvp` branch. One entry per issue. Newest first.
For workflow on filing/closing, see `docs/delivery/branching.md`. GitHub Issue
templates live in `.github/ISSUE_TEMPLATE/`.

Status legend: 🔴 open · 🟡 mitigated (workaround in place) · ✅ fixed

---

## BUG-002 — Browser bundle ships stale contract addresses (address drift)

- **Status:** 🟡 mitigated (host-side patch; proper fix not done)
- **Severity:** high — blocks CEO-3/CEO-4 (MetaMask connect + Buy) without manual steps
- **Area:** `web` (frontend), DevOps
- **Affects:** `web/src/lib/client/contracts.ts`

**Symptom.** The wallet Buy flow in the browser talks to the wrong AMM/contract
addresses after a redeploy, so CEO-4 (place a real Buy bet) fails.

**Root cause.** Contract addresses for the client-side wallet flow are
hard-coded in `web/src/lib/client/contracts.ts` and baked into the Next.js
browser bundle at **build time**. The compose-Ganache deployment derives
different deterministic addresses than the bundle was built with, so they drift.
(Server-side chain access is already fixed — `web` mounts the shared
`contracts-deployments` volume and reads addresses via `DEPLOYMENTS_FILE`, so
markets/prices/faucet/seeds use the live artifact. The remaining drift is the
**browser bundle** only.)

**Workaround.** After deploy, copy the real `ganache.json` into the repo and
rebuild the `web` image so addresses are re-baked into the bundle (see
`DeployRunbook.md` §2.5). Must be repeated after any `git reset --hard`.

**Proper fix (tracked, not done).** Make the client module fetch contract
addresses at **runtime** (from the server / the deployments artifact) instead of
hard-coding them at build time. Then drift disappears entirely.

---

## BUG-001 — Auto-deploy silently skipped test-data steps (✅ fixed)

- **Status:** ✅ fixed
- **Severity:** high — `/markets` rendered empty; CI reported success (false green)
- **Area:** DevOps / CI
- **Affects:** `.github/workflows/deploy-dev.yml`
- **Fixed by:** `fc4adc4` (partial), `ce88347` (root cause)

**Symptom.** After auto-deploy the site showed no markets: `/api/markets` and
`/api/posts` returned `[]`, the DB had only 2 users and **no bot users**, and the
`market-generator` had no logs — yet the `Deploy Dev` workflow was green.

**Root cause.** The entire deploy script was piped to `bash -s` over SSH via a
heredoc, so the script body lived on **stdin**. The first `docker compose run`
without `-T` (`contracts-deploy`) opened an interactive stdin and consumed the
rest of the script from that same stream — restart web, `reconcile-markets.ts`,
`seed.ts`, `seed-users.ts`, and the `market-generator` cycle never ran. Bash
reached EOF and exited `0`, so CI went green having only deployed contracts.

**Why the first fix wasn't enough.** Adding `-T` to the `contracts-deploy` run
(`fc4adc4`) got reconcile + seeds running again, but the cutoff just moved to the
next stdin-reading command — the generator step still didn't run. Patching one
call at a time only shifts the cutoff.

**Fix (`ce88347`).** Stop piping the script over stdin. Ship it to the host as a
file (`ssh 'cat > /tmp/deploy-dev.sh'`) and execute it with stdin detached
(`ssh 'bash /tmp/deploy-dev.sh' </dev/null`). The body is no longer on stdin, so
nothing can swallow it.

**Verification.** CI run `27393445635` (completed/success) ran the full chain:
contracts-deploy → reconcile → seeds (founder + demo users + bots) →
market-generator cycle (created markets #13–#24). `/api/markets` returned 25
markets (1 seed + 24 generated) with live AMM prices.

**Lesson / guard.** Never run a multi-step deploy script via `bash -s` + heredoc
when it contains `docker compose run`/`exec` (or anything that reads stdin). Put
the script in a file and run it with `</dev/null`.
