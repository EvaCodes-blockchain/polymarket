# Deploy Runbook — Dev Environment (VPS)

Operational record of the **first manual deploy** of the Justify MVP to the Dev VPS,
plus a hand-off section for the DevOps engineer who takes over the environment:
what is already done, what must be unblocked in AWS, and what should be hardened next.

> Companion documents: [`README.md`](README.md) §5 (deploy checklist, design rationale)
> and `.github/workflows/` (CI; a CD workflow `deploy-dev.yml` triggered by push to
> `mvp` is being added in a separate PR).

---

## 1. Environment

| Item | Value |
|---|---|
| Provider | AWS EC2 |
| Public IP | `13.219.132.201` |
| OS | Ubuntu 26.04 LTS |
| Resources | 2 vCPU · 3.7 GB RAM · ~45 GB free disk |
| SSH | `ssh -i <keypair.pem> ubuntu@13.219.132.201` (key must be `chmod 600`) |
| Access level | `ubuntu` user with full sudo (treat as root — be careful) |
| App directory | `~/polymarket` (git clone, branch `mvp`) |
| Pre-existing services | **nginx active on :80 — not ours, do not touch.** |

The deployed stack (all via `docker-compose.yaml`):

| Service | Container port → host | Purpose |
|---|---|---|
| `web` | 3000 → 3000 | Next.js production build (UI + API) |
| `ganache` | 8545 → 8545 | Local EVM chain, ID 1337, deterministic mnemonic |
| `postgres` | 5432 → 5432 | App database (named volume `postgres-data`) |
| `prototype` | 80 → 3001 | Static HTML prototype (visual reference) |

---

## 2. What the first manual deploy did (2026-06-11)

Performed over SSH by the delivery orchestrator. Every step below is idempotent or
guarded — safe to re-run.

### 2.1 Host preparation

```bash
# Docker + compose v2 (Ubuntu packages; Docker 29.x is fine)
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 git curl
sudo usermod -aG docker ubuntu
sudo systemctl enable --now docker

# 4 GB swap — 3.7 GB RAM is not enough for `next build` inside Docker
if [ "$(swapon --show --noheadings | wc -l)" = "0" ]; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
fi
```

### 2.2 Code & secrets

```bash
cd ~/polymarket
git fetch origin
git checkout mvp && git reset --hard origin/mvp

# Runtime secrets — host-only, never committed
cat > .env <<EOF
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXTAUTH_URL=http://13.219.132.201:3000
EOF
chmod 600 .env
```

`NEXTAUTH_URL` **must** equal the URL the reviewer types into the browser, or
NextAuth callbacks/CSRF checks fail.

### 2.3 Browser-facing RPC URL (build-time!)

`NEXT_PUBLIC_RPC_URL` is baked into the **browser** bundle when the `web` image is
built. The browser — not the server — talks to Ganache, so it must point at the
public address:

```
NEXT_PUBLIC_RPC_URL=http://13.219.132.201:8545
```

On the first deploy this was patched by `sed` directly into `web/Dockerfile` and
`docker-compose.yaml` **on the host** (uncommitted local change). A PR
(`chore/mvp/deploy-dev`) converts these hardcoded `ENV`s into `ARG`s with localhost
defaults; once merged, set the value via build args / `.env` instead of patching files.
Until then: after any `git reset --hard`, re-apply the patch before rebuilding.

### 2.4 Bring up the stack & deploy contracts

```bash
sudo docker compose up -d --build               # ~5-10 min first build
sudo docker compose --profile deploy run --rm contracts-deploy   # one-shot: deploy + seed market + smoke test
```

The one-shot deployer prints the deployed addresses, seeds the demo market
(*"Will Barcelona win El Clásico?"*, YES 60 / NO 40), pre-funds trader accounts
2–5 with 10 000 USDC each, and runs a buy smoke test on-chain.

### 2.5 ⚠️ Address-drift fix (important, currently a host-side patch)

**Found during this deploy:** the committed `contracts/deployments/ganache.json`
was generated against a **Hardhat** node, but compose runs **Ganache v7** — the two
derive *different account addresses from the same mnemonic* (different derivation
defaults), so all deployer/contract addresses differ. The "frozen artifact" in the
repo will never match a compose-Ganache deployment.

Workaround applied on the host (must be repeated after `git reset --hard` until the
repo artifact is regenerated against Ganache):

```bash
# extract the artifact the one-shot deployer actually wrote:
sudo docker compose run --rm --no-deps --entrypoint cat contracts-deploy \
  /app/contracts/deployments/ganache.json > /tmp/deployed.json
cp /tmp/deployed.json contracts/deployments/ganache.json
sudo docker compose up -d --build web        # rebake addresses into the browser bundle
```

**Proper fix (tracked):** regenerate the committed artifact against Ganache and/or
make the web build consume the artifact produced by the one-shot deployer at deploy
time rather than the committed file.

### 2.6 Seed the founder (CEO-2 demo target)

The runtime web image contains no Prisma CLI/seed tooling; the simplest method is
the public register endpoint (idempotent — returns 409 if the user exists):

```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Founder","email":"founder@justify.local","password":"founder1234"}'
```

### 2.7 Verification (current state)

