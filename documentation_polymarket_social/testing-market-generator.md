# PolyMarket Social ("Justify") — News-Driven Market Generator (Test Component)

**Document version:** 1.0

**Date:** 2026-06-11

**Scope:** Design of the **market generator** — a standalone test/demo component that reads
current headlines from **Google News** and generates random prediction markets from them through
the platform's own public APIs. It exists to keep test and demo environments populated with
realistic, fresh, varied markets without manual authoring.

---

## 1. Purpose and non-goals

### 1.1 Why it exists

Seeded fixtures (two static markets, see [testing-integration.md](testing-integration.md)
Section 5) are enough for correctness tests, but they are poor for everything that needs *volume
and variety*:

- **demo environments** — a feed of week-old hard-coded markets undermines the product story
  ("trade the news from your timeline");
- **exploratory and UI testing** — pagination, hashtag filtering (FR-MKT-2), Market Movers
  ranking (FR-NAV-4), and search (FR-NAV-3) only behave interestingly with dozens of distinct
  markets;
- **load and soak testing** — a continuous trickle of new markets exercises the market-creation
  pipeline (Market Creation API → approval → MarketFactory deployment) the way production
  traffic would.

Real news headlines make better test data than lorem-ipsum questions: they are naturally diverse
in topic, length, and language, they map directly onto market categories (sports, politics,
crypto, culture), and they come with a real URL that can serve as the **oracle proof** field
required by FR-CRT-1.

### 1.2 Non-goals

- **Not a production feature.** The generator never runs against a production environment; the
  markets it creates are synthetic and resolve randomly, not truthfully.
- **Not a news product.** It does not store, republish, or display news content beyond the
  market fields it derives; headlines are used as raw material for test data.
- **Not a correctness oracle.** Generated markets must never be used to verify resolution
  *accuracy* — resolution here is random by design (Section 5.4).

---

## 2. Position in the system

The generator is an **external API client**, not a platform service. For market creation and
trading it uses only the same public surface as a real user
([uml-components-api.puml](uml-components-api.puml)) — no database access. Two lifecycle steps
are exceptions by necessity: approval uses an admin-role account (Section 5.1) and resolution
uses the trusted oracle-resolver chain account (Section 5.4). This makes it a permanent smoke
test of the market-creation path: if the generator can't create markets, neither can users.

```
Google News (RSS)                Platform (test env)
      │                                 ▲
      ▼                                 │ HTTPS (public APIs only)
┌─────────────────┐   fetch   ┌─────────┴─────────┐
│  News Fetcher   ├──────────▶│  Market Generator  │
└─────────────────┘ headlines │  - templating      │
                              │  - scheduling      │
                              │  - dedup store     │
                              └─────────┬─────────┘
                                        │ creates markets / approves / trades / resolves
                                        ▼
                          Market Creation API → MarketFactory (Ganache)
```

Deployment: one planned additional service (`market-generator`) in the repository's
`docker-compose.yaml`, alongside the services listed in
[testing-integration.md](testing-integration.md) Section 2.1.
It is **disabled by default** and switched on per environment (Section 7).

---

## 3. News acquisition

### 3.1 Source

Google News is consumed through its **public RSS feeds** — no API key, no scraping of HTML:

| Feed          | URL pattern                                                                                                                                            |
|---------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| Top headlines | `https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en`                                                                                                |
| Per-topic     | `https://news.google.com/rss/headlines/section/topic/{TOPIC}?hl=…` (`WORLD`, `BUSINESS`, `TECHNOLOGY`, `SPORTS`, `SCIENCE`, `ENTERTAINMENT`, `HEALTH`) |
| Per-query     | `https://news.google.com/rss/search?q={query}&hl=…`                                                                                                    |

Each RSS item provides exactly what the generator needs: **title**, **link**, **publication
date**, and **source name**.

### 3.2 Fetching rules

- Poll on a configurable interval (default **15 min**); respect HTTP caching
  (`ETag`/`If-Modified-Since`) and never exceed one request per feed per interval.
- Rotate through the configured topic feeds so categories stay balanced.
- On fetch failure, log and skip the cycle — the generator must degrade silently, never crash
  the environment or retry-hammer Google.
