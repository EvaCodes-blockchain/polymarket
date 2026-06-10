# PolyMarket Social ("Justify") — Functional Requirements

**Document version:** 1.0
**Date:** 2026-06-11
**Source:** Analysis of the HTML prototype in `html-polymarket-social-prototype/`
**Product name in prototype:** *Justify — Trade Smarter, Together*

---

## 1. Introduction

### 1.1 Purpose
This document describes the functionality that the PolyMarket Social platform provides to its users, as expressed by the HTML/CSS/JS prototype. It is intended as the functional baseline for implementing the production application.

### 1.2 Product concept
PolyMarket Social ("Justify") is a **social prediction-market platform**: a Twitter-like social network where the core shareable object is a **prediction market**. Users post ideas, discuss them, follow creators — and trade directly on markets embedded inside the social feed. The platform targets on-chain settlement on the **Base** network (chain ID 8453) with wallet-based authentication.

### 1.3 Scope of the prototype
The prototype consists of 11 static pages that demonstrate the intended UI and interaction flows:

| Page | File | Purpose |
|------|------|---------|
| Feed (home) | `index.html` | Social feed, creator discovery, trending content |
| Markets / Explore | `market.html` | Prediction-market discovery list |
| Trading page (trader view) | `trade.html` | Full trading interface for a single market |
| Trading page (creator view) | `trade_founder.html` | Same interface for a market's creator |
| Portfolio | `portfolio.html` | User positions and P&L |
| Profile | `profile.html` | Public user profile with content tabs |
| Edit profile / Settings | `edit-profile.html` | Account settings |
| Notifications | `notification.html` | Activity notifications |
| Create market | `create.html` | New market submission form |
| Help Center | `help.html` | Support request form |
| Error page | `404.html` | Not-found page |

Some links reference pages not present in the prototype (`explore.html`, `tags.html`, `login.html`); these are treated as planned functionality.

### 1.4 Terminology

| Term | Meaning |
|------|---------|
| **Market** | A prediction market on a future event with two outcomes (Yes/No or team A/team B), each priced in cents (0–100¢) representing implied probability. |
| **Vogel** | The prototype's name for a post (analogous to a "tweet"). |
| **Ree-Vogel** | A repost of another user's post. |
| **Market card** | An embeddable widget representing a market inside a post, with quick-trade capability. |
| **Founder / creator** | The user who created a market. |
| **Chance** | The implied probability of the leading outcome, shown as a circular progress arc (e.g., "21% chance"). |

---

## 2. User roles

| Role | Description | Capabilities |
|------|-------------|--------------|
| **Visitor (unauthenticated)** | Anyone browsing the site | Browse feed, markets, profiles; prompted to sign in for actions |
| **Registered user (trader)** | Authenticated via Google, email, or wallet | All social actions, trading, portfolio, market creation requests |
| **Market creator ("founder")** | A registered user who owns one or more markets | All trader capabilities, plus a creator view of their own markets |

---

## 3. Authentication and onboarding

### FR-AUTH-1 — Sign-in entry point
A **Sign In** button is available in the navigation sidebar on every page and opens a sign-in modal ("Welcome to Justify").

### FR-AUTH-2 — Google OAuth sign-in
Users can authenticate with Google ("Continue with Google") via OAuth 2.0 / OpenID Connect (scopes: `openid email profile`), with a redirect to the platform's auth callback (`https://justify.market/auth/callback`).

### FR-AUTH-3 — Email sign-in
Users can enter an email address and press **Continue** to begin an email-based sign-in/registration flow.

### FR-AUTH-4 — Crypto wallet sign-in
Users can authenticate by connecting a crypto wallet. Supported providers:
- **MetaMask** (injected `window.ethereum` provider)
- **Trust Wallet** (injected provider)
- **Coinbase Wallet** (Coinbase Wallet SDK)
- **WalletConnect** (WalletConnect provider)

On connection the application must:
1. Request account access from the wallet.
2. Verify the connected chain and **switch the wallet to Base (chain ID 8453)** if needed.
3. On success, continue the login flow (prototype redirects to `/login.html`).
4. On failure, show an error message to the user.

### FR-AUTH-5 — Legal consent
The sign-in modal displays "By continuing, you agree to our Terms and Privacy" with links to the Terms of Service and Privacy Policy.

### FR-AUTH-6 — Language selection
A language-selection modal lets the user choose the interface language. Prototype options: Hindi, English (default), Kannada, Tamil, Punjabi, Turkish, French, Other. The choice is confirmed with a Submit button.

---

## 4. Navigation and layout

