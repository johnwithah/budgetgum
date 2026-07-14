// disconnect_bank.js — wipe the stored Plaid token.
//
// Useful if you want to re-link, switch banks, or just revoke access. Deletes the
// token from Redis; after this, get_transactions has nothing to work with.

const { kv } = require('@vercel/kv');
const { requireAuth, handlePreflight } = require('./_auth');
const { ACCESS_TOKEN_KEY, ACCOUNTS_KEY } = require('./_kv');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  try {
    await kv.del(ACCESS_TOKEN_KEY);
    await kv.del(ACCOUNTS_KEY);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('disconnect_bank error:', err.message);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
};
