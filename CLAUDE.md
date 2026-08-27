# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Budgetgum — a single-user personal envelope-budgeting PWA. It links one bank account via Plaid, and every "safe to spend" figure is derived live from the real checking balance minus money reserved in envelopes. There is no multi-user support anywhere in the stack (see `api/_kv.js`) — session, Plaid token, and budget state are all singletons.

## Tech stack

- **Frontend**: Create React App (`react-scripts` 5), plain React (no router, no state library) — one giant `src/App.js` component tree, inline `style={}` objects + a single injected `<style>` CSS block (`CSS` in App.js). PWA via `public/manifest.json` (install-to-homescreen, standalone display).
- **Backend**: Vercel serverless functions under `api/*.js` (CommonJS, `module.exports = async (req, res) => {...}`, one file = one route). No framework — hand-rolled routing, CORS, and auth per file.
- **Data layer**: Upstash Redis via `@vercel/kv` — one JSON blob per resource, no schema/ORM.
- **Bank data**: Plaid (`plaid` SDK) — Transactions product only.
- **Auth**: A single shared app password (bcrypt hash in `APP_PASSWORD_HASH` env var), not per-user accounts. Sessions are signed cookies, not stored server-side (see `api/_auth.js`).

## Commands

```bash
npm start   # react-scripts dev server (frontend only — /api/* routes need Vercel to serve them, see below)
npm run build  # production build to build/
```

There is no test suite, linter config beyond CRA's default `eslintConfig: { extends: ["react-app"] }`, and no `vercel dev` script defined — to exercise the `api/*` routes locally you'd need `vercel dev` (not currently in package.json).

## Required environment variables (Vercel project settings, not committed anywhere)

- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (`sandbox` | `development` | `production`)
- `APP_PASSWORD_HASH` — bcrypt hash of the app password (the plaintext password is never stored)
- `SESSION_SECRET` — HMAC key for signing session cookies
- Vercel KV / Upstash Redis credentials, auto-injected when a KV store is attached to the project (`@vercel/kv` reads them implicitly)

## Deploy workflow

- **Push to `main` on GitHub → Vercel auto-deploys.** There is no separate staging step or CI; a push is a deploy.
- The Vercel project's **root directory must stay set to the repo root** (this is a CRA + `/api` monorepo-shaped layout, not a nested app — misconfiguring root directory breaks the API routes).
- **`vercel.json` must stay deleted.** A prior `vercel.json` broke routing/build for this project shape; do not re-add one to "fix" a deploy issue without understanding why it was removed — investigate the actual Vercel build/route config first.
- Framework preset: Create React App.

## The core idea (read `src/engine.js` first)

`engine.js` is pure math — no React, no side effects, deliberately over-commented because the money logic is the entire point of the app. Almost nothing is stored as a checkbox or flag; nearly everything is *derived every render* from two inputs:

1. **Envelopes** — the plan.
2. **Transactions from Plaid** — what actually happened.

"Is this bill paid?" is answered by asking the transaction list, not by reading a stored boolean. This means it can never drift out of sync with the bank and never needs manual resetting — except where a manual override explicitly exists (see Manual overrides below).

`src/App.js` (~3000 lines) is the entire UI: all screens, sheets, and forms as functions in one file, all reading from `engine.js` for calculations and from `useCloudState.js` for persistence. There is no component-file-per-feature split — when working in App.js, use `grep -n "^function "` to jump between sections (LockScreen, PlaidButton, App, EnvIcon, EnvelopeTransactions, IncomeView, TransactionDetail, SyncDot, SettingsSheet, EmptyState, SpendingView, EnvCard, EnvelopesView, BillsView, DebtCard, EnvelopeForm, EnvelopeDetail, FundSheet, AssignSheet, Sheet).

## The four envelope types

Defined in `engine.js` as `TYPES` / `TYPE_META`:

| Type | Behavior |
|---|---|
| **spending** | A monthly budget that resets every calendar month. No due date. Tracked via `spentThisMonth`/`spentInMonth`/`spendingHistory`. Refunds *net against* spending if you assign them back to the envelope (a paycheck deposit never does, since it's never assigned). |
| **recurring** | A fixed bill on a schedule (monthly/weekly/annual due day). Shows in the Bills tab, has a paid/unpaid state each period, can autopay. Amount can be manually set or **auto-learned** from payment history (`billAmountStats`/`autoAmount` flag). |
| **debt** | A balance to pay *down* to zero by a target date. Tracks `currentBalance`/`originalBalance`, computes a suggested payment (`suggestedPayment`), schedule variance (ahead/behind pace), and has a dedicated **0% promo APR cliff warning** (`promoRisk`) — the one feature the code comments call out as "actually worth money." |
| **goal** | A balance to build *up* to a target by a date. Same payoff math shape as debt, opposite direction. |

`isBill(type)` = recurring or debt (both appear in the Bills tab and support autopay/paid-state). `hasTarget(type)` = debt or goal (both track a running balance toward a deadline and get `suggestedPayment`/`progress`).

## Data model

State is one JSON object (see `EMPTY_STATE` in `useCloudState.js` and `EMPTY` in `api/state.js` — **keep these two in sync if the shape changes**):

```
{
  envelopes: [...],      // the plan
  transactions: [...],   // Plaid transactions + manually-added deposits, assigned or not
  accounts: [...],       // cached Plaid account balances (for checking balance display)
  unmapped: [...],       // transactions Plaid returned that couldn't be auto-matched to an envelope — the "sort queue"
  ignored: [...],        // transaction ids the user deleted — never re-imported on next sync
  lastSync: "ISO string",
  importSince: "2026-07-14",  // sync never pulls bank data older than this (user-configurable in Settings)
  autoLockMinutes: 10,        // idle auto-lock timeout, 0 = never
}
```

An **envelope** carries type-specific fields (see `EnvelopeForm` in App.js for the full field set): `id`, `type`, `name`, `icon`/`color`/`website`/`logoUrl`, `funded` (money currently reserved), plus per-type fields — `monthlyBudget` (spending), `billAmount`/`autoAmount`/`frequency`/`dueDay`/`annualDate`/`autopay`/`autopayLeadDays`/`paymentUrl` (recurring/bill), `currentBalance`/`originalBalance`/`targetAmount`/`targetDate`/`minimumPayment`/`promoEndDate`/`postPromoAPR`/`startDate` (debt/goal), plus free-form `note` and a `flagLabel`/`flagAmount` tag ("Sydney owes $100") for money situations too irregular to model structurally. `matchPatterns` is a learned list of normalized merchant strings used to auto-assign future transactions (`matchEnvelope`).

A **transaction** carries Plaid's sign convention unmodified: **positive = outflow (debit/charge), negative/zero = inflow (deposit/credit)**. Never `Math.abs()` this — several past bugs (see `convertToDeposit`, `fixAllDeposits` in App.js) exist specifically to repair transactions imported before this convention was enforced. `envelopeId: null` + negative amount = income (see Income below). A transaction may carry a `periodOverride` (an ISO due-date string) that force-assigns which bill period it counts toward, overriding the automatic nearest-due-date heuristic.

## Funding, Safe to Spend, and the funded-balance carryover

Three zones of money (see the "THE LOCK" and "SAFE TO SPEND" sections of `engine.js`):

- **SAFE** — sitting in checking, unallocated. `safeToSpend(envelopes, checkingBalance) = checkingBalance - totalFunded(envelopes)`.
- **FUNDED** — reserved in an envelope (`env.funded`). Still physically in checking, but spoken for; can be pulled back via `unfund()` unless locked.
- **LOCKED** — an autopay ACH is in flight (`isLocked`). The money is leaving whether the budget agrees or not, so it stops counting as recoverable.

`env.funded` **carries over** — it is not reset monthly. It only changes when: (a) you manually `fund()`/`unfund()` it, (b) the auto-fund effect in App.js pulls from Safe to Spend once an autopay bill locks, or (c) a real payment clears and `applyPayments()` settles it — bills/debts/goals zero out or adjust `funded` when a matching transaction posts (see `applyPayments`/`unapplyPayments` in App.js, which are exact mirror-image reversals of each other so moving/deleting/reassigning a transaction never leaves balances drifted).

Spending-envelope funding vs. spending are **fully decoupled**: `spentThisMonth`/`spendingHistory` only look at transactions and reset conceptually each month; `env.funded` for a spending envelope is the real carried-over cash reserve and is never reset by the calendar. `fundingGap()` tells you how much more to fund a spending envelope to fully cover this month's plan.

**Auto-fund on lock**: a `useEffect` in App.js (keyed on an `autofundKey` fingerprint, ticking every 60s) automatically pulls from Safe to Spend into any bill that has just locked and is underfunded — up to what's actually available. This was rewritten specifically because the original version only re-ran on envelope/transaction *count* changes and could sleep through a lock event that happened while the app sat open.

## Manual overrides (the deliberate escapes from "everything is derived")

- `manualPaidPeriods` (array of due-date keys) / legacy `manualPaidPeriod` — mark a bill paid without a matching transaction (checks, cash, Plaid lag). `isPaid()` checks this OR a real cleared payment.
- `periodOverride` on a transaction — pin a payment to a specific bill period when the nearest-due heuristic gets it wrong (paying two months at once, catching up very late).
- `matchPatterns` — user-taught merchant strings for auto-assignment, grown via "remember this merchant" when manually sorting a transaction.
- `autoAmount` — opt a recurring bill into re-learning its `billAmount` from `billAmountStats()` every time a new payment clears, instead of using a value you typed once.

## Payment attribution (`periodDueFor` / `periodDueForTx`)

Deciding which billing period a payment belongs to is *nearest-due-date*, not "which date window does it fall in" — an exclusive-window approach misfiles payments made exactly on the due date, and a naive "snap forward from due-minus-grace" misfiles late payments into the wrong month AND makes the following month look pre-paid. Nearest-due degrades gracefully; a `periodOverride` always wins over the heuristic.

## Cloud-sync architecture (`src/useCloudState.js`)

Budget state lives on the server (Redis via `/api/state`), not primarily in the browser:

1. **On load**: render instantly from `localStorage` cache (key `bg_cache_v2`) → fetch real state from `/api/state` → server always wins once it responds, cache is overwritten.
2. **On edit**: state updates immediately in memory (UI never blocks on network) → cache written synchronously → save to `/api/state` debounced ~800ms → other devices see it next time they load.
3. **One-time migration**: if the server has no envelopes but the local cache does (first run after this architecture shipped), the cache is pushed up to the server rather than treated as stale.
4. **Conflict policy**: last-write-wins, no merge. Considered acceptable because this is explicitly a single-user app — the code comments are explicit that CRDTs/vector clocks would be overkill for "one person, occasionally two open tabs."
5. **Flush on unload**: `pagehide`/`visibilitychange` listeners force an immediate `keepalive` POST so a pending debounced save isn't lost if the tab closes mid-edit.
6. **Lock/logout wipes the local cache** (`clearCache()`) so balances don't sit in browser storage while signed out — re-entering requires the network anyway since the server is the source of truth.

`saveNow()` bypasses the debounce for cases that must land immediately (restore-from-backup, settings toggles like auto-lock minutes or import-since date).

## Auth model

- One shared app password. `POST /api/login` bcrypt-compares against `APP_PASSWORD_HASH`, then sets an httpOnly, `secure`, `sameSite=lax` cookie containing a `{exp}` payload + HMAC-SHA256 signature (`api/_auth.js`). No server-side session store — the signature *is* the verification, so logout is just deleting the cookie client-side (`api/logout.js`).
- `requireAuth(req, res)` is the guard every protected route calls first; on failure it has already written the 401, so callers just `return`.
- The Plaid `access_token` is **never sent to the browser**, ever — it's written straight to Redis in `exchange_public_token.js` and read server-side only in `get_transactions.js`. This was a deliberate fix from an earlier version that stored it in `localStorage`.
- Login has a crude in-memory (per-warm-instance, not durable) rate limiter — acknowledged in comments as not airtight against serverless cold starts, but enough to slow a naive brute force.
- Frontend auto-lock: idle timeout (`autoLockMinutes`, default 10, 0 = never) calls the real `/api/logout` (destroys the session), not just a UI cover screen. Activity tracking deliberately excludes `mousemove` (a nudged desk/cat shouldn't keep the app unlocked).

## Known gaps / deliberate non-features (don't "fix" these without understanding why)

- **No multi-user support.** Redis keys (`plaid:access_token`, `plaid:accounts`, `app:state`) are fixed singleton strings, not namespaced per user. Adding a second user requires re-keying all of these plus the auth model.
- **Federal holidays are not accounted for** in the business-day lock countdown (`subtractBusinessDays`) — a bank holiday can shift the real ACH lock one day later than the app shows.
- **Last-write-wins sync, no conflict resolution** — acceptable for one person, not for simultaneous multi-device edits.
- **In-memory login rate limiting** resets whenever the serverless function cold-starts; not a durable defense.
- **Historical spending-plan values aren't stored** — `spendingHistory()` reapplies the *current* `monthlyBudget` across past months, so changing your budget rewrites how past months are judged retroactively (documented as "good enough for spotting patterns").
- Legacy single-value fields (`manualPaidPeriod`, `bg_envelopes`/`bg_transactions`/etc. localStorage keys) are still read for backward compatibility with pre-cloud-sync installs; don't remove those fallbacks without confirming no one still has old cached state.
