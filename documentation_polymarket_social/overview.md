# PolyMarket Social ("Justify") — Project Overview

**Document version:** 1.0

**Date:** 2026-06-11

**Source:** Analysis of the HTML prototype in `html-polymarket-social-prototype/`

---

## 1. What the project is

PolyMarket Social — branded in the prototype as **"Justify — Trade Smarter, Together"** — is a **social prediction-market platform**. It merges two product categories into one experience:

- a **social network** in the style of Twitter/X: a timeline of posts, comments, likes, reposts, follows, profiles, notifications, and trending topics;
- a **prediction market** in the style of Polymarket: binary-outcome markets on real-world events, priced in cents that reflect implied probability, with on-chain settlement on an EVM chain (prototype: **Base**; MVP per [README.md](README.md): local Ganache, chain ID 1337).

The key product idea is that **the prediction market itself is a social object**. A market is not buried on a separate exchange page — it is embedded as an interactive card inside posts in the feed. Users scroll their timeline, see a creator's market ("El Clásico — who will win?"), and can buy an outcome in two clicks without leaving the feed, then discuss it in the comments below the same post.

The prototype's self-description (from the founder's profile bio) sums up the vision:

> *"The Social Prediction Platform on Base. Building the future of onchain opinion markets. Web3 believer. Product thinker. Social Trading."*

---

## 2. Who it is for

| Audience | What the platform gives them |
|----------|------------------------------|
| **Traders / forecasters** | A feed-driven way to discover markets, trade them in place, track positions and P&L in a portfolio. |
| **Creators / influencers** | The ability to create their own markets around their content and audience (a football club launching a match market, a crypto figure launching a protocol-upgrade market), and to grow a follower base around their forecasting reputation. |
| **Spectators / community** | A social space to follow personalities, vote with likes, comment on events, and watch live market odds as social signals ("21% chance"). |

The prototype illustrates this with recognizable archetypes: FC Barcelona posting an El Clásico market, vitalik.eth polling his audience about an ETH-upgrade market, a "@founder" account running a geopolitical market with $14M volume.

---

## 3. Core user experience

A typical session demonstrated by the prototype:

1. **Sign in** with Google, email, or a crypto wallet (MetaMask, Trust Wallet, Coinbase Wallet, WalletConnect). Wallet login switches the user to the Base network automatically (prototype behavior; the MVP chain is Ganache 1337 — see README.md).
2. **Scroll the feed** — posts from followed creators, with three tabs: *Feed*, *People* (account discovery by category), and *Trending*.
3. **Trade from the feed** — an embedded market card shows the question, volume, closing time, and a circular "chance" gauge; pressing *Buy Yes / Buy No* flips the card into a mini order form (amount, +1/+10 buttons, slider, projected payout "To win: $X").
4. **Go deeper** — open the market's full trading page: price chart with timeframes (1H–ALL), Buy/Sell tabs, outcome prices in cents, quick-amount buttons, and the market's own comment thread.
5. **Track performance** — the portfolio page lists every held position with amount, current price, total value, and unrealized P&L per outcome.
6. **Engage socially** — like, comment, repost, share, follow creators, check notifications ("@leo liked your market"), build a profile with posts, liked items, reposts, and mentions.
7. **Create a market** — submit a market request with a name, description, photo, an **oracle proof** URL (the source used to resolve the outcome), and a market type (*FUN*, *Classic*, or *Challenge*).

---

## 4. Main functional areas

The prototype covers eight functional areas (detailed requirements in [functional-requirements.md](functional-requirements.md)):

| Area | Pages | Highlights |
|------|-------|------------|
| **Social feed** | `index.html` | Post composer (500-char limit, link/image/video attachments), creator carousel, post cards with engagement, inline comment threads, infinite scroll |
| **Market discovery** | `market.html` | List of live markets with creators, hashtags, thumbnails; "Market Movers" trending widget on every page |
| **Trading** | `trade.html`, `trade_founder.html` | Price chart, Buy/Sell order ticket, outcome prices in cents, market discussion thread; a creator-view variant of the same page |
| **Embedded trading widget** | all feed pages | The flippable market card — the platform's signature component |
| **Portfolio** | `portfolio.html` | Per-market position blocks with amount, price, value, and color-coded P&L |
| **Identity & social graph** | `profile.html`, `edit-profile.html` | Profiles with verified badges, follower/following counts, four content tabs (posts / liked / reposts / mentions), account settings, dark mode |
| **Market creation** | `create.html` | Moderated "send your request" flow with oracle-proof source and market types |
| **Engagement & support** | `notification.html`, `help.html`, `404.html` | Activity notifications (follows, likes, reposts), support contact form, branded error page |

---

## 5. Technical snapshot

The prototype is a **static front-end** (no backend); all data is hard-coded for demonstration.

- **UI stack:** Bootstrap 5, jQuery 3.6, Slick carousel, Chart.js, Material Icons, Icofont. Dark glass-morphism design, fully responsive (three-column desktop layout collapsing to a mobile single column with off-canvas navigation).
- **Web3 stack:** Web3.js, Coinbase Wallet SDK, WalletConnect v1; target chain **Base mainnet (chain ID 8453)** via Infura RPC (prototype behavior; the MVP chain is Ganache 1337 — see README.md).
- **Auth:** Google Identity Services (OAuth 2.0 / OIDC) plus the four wallet providers; email flow stubbed.
- **Custom behavior** (`js/custom.js`): market-card flip animation and payout calculator, amount/slider sync, follow toggles, persistent dark-mode switch, creator carousel, wallet-connection handlers with chain switching.

### Known prototype boundaries
Several referenced pages are not implemented (`explore.html`, `tags.html`, `login.html`); the creator view lacks actual management/resolution controls; there is no order book, sell-flow differentiation, deposits/withdrawals, search results page, or admin/moderation UI. These are catalogued as gaps in the functional requirements document and need specification before production development.

---

## 6. Document map

See [README.md](README.md) for the full document index and suggested reading order.
