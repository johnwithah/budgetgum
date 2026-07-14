// ─────────────────────────────────────────────────────────────────────────────
// create_link_token.js — step 1 of the Plaid handshake.
//
// Asks Plaid for a short-lived token that lets the Plaid Link widget open.
// Now requires a valid session — a stranger who finds your URL can't burn
// through your Plaid quota.
// ─────────────────────────────────────────────────────────────────────────────

const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');
const { requireAuth, handlePreflight } = require('./_auth');

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

  // ── THE GUARD ──────────────────────────────────────────────────────────────
  // No valid session cookie → 401, and we never touch Plaid.
  if (!requireAuth(req, res)) return;

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'budgetgum-user' },
      client_name: 'Budgetgum',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    res.status(200).json({ link_token: response.data.link_token });
  } catch (err) {
    // Surface Plaid's actual error code instead of swallowing it. Plaid returns
    // things like INVALID_API_KEYS or PRODUCTS_NOT_SUPPORTED, and knowing which
    // is the difference between a five-minute fix and an afternoon of guessing.
    const detail = err.response?.data || { message: err.message };
    console.error('create_link_token error:', JSON.stringify(detail));
    res.status(500).json({ error: 'Failed to create link token', plaid: detail });
  }
};