### FR-NAV-1 — Global three-column layout
Every primary page uses a consistent layout:
- **Left sidebar** — main navigation (fixed on desktop, off-canvas drawer behind a hamburger button on mobile).
- **Center column** — page content.
- **Right sidebar** — search, "Market Movers" (trending markets), and "Who to follow" suggestions.

### FR-NAV-2 — Main navigation items
The left sidebar provides, with icons and an active-state highlight:
1. **Feed** → home page
2. **Markets** → market discovery
3. **Portfolio** → user positions
4. **Notifications** → activity feed
5. **My Profile** → own profile
6. **Create Market** → market creation form
7. **Settings** → edit profile / settings
8. **Help Center** → support
9. **Sign In** button (when unauthenticated)

### FR-NAV-3 — Global search
A search input ("Search Justify") is present in the right sidebar of every page, intended to search users, posts, and markets.

### FR-NAV-4 — Market Movers widget
The right sidebar shows the top trending markets (4 in the prototype). Each entry shows: creator handle, **Live** status indicator, market question, related hashtags (e.g., `#war #ukraine`, `#crypto #eth`), and a thumbnail image. Each entry links to that market's trading page. A **Show More** link leads to the full explore listing.

### FR-NAV-5 — Who to Follow widget
The right sidebar suggests accounts to follow. Each suggestion shows avatar, display name, verified badge, handle, descriptor/category (e.g., "Promoted", "Influencer", "Football Player"), and a Follow button (see FR-SOC-10).

### FR-NAV-6 — Footer
Every page footer shows a copyright line and social-network links (Facebook, Twitter/X, LinkedIn, YouTube, Instagram).

### FR-NAV-7 — 404 error page
Unknown routes show a branded error page ("Oh no! Where did you go?") with an illustration and a **Go back to safety** button returning to the feed.

---

## 5. Social feed (home page)

### FR-FEED-1 — Feed tabs
The home page content is organized into three pill tabs:
- **Feed** — posts from followed accounts / main timeline (default).
- **People** — account discovery, grouped into curated sections: *People you can follow*, *Popular*, *News Papers & Channels*, *Politicians*. Each entry shows avatar, name, verified badge, handle, role/descriptor, optional "Promoted" label, and a Follow button.
- **Trending** — trending posts.

### FR-FEED-2 — Post composer entry
At the top of the feed, an inline input ("Post your crypto ideas") opens the post-composition modal.

### FR-FEED-3 — Post composition modal
The composer provides:
- A text area ("What's on your mind…") with a **500-character limit** and a live character counter (`0/500`).
- Attachment tools: **insert link**, **insert image**, **embed video**.
- A **Post** button to publish.

### FR-FEED-4 — Follow Creators carousel
A horizontally swipeable carousel of recommended creators (e.g., FC Real Madrid, vitalik.eth, Leo Messi, Cobie, satoshi). Each card shows avatar, verified badge, name, descriptor, and a Follow toggle. The carousel is responsive (number of visible cards adapts to screen width).

### FR-FEED-5 — Post card content
Each post in the feed displays:
- Author avatar, display name, **verified badge** (for verified accounts), handle (`@username`), and publication timestamp.
- Post text; optionally an image and/or an **embedded market card** (Section 7).
- An options dropdown (⋮) with: **Edit**, **Delete**, **Embed Vogel** (embed the post elsewhere), **Share via another apps**.

### FR-FEED-6 — Post engagement
Each post shows interactive engagement counters:
- **Like** (e.g., 30.4k)
- **Comment** (e.g., 4.0k)
- **Repost** (e.g., 617)
- **Share**

### FR-FEED-7 — Inline comments
Below each post:
- A comment input ("Write Your comment") with the current user's avatar.
- A comment thread; each comment shows the commenter's avatar, name (linked to their profile), text, relative timestamp (e.g., "1h", "20min"), and **Like** / **Reply** actions.

### FR-FEED-8 — Comment / media modal
Clicking into a post's media opens a detail modal combining an image carousel (with slide indicators and prev/next controls) on the left and the post header, scrollable comment thread, engagement metrics, and a comment input on the right.

### FR-FEED-9 — Infinite scrolling
The feed shows a loading spinner at the bottom, indicating progressive/infinite loading of further content.

---

## 6. Social graph

### FR-SOC-10 — Follow / unfollow
A Follow control appears wherever an account is displayed (creator carousel, People tab, Who to Follow, profiles). It toggles between **+ Follow** and **Following** states.

### FR-SOC-11 — Followers / following lists
Profiles display follower and following counts (e.g., "391k Followers", "3 Following") with preview rows of member avatars, implying navigable follower/following lists.

