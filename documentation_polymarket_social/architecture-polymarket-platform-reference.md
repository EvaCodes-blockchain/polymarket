# Polymarket Platform Reference

**Document version:** 1.0

**Date:** 2026-06-11

**Source:** Official Polymarket developer documentation — <https://docs.polymarket.com>
(machine-readable index: <https://docs.polymarket.com/llms.txt>)

This document distills how the **real Polymarket platform** works, as a reference for designing
PolyMarket Social ("Justify"). The project borrows Polymarket's market mechanics (binary outcome
markets, prices-as-probabilities, on-chain settlement), so the production platform is the best
available blueprint for our [Markets, Orders, and Portfolio APIs](uml-components-api.puml) and the
[smart-contract layer](uml-components-smart-contracts.puml). Section 10 lists where our current
design deliberately differs.

---

## 1. Platform architecture at a glance

Polymarket is a **hybrid-decentralized exchange**: orders are created and matched **off-chain** by
a central operator (the CLOB — Central Limit Order Book), while settlement happens **on-chain**
through audited smart contracts. Users keep custody of their funds at all times; orders are
EIP-712-signed messages that authorize the Exchange contract to settle a matched trade atomically.

All contracts are deployed on **Polygon mainnet (chain ID 137)**. Collateral is **pUSD**, an
ERC-20 wrapper over USDC.e (6 decimals, backing enforced on-chain). Outcome positions are
**ERC-1155 tokens** minted via the Gnosis **Conditional Token Framework (CTF)**. Resolution is
handled by the **UMA Optimistic Oracle**.

## 2. Public APIs

The platform is served by three separate REST APIs plus a bridge:

| API            | Base URL                           | Auth  | Domain                                                                                                        |
|----------------|------------------------------------|-------|---------------------------------------------------------------------------------------------------------------|
| **Gamma API**  | `https://gamma-api.polymarket.com` | none  | Markets, events, tags, series, comments, sports, search, public profiles — the primary discovery/browse API   |
| **Data API**   | `https://data-api.polymarket.com`  | none  | User positions, trades, activity, holders, open interest, leaderboards                                        |
| **CLOB API**   | `https://clob.polymarket.com`      | mixed | Order books, prices, midpoints, spreads, price history (public); order placement/cancellation (authenticated) |
| **Bridge API** | `https://bridge.polymarket.com`    | —     | Deposits/withdrawals (proxy of the fun.xyz service, not operated by Polymarket)                               |

Full OpenAPI specs are published (e.g. `https://docs.polymarket.com/api-spec/gamma-openapi.yaml`,
`clob-openapi.yaml`, `data-openapi.yaml`) and AsyncAPI specs for the WebSocket channels — useful as
schema references for our own API design and contract tests.

### Market discovery patterns (Gamma API)

Three strategies, mirrored by our Markets API needs:

- **By slug** — the URL path segment identifies a market/event:
  `GET /events?slug=fed-decision-in-october` or `GET /events/slug/{slug}`.
- **By tag** — `GET /tags` lists categories; filter with
  `GET /events?tag_id=…&related_tags=true&exclude_tag_id=…` (our hashtag filtering, FR-MKT-2).