- **Offline mode:** a bundled fixture file of ~200 canned RSS items is used when the test
  environment has no internet access (CI runners). The flag `NEWS_SOURCE=fixture|live` selects
  the mode; CI defaults to `fixture` so test runs stay hermetic and deterministic.

### 3.3 Deduplication

The generator keeps a small local store (SQLite or a JSON file — it is the only writer) of the
normalized headline hashes it has already used. A headline is used at most once per environment
reset. The store is wiped together with the environment (`docker compose down -v`).

---

## 4. Market generation

### 4.1 From headline to market question

Headlines are declarative ("X announces Y"); markets need **binary, future-looking questions**
(see [architecture-polymarket-platform-reference.md](architecture-polymarket-platform-reference.md)
Section 3 — one binary Yes/No question per market). The generator converts one to the other with
a template engine — deliberately simple, no LLM dependency:

1. **Classify** the headline by feed topic → market category (sports, politics, crypto, …).
2. **Extract** the subject: the headline's leading noun phrase (first segment before a verb or
   punctuation cut, capped at 80 chars).
3. **Apply a random template** from the category's pool. Examples:

| Category        | Template examples                                                                                                                         |
|-----------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| Generic         | "Will «{subject}» still be a top-10 Google News story on {date}?"; "Will «{subject}» be followed by an official statement before {date}?" |
| Sports          | "Will {subject} win their next match?"; "Will {subject} score more than {n} in their next game?"                                          |
| Business/Crypto | "Will {subject} stock/token close higher on {date}?"; "Will {subject} announce further news within {n} days?"                             |
| Politics/World  | "Will {subject} hold a press conference before {date}?"; "Will «{subject}» lead to an official inquiry by {date}?"                        |

4. **Randomize parameters:** `{date}` is now + 1–30 days (uniform), `{n}` from a per-template
   range. Randomness uses a **seedable PRNG**; the seed is logged at startup and settable via
   `GENERATOR_SEED` so any generated dataset can be reproduced exactly.

Questions are clearly testable artifacts, not real predictions — every generated market's
description starts with a fixed marker line:
`⚠ Auto-generated test market — resolves randomly. Source headline: "{title}" ({source}, {pubDate})`.

### 4.2 Field mapping (FR-CRT-1)

| FR-CRT-1 field   | Generated value                                                             |
|------------------|-----------------------------------------------------------------------------|
| **Market name**  | Templated question (Section 4.1), ≤ 120 chars                               |
| **Description**  | Marker line + headline + source + link + template name (for traceability)   |
| **Market photo** | One of a bundled set of category-stock images, uploaded via the Media API   |
| **Oracle proof** | The Google News **article link** from the RSS item — a real, resolvable URL |
| **Market type**  | Random: FUN 70%, Classic 20%, Challenge 10%                                 |

Close time: the templated `{date}`, so the environment always contains a mix of soon-closing
and long-running markets.

### 4.3 Creator identity

Markets are submitted under one or more dedicated **bot accounts** (`news-bot`, `sports-bot`, …)
created through the normal auth flow with Ganache test keys (accounts 7–9 with the default
`--wallet.totalAccounts=10` in `docker-compose.yaml`; raise `totalAccounts` if more bot
identities are needed — extending the role table in
[testing-integration.md](testing-integration.md) Section 2.2). Bot handles are
prefixed `bot-` so UI tests and cleanup jobs can recognize generated content unambiguously.

---

## 5. Lifecycle automation

A market that is merely *created* only tests the first step of the pipeline. The generator
optionally drives the full lifecycle, mirroring flow 6.1 of
[testing-integration.md](testing-integration.md):

### 5.1 Approval

Generated markets land in *pending* (moderated flow, FR-CRT-1). In environments where the
admin/moderation API exists (currently an open item), the generator approves its own submissions
with an admin-role account after a random 0–5 min delay; until then, a compose-level auto-approve
stub performs the same step.

### 5.2 Background trading (optional, `GENERATOR_TRADING=on`)