### FR-SOC-12 — Verified accounts
Accounts can carry a verification badge displayed next to the name everywhere the account appears.

### FR-SOC-13 — Mentions and hashtags
Posts support `@mentions` (surfaced in the profile **Mentions** tab) and `#hashtags` (surfaced as "Trending with #…" in market/trend listings).

---

## 7. Embedded market cards (social trading widget)

The market card is the platform's signature component: a prediction market embedded directly in a post, tradeable in place.

### FR-CARD-1 — Card front (market summary)
The front face shows:
- Market thumbnail image.
- Market title (linked to the full trading page).
- Short description.
- Metadata row: **trading volume** (e.g., "$6M Vol.") and **event/closing date-time** (e.g., "23.08.2025 18.00").
- **Chance arc** — a circular SVG progress indicator with the implied probability (e.g., "21% — chance").
- Two outcome buttons, labeled per market: generic (**Buy Yes** / **Buy No**) or named outcomes (**Buy Barcelona** / **Buy RealMadrid**), styled green (yes) and red (no).

### FR-CARD-2 — Card flip to quick-trade form
Pressing an outcome button flips the card (3D animation) to reveal an order form for the chosen side:
- **Amount** numeric input (default 10, minimum 1).
- Quick-increment buttons **+1** and **+10**.
- A range slider (1–100) kept in two-way sync with the amount input.
- A confirm button titled **Buy [outcome]** showing the projected payout: **"To win: $X.XX"**.
- A close (×) button that flips the card back and resets the form.

### FR-CARD-3 — Payout calculation
The projected payout updates live on every amount change: `payout = amount / outcome price` (e.g., price 0.21 for Yes, 0.80 for No in the prototype), formatted to two decimals.

---

## 8. Market discovery

### FR-MKT-1 — Explore / markets list
The Markets page presents a scrollable list of live markets. Each entry shows: creator handle, **Live** status, market question, "Trending with" hashtags, and a thumbnail. Entries link to the market's trading page.

### FR-MKT-2 — Market categories via hashtags
Markets are associated with topical hashtags (e.g., `#war`, `#ukraine`, `#barcelona`, `#elclassico`, `#crypto`, `#eth`, `#btc`) used for trend grouping and discovery.

### FR-MKT-3 — Market domains
The prototype demonstrates markets across domains: sports (El Clásico), geopolitics (Russia–Ukraine ceasefire), crypto prices (ETH price, MicroStrategy BTC purchase), and company milestones ($2B valuation).

---

## 9. Trading page

A dedicated page per market (`trade.html`) with full trading functionality.

### FR-TRD-1 — Market header
Shows the market title and key stats: total volume (e.g., "$6M Vol") and event/close date-time.

### FR-TRD-2 — Price chart
An interactive price chart (Chart.js canvas) with timeframe selectors: **1H, 6H, 1D, 1W, 1M, ALL** (ALL default).

### FR-TRD-3 — Order ticket
The trading panel provides:
- **Buy / Sell** tabs.
- An **order type** selector (dropdown, "Market" shown; limit orders implied).
- Outcome selector buttons showing live prices in cents (e.g., **Barcelona 38¢** / **Real Madrid 63¢**), green/red styled.
- **Amount** input (USD).
- Quick-amount buttons: **+$1, +$20, +$100, Max**.
- A primary **Trade** button to submit the order.

### FR-TRD-4 — Market discussion
The trading page embeds the full social layer for the market: engagement counters (likes, comments, reposts, share) and a threaded comment section identical to feed posts (FR-FEED-7).

### FR-TRD-5 — Creator view of a market
The market creator sees the same trading page for their own market (`trade_founder.html`, e.g., "@founder"'s Russia–Ukraine market, $14M volume). The prototype differentiates the view by context (creator's market, wallet-connection flow present); production should extend it with creator controls (market management/resolution — see Section 15, Gaps).

---

## 10. Market creation

### FR-CRT-1 — Create-market form
A "Send your request" form allows any user to propose a new market with:

| Field | Type | Notes |
|-------|------|-------|
| **Market name** | text | Market question/title |
| **Description** | text | Market details |
| **Market photo** | file upload | Thumbnail image |
| **Oracle proof** | URL | Source (`https://…`) that will be used to resolve the market |
| **Market type** | radio | **FUN**, **Classic**, **Challenge** |

A full-width **CREATE** button submits the request. The wording ("Send your request") implies creation is a moderated/approved flow rather than instant publication.

---

## 11. Portfolio