| Check | Result |
|---|---|
| `GET :3000/` `/sign-in` `/trade/0` from the internet | ✅ 200 |
| `GET :3000/api/auth/providers` | ✅ credentials provider listed with correct public callback URL |
| `GET :3000/api/profile/founder@justify.local` | ✅ profile + follower count |
| Prisma migrations | ✅ applied on container start (7 tables) |
| On-chain buy smoke test (inside VPS) | ✅ 10 USDC → YES shares |
| `POST :8545` (eth_chainId) from the internet | ❌ **timeout — blocked by AWS Security Group** |
| `GET :3001/` (prototype) from the internet | ❌ **timeout — blocked by AWS Security Group** |

**Consequence:** CEO-1 (register/sign-in) and CEO-2 (follow) are demoable from any
browser right now. CEO-3 (MetaMask connect) and CEO-4 (buy) require the reviewer's
browser to reach Ganache on :8545 — blocked until the Security Group is updated
(see §3.1) or the reviewer uses an SSH tunnel (§3.2).

---

## 3. Action items for DevOps

### 3.1 AWS Security Group — what to open (the only hard blocker)

Current inbound state (observed empirically): **22 and 3000 open; everything else
filtered.** Host firewall (`ufw`) is inactive, so the Security Group is the only gate.

| Port | Action | Reason |
|---|---|---|
| 22 | already open — **restrict source to team IPs** | SSH; key auth only, but don't leave it world-open |
| 3000 | already open | the app — reviewers need it |
| **8545** | **OPEN (required)** — source: reviewer/team IPs if possible | MetaMask in the reviewer's browser must reach Ganache for CEO-3/CEO-4 |
| 3001 | open optionally | static HTML prototype (visual reference only) |
| 5432 | **keep closed / close if open** | Postgres must never be internet-reachable (default creds `justify:justify`) |
| 80 | as-is | pre-existing nginx, not ours |

Console path: EC2 → Instances → `13.219.132.201` → Security tab → Security group →
Edit inbound rules. Or CLI:

```bash
aws ec2 authorize-security-group-ingress --group-id <sg-id> \
  --protocol tcp --port 8545 --cidr <reviewer-ip>/32   # or 0.0.0.0/0 for an open demo
```

> :8545 is an unauthenticated test chain with an open-mint test token — exposing it
> is acceptable for a dev demo, but prefer IP-scoping, and never reuse this pattern
> with a real-value chain.

### 3.2 No-AWS-change fallback (works today)

Reviewers can run the full 4-flow demo without opening 8545:

```bash
ssh -i <keypair.pem> -L 8545:localhost:8545 ubuntu@13.219.132.201
```

…but only if the web image was built with `NEXT_PUBLIC_RPC_URL=http://localhost:8545`
(it is currently built with the public IP — rebuild required for tunnel mode).
Opening the port is strictly simpler; the tunnel is the fallback, not the plan.

### 3.3 Configuration hardening (recommended, not blocking)

1. **Land the `chore/mvp/deploy-dev` PR** (in flight): Dockerfile `ARG`s for
   `NEXT_PUBLIC_RPC_URL` / `NEXT_PUBLIC_CHAIN_ID` / `NEXTAUTH_URL` instead of the
   host-side `sed` patch; `.github/workflows/deploy-dev.yml` CD (trigger: push to
   `mvp`; secrets `DEV_HOST`, `DEV_SSH_KEY`; concurrency-guarded). After merge,
   `git reset --hard` on the VPS stops eating local patches.
2. **Fix the artifact drift** (§2.5) in the repo — until then every redeploy needs
   the manual artifact copy + web rebuild.
3. **Postgres**: don't publish 5432 at all (remove the `ports:` mapping in compose —
   services talk over the Docker network), and change the default password.
4. **Reverse proxy (later)**: put the app behind the existing nginx or a new vhost
   with a domain + TLS; then `NEXTAUTH_URL` becomes `https://...` and ports 3000/8545
   can be closed in favor of proxied paths.
5. **Ganache is in-memory**: any restart of the `ganache` container resets the chain.
   Recovery procedure = §2.4 one-shot deploy + §2.5 artifact check (+ web rebuild if
   addresses changed — they shouldn't, the mnemonic is deterministic *within* Ganache).
   DB rows (users, follows, wallet bindings) survive; on-chain balances do not.
6. **Disk hygiene**: `docker system prune -f` occasionally; image builds accumulate
   (~45 GB free now, builds take ~3-4 GB each).
7. **Monitoring (minimal)**: all four services have compose healthchecks; a cron
   `docker compose ps --format json` + alert, or a 1-line uptime check on
   `GET :3000/` is enough for a dev box.

---

## 4. Routine operations cheat-sheet

```bash
# status
sudo docker compose -f ~/polymarket/docker-compose.yaml ps

# logs
sudo docker compose logs -f web        # or ganache / postgres

# redeploy after mvp branch update (until CD lands)
cd ~/polymarket
git fetch origin && git reset --hard origin/mvp
#   re-apply RPC URL patch if deploy-dev PR not merged yet (§2.3)
sudo docker compose up -d --build
sudo docker compose --profile deploy run --rm contracts-deploy
#   re-check artifact drift (§2.5), re-seed founder if DB was wiped (§2.6)

# full reset (DESTROYS db data)
sudo docker compose down -v && sudo docker compose up -d --build
```

**Demo accounts:**

- Founder login: `founder@justify.local` / `founder1234` (dev only)
- MetaMask: network `http://13.219.132.201:8545`, chain ID `1337`; import a trader
  key from the Ganache mnemonic accounts 2–5 (`sudo docker compose logs ganache | head -60`
  prints the keys; each is pre-funded with 10 000 test USDC after the one-shot deploy).
