// ─────────────────────────────────────────────────────────────────────────────
// get_transactions.js — pulls transactions + balances.
//
// The access token is read from Redis (via the session), never from the request
// body — so the browser never holds the key to your bank data.
//
// NEW: the client may pass a `since` date (YYYY-MM-DD). We won't fetch anything
// before it. This lets the app say "only import transactions from July 14 on,"
// which keeps old history from backfilling into envelopes you just created.
// `since` is validated hard — it can't be used to reach any data the session
// doesn't already own.
//
// `refresh: true` additionally asks Plaid to re-check the bank right now (see
// requestRefresh in _plaid.js). This response still carries what Plaid already
// had; anything the refresh turns up arrives a minute or so later, so the app
// syncs again quietly when `refresh.status` comes back "requested".
// ─────────────────────────────────────────────────────────────────────────────

const { kv } = require('@vercel/kv');
const { requireAuth, handlePreflight } = require('./_auth');
const { ACCESS_TOKEN_KEY, ACCOUNTS_KEY } = require('./_kv');
const { plaidClient, mapTransaction, mapAccount, fetchAllTransactions, requestRefresh } = require('./_plaid');

// The Sync button can trigger a bank refresh at most this often.
const REFRESH_MIN_MINUTES = 15;

// Accept only a clean YYYY-MM-DD string. Anything else → ignore it and fall back.
function cleanDate(s) {
  if (typeof s !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return s;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  let accessToken;
  try {
    accessToken = await kv.get(ACCESS_TOKEN_KEY);
  } catch (err) {
    console.error('kv.get failed:', err.message);
    return res.status(500).json({ error: 'Storage unavailable' });
  }
  if (!accessToken) {
    return res.status(400).json({ error: 'No bank connected', code: 'NO_BANK' });
  }

  const today = new Date();

  // Default lookback: 30 days. If the client sends a valid `since`, use the
  // later of (since) and (90 days ago) — we never pull more than 90 days,
  // both to stay light and because Plaid's window has limits.
  const ninetyAgo = new Date(today); ninetyAgo.setDate(today.getDate() - 90);
  const thirtyAgo = new Date(today); thirtyAgo.setDate(today.getDate() - 30);

  const since = cleanDate(req.body?.since);
  let startDate;
  if (since) {
    const sinceDate = new Date(since + 'T00:00:00');
    startDate = sinceDate > ninetyAgo ? sinceDate : ninetyAgo;
  } else {
    startDate = thirtyAgo;
  }

  const startStr = startDate.toISOString().split('T')[0];
  const endStr = today.toISOString().split('T')[0];

  try {
    const [txRes, balRes, refresh] = await Promise.all([
      fetchAllTransactions(accessToken, startStr, endStr),
      plaidClient.accountsBalanceGet({ access_token: accessToken }),
      req.body?.refresh === true ? requestRefresh(accessToken, REFRESH_MIN_MINUTES) : null,
    ]);

    // Backstop filter: even if Plaid returns an edge-case earlier date, drop
    // anything before the cutoff so nothing sneaks in behind your envelopes.
    const transactions = txRes.transactions
      .filter(t => t.date >= startStr)
      .map(mapTransaction);

    const accounts = balRes.data.accounts.map(mapAccount);

    try { await kv.set(ACCOUNTS_KEY, accounts); } catch {}

    res.status(200).json({ transactions, accounts, since: startStr, refresh });
  } catch (err) {
    const detail = err.response?.data || { message: err.message };
    console.error('get_transactions error:', JSON.stringify(detail));
    const plaidCode = detail?.error_code;
    if (plaidCode === 'ITEM_LOGIN_REQUIRED') {
      await kv.del(ACCESS_TOKEN_KEY).catch(() => {});
      return res.status(400).json({ error: 'Bank needs re-linking', code: 'RELINK' });
    }
    res.status(500).json({ error: 'Failed to fetch data', plaid: detail });
  }
};
