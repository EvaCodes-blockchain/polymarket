# PolyMarket Social ("Justify") — End-to-End UI Testing

**Document version:** 1.0

**Date:** 2026-06-11

**Scope:** Browser-driven end-to-end (E2E) testing of the user interface, complementing the API-level suite in
[testing-integration.md](testing-integration.md). UI flows and selectors reference the prototype pages in
[`../html-polymarket-social-prototype/`](../html-polymarket-social-prototype/) and the functional requirements
in [functional-requirements.md](functional-requirements.md).

---

## 1. Goals and scope

### 1.1 What E2E UI tests verify

E2E tests drive a real browser against the full stack (front end + APIs + database + Ganache) and assert what
the **user actually experiences**:

- critical user journeys complete successfully end to end (sign-in → trade → portfolio);
- UI behavior that has no API equivalent: the market-card flip animation and payout display, amount/slider sync,
  tab switching, modals, carousels, dark mode, responsive layout;
- integration of the front end with wallet providers (via an injected test wallet).

### 1.2 What is out of scope

- API correctness in depth — covered by [testing-integration.md](testing-integration.md); UI tests assert the
  *visible result*, not every field of every response.
- Unit tests of front-end components.
- Cross-browser visual pixel-perfection beyond the agreed browser matrix (Section 2.3).

### 1.3 Test pyramid position

E2E UI tests sit at the top of the pyramid: **few, high-value journeys** (Section 5) plus targeted
component-behavior specs (Section 6). Anything verifiable one level down (API or unit) is tested there instead —
UI tests are the most expensive to run and maintain.

---

## 2. Tooling and environment

### 2.1 Framework

**Playwright** is the chosen framework:

- first-class auto-waiting (no manual sleeps for the card-flip animation or chart rendering);
- built-in support for emulating mobile viewports (needed for the responsive requirements, FR-NAV-1);
- trace viewer + video + screenshot artifacts on failure;
- network interception for stubbing the few third parties we don't run locally.

### 2.2 Environment

UI tests reuse the same Docker Compose environment as the integration suite (`docker-compose.test.yml` —
see [testing-integration.md](testing-integration.md), Section 2), plus the front-end container. The same
deterministic Ganache accounts and database fixtures apply, so a UI test and an API test describing the same
scenario see the same data.

**Wallet:** real browser extensions (MetaMask) are not used in CI — they are flaky and unscriptable at scale.
Instead, tests inject a lightweight `window.ethereum` test provider backed by a deterministic Ganache private
key. It implements the standard EIP-1193 surface the app uses: `eth_requestAccounts`, `personal_sign`,
`wallet_switchEthereumChain` (must report chain ID **1337**). One smoke test per release may run with the real
MetaMask extension manually (Section 7.3).

**Third-party stubs:** Google OAuth uses the same `oauth-mock` service as the integration suite; the UI test
clicks "Continue with Google" and lands back on the auth callback with a mock token.

### 2.3 Browser and viewport matrix

| Project   | Browser  | Viewport                | Purpose                                            |
|-----------|----------|-------------------------|----------------------------------------------------|
| `desktop` | Chromium | 1440×900                | Primary: three-column layout (FR-NAV-1)            |
| `mobile`  | Chromium | iPhone-class (390×844)  | Single column + off-canvas navigation (FR-NAV-1)   |
| `firefox` | Firefox  | 1440×900                | Engine coverage, journeys only                     |
| `webkit`  | WebKit   | 1440×900                | Engine coverage, journeys only                     |

Component-behavior specs (Section 6) run on `desktop` and `mobile`; the full journey set runs on all four.

---

## 3. Conventions

### 3.1 Page objects

One page object per prototype page, mirroring the documented page map (functional requirements, Section 1.3):

```
tests/e2e/
  pages/
    feed.page.ts            # index.html
    markets.page.ts         # market.html
    trade.page.ts           # trade.html / trade_founder.html
    portfolio.page.ts       # portfolio.html
    profile.page.ts         # profile.html / edit-profile.html
    notifications.page.ts   # notification.html
    create-market.page.ts   # create.html
    help.page.ts            # help.html
  components/
    market-card.ts          # the embedded market card (FR-CARD-*)
    post-card.ts            # post + engagement + comments
    sidebar.ts              # navigation, Market Movers, Who to Follow
    signin-modal.ts         # auth modal
  journeys/                 # Section 5
  components-specs/         # Section 6
```

### 3.2 Selectors