- **All active markets** — `GET /events?active=true&closed=false&order=volume_24hr&ascending=false&limit=100`;
  events contain their markets, so paging events is the cheapest full sweep. Sort fields include
  `volume_24hr`, `volume`, `liquidity`, `start_date`, `end_date`, `competitive` (our "Market
  Movers" ranking, FR-NAV-4).
- **Pagination** — classic `limit`/`offset`, plus keyset (cursor) variants
  (`after_cursor`/`next_cursor`) for stable paging over large sets.

## 3. Core domain model

### Markets and events

- A **market** is the tradable unit: one binary Yes/No question.
- An **event** groups one or more related markets; a multi-market event models a mutually
  exclusive multi-outcome question ("Who wins the election?" → one Yes/No market per candidate).
- Every market carries three identifiers:

| Identifier       | Meaning                                                     |
|------------------|-------------------------------------------------------------|
| **Condition ID** | Unique ID of the market's condition in the CTF contracts    |
| **Question ID**  | Hash of the market question, used for resolution            |
| **Token IDs**    | Two ERC-1155 token IDs traded on the CLOB — one Yes, one No |

- Markets are order-book tradable only when `enableOrderBook` is `true`; a human-readable **slug**
  identifies every market/event in URLs and API queries.

### Outcome tokens and positions (CTF)

Each market has exactly two outcome tokens; a winning token redeems for $1.00, a losing one for $0.
Every Yes/No pair in existence is backed by exactly $1 of collateral locked in the CTF contract —
positions are always fully collateralized. A user's **position** is simply their token balance;
`position value = balance × current price`.

Four lifecycle operations:

| Operation  | Effect                                              | Typical use                                |
|------------|-----------------------------------------------------|--------------------------------------------|
| **Split**  | $N collateral → N Yes + N No tokens                 | Market-maker inventory; holding both sides |
| **Trade**  | Buy/sell single tokens on the order book            | How most users acquire positions           |
| **Merge**  | N Yes + N No → $N collateral                        | Exit without trading                       |
| **Redeem** | N winning tokens → $N collateral (after resolution) | Collect winnings                           |

Token IDs are derived on-chain in three steps: `getConditionId(oracle, questionId, outcomeSlotCount=2)`
→ `getCollectionId(0, conditionId, indexSet=1|2)` → `getPositionId(collateralToken, collectionId)`.
In practice the Gamma API returns both token IDs on each market object, so manual derivation is
only needed for direct contract integration.

### Prices and the order book

- Prices are quoted in USD between $0.00 and $1.00 and **map directly to implied probability**
  ($0.25 → 25%).
- **Yes and No prices are complements**: they must sum to $1.00. A Yes-buy at $0.60 can match a
  No-buy at $0.40 — the matched $1.00 is split into a fresh Yes + No pair and distributed to the
  two buyers (minting), which is how liquidity comes into existence on a CLOB without an AMM.
- **Displayed price** is the bid–ask midpoint, except when the spread is wider than $0.10, in
  which case the last traded price is shown. Execution always happens at bid/ask, not midpoint.
- All orders are technically **limit orders**; a "market order" is a limit order priced to cross
  the book. Price improvement goes to the taker.

### Order lifecycle

1. **Create & sign** — client builds the order (token ID, side, price, size, expiration,
   millisecond timestamp for uniqueness) and signs it as an EIP-712 message.
2. **Submit** — the CLOB operator validates signature, balance, allowances, and tick size.
3. **Match or rest** — marketable orders match (some crypto/finance markets apply a 250 ms taker
   delay; live sports markets a configured delay window — pending orders cannot be cancelled
   during the delay); non-marketable orders rest on the book.
4. **Settle** — the operator submits matched trades on-chain; the Exchange contract verifies both
   signatures and swaps tokens/collateral **atomically**.
5. **Confirm** — finality on Polygon; balances and history update.

Order time-in-force types: **GTC** (rest until filled/cancelled), **GTD** (auto-expire),
**FOK** (all-or-nothing), **FAK** (fill available, cancel rest), plus a **post-only** flag
(rejected rather than executed if it would cross the spread — guarantees maker status).

Order statuses: `live`, `matched`, `delayed`, `unmatched`.
Trade statuses: `MATCHED` → `MINED` → `CONFIRMED` (terminal), with `RETRYING`/`FAILED` on errors.

Useful invariant for an order-ticket UI / risk checks:
`maxOrderSize = balance − Σ(openOrderSize − filledAmount)`.

Sports specifics: outstanding limit orders are auto-cancelled at official game start.

### Resolution (UMA Optimistic Oracle)

Each market defines **resolution rules** up front: a resolution source, an end date, and edge-case
handling — the rules, not the title, define the outcome. Our prototype's "oracle proof" URL
(FR-CRT-1) is the analogue of the resolution source.

Permissionless optimistic flow:

1. **Proposal** — anyone proposes an outcome by posting a bond (typically $750). Correct,
   undisputed proposers get the bond back plus a reward; wrong/premature proposers lose the bond.
2. **Challenge period** — 2 hours. No dispute → market resolves (~2 h total).
3. **Dispute** — counter-bond triggers a second proposal round; a second dispute escalates to a
   UMA token-holder vote (DVM) after a 24–48 h evidence/debate period; voting takes ~48 h.
   Disputed resolutions take 4–6 days total. A rare "Unknown/50-50" verdict resolves every token
   at $0.50.
4. **After resolution** — trading stops; winning tokens redeem for $1.00 via the CTF collateral
   adapter, losing tokens are worthless.

Polymarket can publish on-chain **clarifications** ("Additional context") that cannot change the
question's intent but guide proposers/voters.

## 4. Authentication model (CLOB)

Gamma and Data APIs are fully public. The CLOB uses a **two-level** model that keeps trading
non-custodial — a pattern directly relevant to our Wallet Auth API (FR-AUTH-4):

- **L1 — private key.** The wallet signs an EIP-712 struct
  (`ClobAuth { address, timestamp, nonce, message: "This message attests that I control the given wallet" }`,
  domain `ClobAuthDomain` v1, chainId 137) sent in `POLY_ADDRESS` / `POLY_SIGNATURE` /
  `POLY_TIMESTAMP` / `POLY_NONCE` headers. Used only to create/derive API credentials
  (`POST /auth/api-key`, `GET /auth/derive-api-key`) and to sign orders locally.
- **L2 — API key.** L1 yields `{apiKey, secret, passphrase}`. Every trading request carries 5
  headers (`POLY_ADDRESS`, `POLY_SIGNATURE` = HMAC-SHA256 over the request using `secret`,
  `POLY_TIMESTAMP`, `POLY_API_KEY`, `POLY_PASSPHRASE`). Even with L2 auth, order creation still
  requires the user's EIP-712 signature on the order payload itself.

Clients also declare a **signature type** and a **funder** address (who holds the funds):
`0` EOA, `1` POLY_PROXY (Magic-link users), `2` GNOSIS_SAFE, `3` POLY_1271 (deposit-wallet flow
for new API users, ERC-1271 validation).

## 5. Fees

- **Makers never pay fees; only takers do**, and only on fee-enabled markets
  (`feesEnabled: true`; geopolitics/world-events markets are fee-free).
- Fee formula: `fee = C × feeRate × p × (1 − p)` where C = shares, p = price. The dollar fee is
  symmetric around 50¢ (a trade at 30¢ costs the same as at 70¢) and peaks at p = 0.5.
- Taker fee rates by category: Crypto 0.07, Economics/Culture/Weather/Other 0.05,
  Finance/Politics/Mentions/Tech 0.04, Sports 0.03, Geopolitics 0.
- Fees are computed at match time by the protocol — orders carry no fee fields. A share of fees
  is redistributed daily as **maker rebates** (20–25% by category) and tiered **taker rebates**.
- Smallest charged fee is 0.00001 USDC (5-decimal rounding); fees fund the rebate programs.

Polymarket also pays a variable **holding reward** (4.00% annualized at time of writing) on
position value in eligible markets, sampled hourly and paid daily.

## 6. WebSocket channels

| Channel                               | Endpoint                                               | Auth           |
|---------------------------------------|--------------------------------------------------------|----------------|
| Market                                | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | no             |
| User                                  | `wss://ws-subscriptions-clob.polymarket.com/ws/user`   | yes (L2 creds) |
| Sports                                | `wss://sports-api.polymarket.com/ws`                   | no             |
| RTDS (comments, crypto/equity prices) | `wss://ws-live-data.polymarket.com`                    | optional       |

- **Market channel** subscribes by **token (asset) IDs**; message types: `book` (full snapshot),
  `price_change`, `tick_size_change`, `last_trade_price`, plus opt-in (`custom_feature_enabled:
  true`) `best_bid_ask`, `new_market`, `market_resolved`.
- **User channel** subscribes by **condition IDs** and streams `order` and `trade` lifecycle
  events (MATCHED → CONFIRMED).
- Subscriptions can be modified without reconnecting (`operation: subscribe|unsubscribe`).
- Heartbeats: client sends `PING` every 10 s on market/user channels; the sports channel pings
  the client, which must answer `pong` within 10 s or be disconnected.

This is the model to copy for our live price updates on market cards and the portfolio page
(unspecified in the FR document — tracked as Section 15, item 12).

## 7. Rate limits (selected)

Enforced by Cloudflare with throttling (delay/queue) rather than hard rejection; sliding windows.

| Scope                                        | Limit                                                  |
|----------------------------------------------|--------------------------------------------------------|
| Global                                       | 15,000 req / 10 s                                      |
| Gamma general / `/events` / `/markets`       | 4,000 / 500 / 300 req / 10 s                           |
| Data API general / `/trades` / `/positions`  | 1,000 / 200 / 150 req / 10 s                           |
| CLOB `/book`, `/price`, `/midpoint` (single) | 1,500 req / 10 s each (batch variants: 500)            |
| CLOB `/prices-history`                       | 1,000 req / 10 s                                       |
| `POST /order`, `DELETE /order`               | burst 5,000 req / 10 s; sustained 120,000 req / 10 min |
| Bridge API                                   | 50 req / 10 s                                          |
| Relayer `/submit`                            | 25 req / min                                           |

Trading endpoints distinguish **burst** vs **sustained** limits — a useful pattern for our own
gateway. A **heartbeat endpoint** (`POST` heartbeat) lets automated traders ensure all their open
orders are cancelled if their system goes unresponsive — a good safety idea for any bot-facing API.

## 8. Official SDKs

| Language   | Package                      | Repository                              |
|------------|------------------------------|-----------------------------------------|
| TypeScript | `@polymarket/clob-client-v2` | github.com/Polymarket/clob-client-v2    |
| Python     | `py-clob-client-v2`          | github.com/Polymarket/py-clob-client-v2 |
| Rust       | `polymarket_client_sdk_v2`   | github.com/Polymarket/rs-clob-client-v2 |

All three cover the full CLOB API (market data, auth, order management) and ship `/examples`.
A separate **relayer SDK** (`@polymarket/builder-relayer-client`, `py-builder-relayer-client`)
handles gasless transactions and deposit-wallet creation. There is also a **Builder Program**
(builder codes attached to orders for attribution, fee share, and analytics) — relevant if we ever
route real Polymarket orders rather than running our own contracts.

## 9. Key contract addresses (Polygon mainnet, chain 137)

Single source of truth: <https://docs.polymarket.com/resources/contracts>. Highlights:

| Contract                          | Address                                      |
|-----------------------------------|----------------------------------------------|
| CTF Exchange                      | `0xE111180000d2663C0091e4f400237545B87B996B` |
| Neg Risk CTF Exchange             | `0xe2222d279d744050d28e00520010520000310F59` |
| Conditional Tokens (CTF)          | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| pUSD — CollateralToken (proxy)    | `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` |
| CollateralOnramp (USDC.e → pUSD)  | `0x93070a847efEf7F70739046A929D47a521F5B8ee` |
| CollateralOfframp (pUSD → USDC.e) | `0x2957922Eb93258b93368531d39fAcCA3B4dC5854` |
| UmaCtfAdapter v3.0                | `0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49` |

CTF Exchange V2 is audited by Quantstamp and Cantina (reports in the
[ctf-exchange-v2](https://github.com/Polymarket/ctf-exchange-v2) repo) — worth reading before we
write our own settlement contracts. The CTF contracts themselves are the open-source
[Gnosis conditional-tokens-contracts](https://github.com/gnosis/conditional-tokens-contracts).

## 10. Where our design differs from the real platform

| Topic          | Real Polymarket                                             | Our current design                                                                            | Implication                                                                                                                                                                               |
|----------------|-------------------------------------------------------------|-----------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Chain          | **Polygon mainnet (137)**                                   | Prototype targets **Base (8453)**; MVP targets Ganache (1337)                                 | The prototype docs' assumption that Polymarket-style trading lives on Base does not match the real platform; chain choice for production is still open.                                   |
| Collateral     | pUSD (ERC-20 wrapper over USDC.e)                           | MockUSDC on Ganache; USDC planned                                                             | If we ever adopt a wrapper token, the Onramp/Offramp pattern (approve-then-wrap, on-chain backing) is the reference.                                                                      |
| Matching       | Off-chain CLOB + on-chain atomic settlement                 | **On-chain AMM** ([uml-components-smart-contracts.puml](uml-components-smart-contracts.puml)) | AMM is simpler for MVP but has no resting orders, no maker/taker distinction, and price impact on every trade. A later CLOB migration would change the Orders API contract substantially. |
| Outcome tokens | ERC-1155 via Gnosis CTF, split/merge/redeem                 | ERC-1155 outcome tokens (aligned)                                                             | We can adopt CTF semantics (full collateralization, complement pricing) almost verbatim.                                                                                                  |
| Resolution     | UMA Optimistic Oracle: bonds, 2 h challenge, DVM escalation | Trusted manual oracle resolver for MVP; "oracle proof" URL at creation                        | The proposal/challenge/bond flow is the long-term decentralization path already anticipated in our README.                                                                                |
| Fees           | Taker-only `C × rate × p × (1−p)`, maker/taker rebates      | MarketAMM routes trading fees to FeeTreasury (uml-components-smart-contracts.puml); fee rate and creator split unspecified — known gap (functional-requirements.md Section 15, item 2) | A concrete, audited fee model we can adopt when fees become a requirement.                                                                                                                |
| Live data      | WebSocket channels (market/user/sports)                     | Not specified — gap (functional-requirements.md Section 15, item 12)                          | Real-time price updates on feed cards will need an equivalent; Polymarket's channel/subscription design is a ready template.                                                              |

## 11. Further reading

- Docs home: <https://docs.polymarket.com> — machine-readable index at
  [/llms.txt](https://docs.polymarket.com/llms.txt); every page is fetchable as Markdown by
  appending `.md` to its path.
- Concepts: [markets-events](https://docs.polymarket.com/concepts/markets-events.md),
  [order-lifecycle](https://docs.polymarket.com/concepts/order-lifecycle.md),
  [positions-tokens](https://docs.polymarket.com/concepts/positions-tokens.md),
  [prices-orderbook](https://docs.polymarket.com/concepts/prices-orderbook.md),
  [resolution](https://docs.polymarket.com/concepts/resolution.md),
  [pusd](https://docs.polymarket.com/concepts/pusd.md)
- API: [introduction](https://docs.polymarket.com/api-reference/introduction.md),
  [authentication](https://docs.polymarket.com/api-reference/authentication.md),
  [rate-limits](https://docs.polymarket.com/api-reference/rate-limits.md),
  [error codes](https://docs.polymarket.com/resources/error-codes.md)
- Trading: [fees](https://docs.polymarket.com/trading/fees.md),
  [CTF operations](https://docs.polymarket.com/trading/ctf/overview.md),
  [WebSocket overview](https://docs.polymarket.com/market-data/websocket/overview.md),
  [fetching markets](https://docs.polymarket.com/market-data/fetching-markets.md)
- Contracts & audits: [contracts](https://docs.polymarket.com/resources/contracts.md)
