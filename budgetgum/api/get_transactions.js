// ─────────────────────────────────────────────────────────────────────────────
// get_transactions.js — pulls 30 days of transactions + balances.
//
// THE OLD VERSION took an access_token from the request body. Whatever the client
// sent, it used. That's backwards: it means the endpoint trusts the caller to
// hand it the key.
//
// THE NEW VERSION ignores the body entirely and looks the token up from Redis
// using the session. An attacker can't inject a token, and there's nothing for
// them to steal from the browser, because the browser doesn't have it.
// ─────────────────────────────────────────────────────────────────────────────

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { kv } = require('@vercel/kv');
const { requireAuth, handlePreflight } = require('./_auth');
const { ACCESS_TOKEN_KEY, ACCOUNTS_KEY } = require('./_kv');

const plaidClient = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
}));

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  // Note: req.body is never read. The token comes from OUR storage, not theirs.
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
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 30);

  try {
    const [txRes, balRes] = await Promise.all([
      plaidClient.transactionsGet({
        access_token: accessToken,
        start_date: startDate.toISOString().split('T')[0],
        end_date: today.toISOString().split('T')[0],
        options: { count: 100 },
      }),
      plaidClient.accountsBalanceGet({ access_token: accessToken }),
    ]);

    const transactions = txRes.data.transactions.map(t => ({
      id: t.transaction_id,
      desc: t.merchant_name || t.name,
      amount: Math.abs(t.amount),
      date: t.date,
      category: t.personal_finance_category?.primary || t.category?.[0] || 'Other',
      pending: t.pending,
      type: 'bank',
    }));

    const accounts = balRes.data.accounts.map(a => ({
      id: a.account_id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      balance: a.balances.current,
      available: a.balances.available,
      mask: a.mask,
    }));

    // Cache accounts so the dashboard can show balances without re-hitting Plaid.
    // Relevant on the free tier, where API calls are metered.
    try {
      await kv.set(ACCOUNTS_KEY, accounts);
    } catch { /* non-fatal — caching is a nice-to-have */ }

    res.status(200).json({ transactions, accounts });
  } catch (err) {
    const detail = err.response?.data || { message: err.message };
    console.error('get_transactions error:', JSON.stringify(detail));

    // ITEM_LOGIN_REQUIRED means your bank credentials changed or MFA expired —
    // the stored token is dead and you need to re-link. Worth flagging distinctly
    // so the UI can prompt you instead of showing a generic failure.
    const plaidCode = detail?.error_code;
    if (plaidCode === 'ITEM_LOGIN_REQUIRED') {
      await kv.del(ACCESS_TOKEN_KEY).catch(() => {});
      return res.status(400).json({ error: 'Bank needs re-linking', code: 'RELINK' });
    }

    res.status(500).json({ error: 'Failed to fetch data', plaid: detail });
  }
};
