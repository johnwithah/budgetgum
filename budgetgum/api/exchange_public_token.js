// ─────────────────────────────────────────────────────────────────────────────
// exchange_public_token.js — step 3 of the handshake, and the security-critical one.
//
// THE OLD VERSION returned the access_token to the browser, which stashed it in
// localStorage. That meant the permanent key to your bank data sat in plaintext
// on your phone, readable by any script on the page.
//
// THE NEW VERSION writes it straight to Redis and returns nothing but `{ok: true}`.
// The browser never sees it. Not once.
// ─────────────────────────────────────────────────────────────────────────────

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { kv } = require('@vercel/kv');
const { requireAuth, handlePreflight } = require('./_auth');
const { ACCESS_TOKEN_KEY } = require('./_kv');

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

  const { public_token } = req.body || {};
  if (!public_token) return res.status(400).json({ error: 'Missing public_token' });

  try {
    const response = await plaidClient.itemPublicTokenExchange({ public_token });
    const accessToken = response.data.access_token;

    // Store server-side. This is the whole point.
    await kv.set(ACCESS_TOKEN_KEY, accessToken);

    // Return a boolean, not the token.
    res.status(200).json({ ok: true });
  } catch (err) {
    const detail = err.response?.data || { message: err.message };
    console.error('exchange_public_token error:', JSON.stringify(detail));
    res.status(500).json({ error: 'Token exchange failed', plaid: detail });
  }
};
