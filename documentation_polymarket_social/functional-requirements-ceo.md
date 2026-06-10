# PolyMarket Social ("Justify") — CEO MVP Scope Directive

This document records the CEO's scope directive for the MVP in English. It does not replace
[functional-requirements.md](functional-requirements.md); it prioritizes it. Where this document and the
full FR catalog disagree on *what must actually work* in the MVP, this document wins.

---

## 1. The directive

> Functionally, what matters to me is that a user can **register**, **follow my profile**,
> **connect a wallet**, and **place a bet on one event**.
>
> Everything else: if we have time — great. If we don't — we hardcode everything that exists.

Two consequences:

1. There is a small set of **must-work** flows (Section 2). These must be implemented end-to-end with
   real backend and on-chain behavior — no mocks, no hardcoding.
2. **Every other feature visible in the prototype may ship hardcoded** (static data, non-functional
   buttons), exactly as the prototype does today (Section 3). Hardcoding is an accepted fallback, not
   a defect, for anything outside Section 2.

---

## 2. Must-work MVP flows (no hardcoding allowed)

### CEO-1 — User registration

A new user must be able to create an account and sign in.

- Traceability: FR-AUTH-1 (sign-in entry point), plus **at least one** working method of
  FR-AUTH-2 (Google OAuth) / FR-AUTH-3 (email) / FR-AUTH-4 (wallet sign-in).
- Minimum bar: one authentication method working end-to-end (session issued, user persisted).
  The remaining methods may be hardcoded/disabled per Section 3.

### CEO-2 — Follow a profile

A signed-in user must be able to open a designated profile (the founder's profile) and follow it,
with the follow state persisted and reflected in follower counts.

- Traceability: FR-SOC-10 (follow/unfollow), FR-PROF-1 (profile header with follower count).
- Minimum bar: Follow/Following toggle works against the real Social Graph service for at least
  the founder's profile; the follower count reflects the action after reload.

### CEO-3 — Connect a wallet

A signed-in user must be able to connect a crypto wallet to their account.

- Traceability: FR-AUTH-4 (wallet connection: request accounts, verify/switch chain, error handling).
- Minimum bar: MetaMask (injected `window.ethereum`) connects and the address is bound to the user.
  Other providers (Trust Wallet, Coinbase Wallet, WalletConnect) may be hardcoded/disabled.
- Chain note: per the standing architectural decision in [README.md](README.md), the MVP targets the
  local **Ganache node (chain ID 1337, JSON-RPC :8545)** — not Base 8453 as the prototype's static
  code suggests.

### CEO-4 — Place a bet on one event

A user with a connected wallet must be able to place a real bet (buy an outcome position) on
**at least one live market**, settled on-chain against the MVP contracts.

- Traceability: FR-CARD-2 (flip-to-trade form) **or** FR-TRD-3 (trading-page order ticket) — one of
  the two entry points is sufficient; FR-CARD-3 (payout calculation) for the chosen entry point.
- Minimum bar: one market exists (it may be created/seeded by the team rather than via FR-CRT-1);
  Buy flow only (the Sell flow is already a known gap — Section 15.4 of the FR catalog); the
  position is visible after the trade (a minimal FR-PORT-2 rendering or equivalent confirmation).

---

## 3. Everything else — hardcode fallback

All other functional areas are **time-permitting**. In priority order, if time runs out, they ship
exactly as the prototype renders them today (static data, hard-coded counts and prices, inert
controls), consistent with the prototype's existing behavior (FR catalog Section 15.7, "Static data"):

- Social feed, posting, comments, engagement (FR-FEED-*, except where CEO-2 needs profile rendering)
- Market discovery / explore, hashtags, domains (FR-MKT-*)
- Full trading page features beyond the single bet flow: charts, timeframes, limit orders, Sell tab
  (FR-TRD-2, parts of FR-TRD-3), creator view (FR-TRD-5)
- Market creation by users (FR-CRT-1) — the one MVP market may be seeded manually
- Portfolio beyond minimal trade confirmation (FR-PORT-*)
- Profile editing, settings, dark mode toggle persistence (FR-PROF-2…6)
- Notifications (FR-NOT-1), Help center (FR-HELP-1), global search (FR-NAV-3)
- Additional auth methods and languages beyond the single working method (FR-AUTH-2/3/4 remainder,
  FR-AUTH-6)

A hardcoded feature must still **look** like the prototype (it is the source of truth for visuals);
it just doesn't have to function.

---

## 4. Implications for the architecture team

1. **Build order follows Section 2**: Auth & Identity → Social Graph (follow only) → wallet binding →
   one market + trade settlement path (MarketFactory/PredictionMarket/MarketAMM/OutcomeToken/
   MockUSDC on Ganache 1337). Everything else is stretch.
2. **Test priority follows Section 2**: the integration and E2E suites must cover CEO-1…CEO-4 first
   (cf. journeys in [ui-testing.md](ui-testing.md)); coverage for hardcoded areas is deferred.
3. **No new scope**: nothing in this document adds behavior beyond the FR catalog; it only narrows
   what must be dynamic for the MVP.
