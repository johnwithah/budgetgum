// ─────────────────────────────────────────────────────────────────────────────
// session.js — "am I logged in, and is a bank linked?"
//
// The frontend calls this on load to decide whether to show the lock screen or
// the app. Note what it does NOT return: the Plaid access token. The browser has
// no business knowing it. It only learns the boolean "a bank is connected."
// ─────────────────────────────────────────────────────────────────────────────

const { kv } = require('@vercel/kv');
const { isAuthenticated, handlePreflight } = require('./_auth');
const { ACCESS_TOKEN_KEY } = require('./_kv');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;

  if (!isAuthenticated(req)) {
    return res.status(200).json({ authenticated: false, bankConnected: false });
  }

  let bankConnected = false;
  try {
    const token = await kv.get(ACCESS_TOKEN_KEY);
    bankConnected = Boolean(token);
  } catch (err) {
    console.error('session kv.get failed:', err.message);
    // Fail closed on the bank flag — if we can't reach KV, don't claim connected.
  }

  res.status(200).json({ authenticated: true, bankConnected });
};