Dedicated bot trader accounts (Ganache accounts 7+, per Section 4.3 — never the integration
suite's test-trader accounts 2–5) place small random buys on random open generated
markets at a configurable rate. This keeps prices moving so charts (FR-TRD-2), Market Movers
(FR-NAV-4), and portfolio P&L (FR-PORT-2) have live-looking data in demos.

### 5.3 Closing

Close times arrive naturally (1–30 days). For faster turnover in test environments the interval
can be compressed via configuration (e.g. 1–48 hours).

### 5.4 Random resolution

After close, the generator resolves the market through the trusted oracle-resolver account
(Ganache account 1) with a **random outcome** (configurable Yes-bias, default 50/50). Random —
not headline-derived — because the purpose is exercising the resolution/redemption path, not
predicting reality. The real platform's UMA-based flow is out of scope for the MVP
(see [architecture-polymarket-platform-reference.md](architecture-polymarket-platform-reference.md)
Section 10).

---

## 6. Safety rails

| Rail                 | Rule                                                                                                                                                                                                                      |
|----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Environment lock** | Refuses to start unless the target API base URL is in an explicit allowlist (`localhost`, `*.test`, `*.staging`) **and** the chain ID reported by the node is 1337. Production can never be targeted by misconfiguration. |
| **Rate cap**         | Hard ceiling on markets created per hour (default 12) and total live generated markets (default 100); above the ceiling the generator idles.                                                                              |
| **Marked content**   | Every market carries the auto-generated marker (Section 4.1) and a bot creator (Section 4.3); a single filter removes all generated content from any view or query.                                                       |
| **Content filter**   | Headlines matching a configurable denylist (tragedies, violence, ongoing disasters) are skipped — demo environments are shown to outsiders, and a betting card on a tragedy headline is unacceptable even as test data.   |
| **No retention**     | Beyond the dedup hashes, no news content is stored outside the created markets themselves.                                                                                                                                |

---

## 7. Configuration

All knobs are environment variables on the `market-generator` service:

| Variable            | Default   | Meaning                                                         |
|---------------------|-----------|-----------------------------------------------------------------|
| `GENERATOR_ENABLED` | `false`   | Master switch                                                   |
| `NEWS_SOURCE`       | `fixture` | `fixture` (bundled items, hermetic) or `live` (Google News RSS) |
| `NEWS_TOPICS`       | all       | Comma list of topic feeds to rotate                             |
| `POLL_INTERVAL`     | `15m`     | RSS poll cadence                                                |
| `MARKETS_PER_HOUR`  | `12`      | Creation rate cap                                               |
| `MAX_LIVE_MARKETS`  | `100`     | Total cap on open generated markets                             |
| `CLOSE_WINDOW`      | `1d-30d`  | Range for generated close times                                 |
| `GENERATOR_TRADING` | `off`     | Background bot trading (Section 5.2)                            |
| `RESOLVE_YES_BIAS`  | `0.5`     | Probability a market resolves Yes                               |
| `GENERATOR_SEED`    | random    | PRNG seed for reproducible datasets                             |
| `API_BASE_URL`      | —         | Target environment (validated against allowlist)                |

---

## 8. Testing the generator itself

The generator is test infrastructure, but it still gets its own thin test suite:

- **Unit:** headline → question templating (subject extraction, length caps, parameter ranges);
  dedup store; denylist filter; environment-lock logic (must refuse non-allowlisted URLs and
  wrong chain IDs).
- **Integration (against the standard compose environment, fixture mode):** one full cycle —
  fetch fixtures → create N markets → verify each appears in the Markets API as *Live* with the
  marker line, bot creator, and oracle-proof URL intact; compressed-clock run through close →
  random resolve → bot redemption.
- **Determinism check:** two runs with the same `GENERATOR_SEED` and fixture file must produce
  identical market sets.

---

## 9. Open items

- **Admin/moderation API dependency** — auto-approval (Section 5.1) needs the approval endpoint
  that is still unspecified (functional requirements Section 15, item 10); the stub approach
  must be replaced when the API lands.
- **Google News RSS stability** — the feed format is unofficial and may change; the fixture mode
  is the fallback, but live mode needs a canary check in staging.
- **Implementation stack** — undecided, same as the backend (testing-integration.md Section 8);
  the only constraints are an RSS parser, an HTTP client, and a seedable PRNG.
- **Multi-language headlines** — current templates are English-only; `hl`/`gl` feed parameters
  allow localized demo data later if needed.
