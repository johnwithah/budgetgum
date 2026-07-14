// _kv.js — the keys we store in Redis.
//
// Single-user app, so these are fixed strings rather than being namespaced per
// user. If Budgetgum ever had more than one user, these would become something
// like `plaid:access_token:${userId}` and every lookup would key off the session.

module.exports = {
  // The Plaid access token — the permanent key to reading your bank data.
  // This is THE thing that used to live in your browser's localStorage and now
  // lives here instead. The browser never sees it again.
  ACCESS_TOKEN_KEY: 'plaid:access_token',

  // Cached account metadata (names, masks, balances) so the dashboard can render
  // without a round-trip to Plaid on every load.
  ACCOUNTS_KEY: 'plaid:accounts',
};