Tests select elements by **`data-testid` attributes**, added to the production front end as it is built
(the prototype's class-based selectors are styling-coupled and must not be used). Test IDs follow
`area-element` naming: `card-buy-yes`, `card-amount-input`, `feed-composer`, `nav-portfolio`.

### 3.3 Traceability

Like the API suite, each spec carries the FR tags it verifies (e.g., `@FR-CARD-2 @FR-CARD-3`), so requirement
coverage is reportable across both suites together.

### 3.4 Authentication helper

A shared fixture performs wallet sign-in once per worker via the injected provider and stores the session
(storage state), so individual tests start authenticated without repeating the handshake. Tests that verify the
sign-in flow itself (J1) start from a clean state.

---

## 4. Test data

- The same canonical seed set as the integration suite (two markets, demo users, follow graph) — UI tests assert
  against known fixture values (e.g., the seeded market's price of 21¢ appears as "21% chance" on the card arc).
- Tests that mutate data (posting, trading, following) create their own entities and assert on them, never on
  shared fixtures, so parallel workers don't collide.
- Chain state: snapshot/revert between test files, as in the integration suite.

---

## 5. Critical user journeys

The release-gating set. Each journey is one spec, kept short and assertive; failures block deployment.

| #  | Journey                            | Steps and key assertions                                                                                                                                                                                                                                |
|----|------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| J1 | **Sign in with wallet**            | Open feed → Sign In → choose MetaMask → injected provider connects, chain switches to 1337 → UI shows authenticated state (FR-AUTH-1, FR-AUTH-4).                                                                                                        |
| J2 | **Trade from the feed card**       | Authenticated user scrolls feed → finds post with market card → presses *Buy Yes* → card flips → sets amount via +10 and slider → "To win" equals `amount/price` → confirms → success state; position visible in portfolio (FR-CARD-1..3, FR-PORT-2).      |
| J3 | **Trade from the trading page**    | Open market from Market Movers → chart renders, timeframe switch works → Buy tab → select outcome at displayed cent price → quick-amount +$20 → Trade → confirmation; price updates (FR-NAV-4, FR-TRD-1..3).                                              |
| J4 | **Post and engage**                | Compose a post (counter shows `n/500`; over-limit blocked) → publish → post appears at top of feed → second user likes and comments → counters update; comment thread shows the reply (FR-FEED-2..3, FR-FEED-5..7).                                       |
| J5 | **Follow and social graph**        | From Who to Follow, follow a creator → button toggles to *Following* → creator's posts appear in feed → creator's follower count incremented on their profile (FR-SOC-10..11, FR-NAV-5).                                                                  |
| J6 | **Create a market request**        | Open Create Market → fill name, description, photo upload, oracle-proof URL, type=Classic → CREATE → confirmation of submitted request (FR-CRT-1).                                                                                                       |
| J7 | **Portfolio reflects positions**   | User with seeded trades opens Portfolio → each position shows outcome, amount, price, value, and color-coded P&L (green gain / red loss) matching fixture math (FR-PORT-1..2).                                                                            |
| J8 | **Notifications**                  | Second user follows/likes/reposts → first user's Notifications page lists all three events with correct actor handles and links (FR-NOT-1).                                                                                                              |

## 6. Component-behavior specs

Focused specs for UI mechanics that journeys pass through but don't exhaustively exercise:

- **Market card** (`market-card.ts`): flip animation completes and form is interactive; close (×) flips back and
  resets; amount input, +1/+10 buttons, and slider stay in two-way sync; payout recalculates on every change;
  minimum amount enforced (FR-CARD-2..3).
- **Feed tabs**: Feed / People / Trending switch content without reload; People sections render with Follow
  buttons (FR-FEED-1).
- **Composer modal**: live character counter; attachment buttons present; Post disabled when empty (FR-FEED-3).
- **Media/comment modal**: opens from post media; carousel prev/next; comment input works inside the modal
  (FR-FEED-8).
- **Profile tabs**: Vogel / Liked / Ree-Vogel / Mentions each render the right content set; embedded market
  cards inside profile posts remain tradeable (FR-PROF-2).
- **Dark mode**: toggle switches theme and persists across reload via `localStorage` (FR-PROF-6).
- **Responsive navigation** (`mobile` project): hamburger opens off-canvas drawer; all nav items reachable;
  three-column content reflows to single column (FR-NAV-1..2).
- **404 page**: unknown route shows branded error with working "Go back to safety" (FR-NAV-7).
- **Infinite scroll**: scrolling to the spinner loads the next page of posts (FR-FEED-9).

## 7. Execution

### 7.1 Locally

```bash
docker compose -f docker-compose.test.yml up -d --wait
npx playwright test                      # all projects
npx playwright test --project=desktop    # fast loop while developing
npx playwright show-report
```

### 7.2 In CI

- **Pull requests:** journeys J1–J8 on `desktop` + `mobile` (Chromium) — the merge gate.
- **Nightly / release candidate:** full matrix (all four projects) + all component specs.
- Artifacts on failure: Playwright trace, video, and screenshot, retained with the CI run.
- Retries: **one** automatic retry in CI to absorb infrastructure hiccups; a test that needs the retry to pass
  is flagged for investigation — same flakiness policy as the API suite.

### 7.3 Manual smoke (per release)

A short manual pass with the **real MetaMask extension** against a staging deployment: connect, chain-switch
prompt to 1337 (or the target network post-MVP), sign-in signature, one real trade. This is the only place the
genuine extension UX is verified.

## 8. Open items

- **Front-end implementation pending** — the prototype is static; `data-testid` attributes and the injected-
  provider hook are requirements on the production front end. This document fixes the conventions now so the
  front end is built test-ready.
- **Visual regression** — screenshot-comparison (Playwright `toHaveScreenshot`) is a candidate for the glass-
  morphism UI once the design stabilizes; not part of the MVP gate.
- **Accessibility checks** — an automated a11y pass (axe-core) per page is recommended; to be scoped after MVP.
