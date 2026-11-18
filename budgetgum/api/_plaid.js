// ─────────────────────────────────────────────────────────────────────────────
// _plaid.js — the Plaid client + the shape we turn Plaid's data into.
//
// Shared by get_transactions.js (you tapping Sync) and notify.js (the scheduled
// check that sends push notifications), so both see transactions and accounts
// in exactly the same form. Underscore prefix = not an endpoint.
// ─────────────────────────────────────────────────────────────────────────────

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { kv } = require('@vercel/kv');
const { REFRESH_KEY } = require('./_kv');

const plaidClient = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
}));

function mapTransaction(t) {
  return {
    id: t.transaction_id,
    desc: t.merchant_name || t.name,
    // Preserve Plaid's sign convention: POSITIVE = money leaving (a debit/
    // purchase), NEGATIVE = money coming in (a deposit/credit). The app keys
    // off this: amount > 0 acts on envelopes, amount <= 0 is an inflow that's
    // only recorded. Don't Math.abs() this — it destroys the distinction.
    amount: t.amount,
    date: t.date,
    category: t.personal_finance_category?.primary || t.category?.[0] || 'Other',
    // Merchant branding, when Plaid has enriched this transaction. Not
    // always present — depends on the merchant and your Plaid plan — so the
    // app treats it as a bonus, never a requirement.
    logo: t.logo_url || null,
    website: t.website || null,
    pending: t.pending,
    type: 'bank',
  };
}

function mapAccount(a) {
  return {
    id: a.account_id,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    balance: a.balances.current,
    available: a.balances.available,
    mask: a.mask,
  };
}

// Every transaction in the window, not just the first page. transactionsGet
// returns at most `count` per call plus a `total_transactions`; a busy stretch
// used to silently drop whatever didn't fit in the first 100.
const PAGE_SIZE = 500;   // Plaid's maximum
async function fetchAllTransactions(accessToken, startDate, endDate) {
  let transactions = [], accounts = [], total = 0;
  do {
    const r = await plaidClient.transactionsGet({
      access_token: accessToken, start_date: startDate, end_date: endDate,
      options: { count: PAGE_SIZE, offset: transactions.length },
    });
    transactions = transactions.concat(r.data.transactions);
    accounts = r.data.accounts;
    total = r.data.total_transactions;
    if (!r.data.transactions.length) break;
  } while (transactions.length < total);
  return { transactions, accounts, total };
}

// ── "Check my bank now" ─────────────────────────────────────────────────────
// Plaid normally pulls from your bank on its own schedule — a few times a day —
// so a purchase that posted this afternoon can be invisible until tomorrow no
// matter how often you Sync. /transactions/refresh asks Plaid to go look right
// now. It's asynchronous: the call returns immediately and new transactions show
// up in transactionsGet a minute or so later.
//
// It may be a paid add-on on Plaid's production plan, so it's throttled: at
// most once per `minMinutes`, and if Plaid refuses (not enabled, unsupported
// bank) we don't ask again for a day.
const REFUSED_RETRY_MS = 24 * 60 * 60 * 1000;
async function requestRefresh(accessToken, minMinutes) {
  const last = await kv.get(REFRESH_KEY).catch(() => null);
  const since = last ? Date.now() - last.at : Infinity;
  if (last?.error && since < REFUSED_RETRY_MS) return { status: 'unavailable', error: last.error };
  if (since < minMinutes * 60000) return { status: 'throttled', lastAt: new Date(last.at).toISOString() };

  const at = Date.now();
  try {
    await plaidClient.transactionsRefresh({ access_token: accessToken });
    await kv.set(REFRESH_KEY, { at });
    return { status: 'requested' };
  } catch (err) {
    const error = err.response?.data?.error_code || err.message;
    console.error('transactionsRefresh failed:', error);
    await kv.set(REFRESH_KEY, { at, error }).catch(() => {});
    return { status: 'unavailable', error };
  }
}

module.exports = { plaidClient, mapTransaction, mapAccount, fetchAllTransactions, requestRefresh };