### FR-PORT-1 — Portfolio identity header
The portfolio page shows the user's profile summary: avatar, name, verified badge, handle, bio, website link, join date, and follower/following counts.

### FR-PORT-2 — Position cards
For each market in which the user holds a position, a card shows the market summary (title, description, volume, close time, chance arc) plus a **"Your Position"** block listing, per outcome held:

| Field | Example |
|-------|---------|
| Outcome name | BARCELONA / REAL MADRID / YES / NO |
| Amount (shares) | 120 |
| Current price | $0.85 |
| Total value | $102.00 |
| Unrealized P&L | +12.5% (+$24.30) — green for gains, red for losses |

### FR-PORT-3 — Social context on positions
Position cards retain the post's social features: options dropdown (Edit / Delete / Embed / Share), engagement counters, and comment threads.

---

## 12. User profile

### FR-PROF-1 — Profile header
A public profile shows: avatar, display name, verified badge, handle, **Follow/Following** button (on others' profiles), multi-line bio, website link, join date, follower/following counts with avatar previews, and a **Share profile** action. A back button returns to the previous page.

### FR-PROF-2 — Profile content tabs
Four tabs organize the user's content:
1. **Vogel (N)** — the user's own posts, with post count.
2. **Liked** — posts the user has liked.
3. **Ree-Vogel** — posts the user has reposted.
4. **Mentions** — posts mentioning the user.

All tabs render full post cards including embedded market cards with quick-trade (Section 7).

### FR-PROF-3 — Edit profile
The settings page provides an "Edit Profile" form:
- **Name** (text)
- **Date of birth** (date)
- **Email** (email)
- **Password** (password)
- **Gender** (radio: Male / Female / Prefer not to say)
- **SAVE** button.

### FR-PROF-4 — Password confirmation
Sensitive changes require re-entering the password in a dedicated "Confirm your password" section.

### FR-PROF-5 — App settings
Toggle switches for:
- **Autoplay videos on feed**
- **Notifications** (enable/disable)

### FR-PROF-6 — Dark mode
A theme switch toggles between light and dark mode; the choice persists across sessions (stored in `localStorage`).

---

## 13. Notifications

### FR-NOT-1 — Notification feed
A chronological list of activity notifications. Each item identifies the acting user (handle) and the event, and links to the relevant content. Types demonstrated in the prototype:
- **New friend / follow accepted** — "@founder accepted your friends request"
- **Like** — "@leo liked your market"
- **Repost** — "@satoshi reposted your post"

Production should extend this set with comment, mention, market-resolution, and order-fill notifications (see Gaps).

---

## 14. Help center

### FR-HELP-1 — Support request form
A "Send your request" contact form with:
- **Name** (text)
- **Email** (email)
- **Text** (textarea — request description)
- **SEND** button.

---

## 15. Known gaps and prototype limitations

These items are referenced or implied by the prototype but not implemented; they should be resolved during specification of the production system:

1. **Missing pages:** `explore.html` (Show More target), `tags.html` (linked from some "Create Market" buttons), `login.html` (wallet-connect redirect target) do not exist in the prototype.
2. **Creator controls:** `trade_founder.html` is visually identical to the trader view; market management (edit, pause, resolve, creator fee earnings) is implied but unspecified.
3. **Order book / limit orders:** the order-type dropdown shows "Market" only; limit-order UX and order-book display are not designed.
4. **Sell flow:** the Sell tab exists but its form behavior is not differentiated from Buy.
5. **Portfolio extras:** balances, deposits/withdrawals, open orders, and trade history are not present.
6. **Search results:** the search field exists, but no results page is designed.
7. **Static data:** all prices, counts, and feeds are hard-coded; chart data is not bound.
8. **Form-field issues to correct in implementation:** the create-market description and oracle-proof inputs use `type="email"`, duplicate element IDs exist, and the oracle-proof placeholder is misspelled (`htpps://`).
9. **Notification management:** no mark-as-read, filtering, or settings granularity.
10. **Moderation/admin:** no admin or moderation interfaces exist for the market-approval flow implied by FR-CRT-1.

---

## 16. Technical context (informative)

- **Front-end stack of the prototype:** Bootstrap 5, jQuery 3.6, Slick carousel, Chart.js, Material Icons, Icofont; glass-morphism dark UI.
- **Web3:** Web3.js, Coinbase Wallet SDK, WalletConnect v1; target chain **Base mainnet (8453)** via Infura RPC.
- **Auth:** Google Identity Services (OAuth 2.0 / OIDC popup flow).
- **Responsive design:** desktop three-column layout collapses to a single column with off-canvas navigation on mobile; carousels adapt slide counts per breakpoint.
