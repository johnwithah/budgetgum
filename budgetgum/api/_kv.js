// _kv.js — the keys we store in Redis.
//
// Single-user app, so these are fixed strings rather than being namespaced per
// user. If Budgetgum ever had more than one user, these would become something
// like `plaid:access_token:${userId}` and every lookup would key off the session.

module.exports = {
  // Your whole budget — envelopes, transactions, settings. See state.js.
  STATE_KEY: 'app:state',

  // The Plaid access token — the permanent key to reading your bank data.
  // This is THE thing that used to live in your browser's localStorage and now
  // lives here instead. The browser never sees it again.
  ACCESS_TOKEN_KEY: 'plaid:access_token',

  // Cached account metadata (names, masks, balances) so the dashboard can render
  // without a round-trip to Plaid on every load.
  ACCOUNTS_KEY: 'plaid:accounts',

  // When we last asked Plaid to re-check the bank (and whether it refused), so
  // on-demand refreshes stay throttled. See requestRefresh in _plaid.js.
  REFRESH_KEY: 'plaid:last_refresh',

  // Push subscriptions — one per device that turned notifications on. Kept out
  // of app:state on purpose: that blob is last-write-wins from the browser, and
  // a stale tab saving would silently unsubscribe your phone.
  PUSH_SUBS_KEY: 'push:subscriptions',

  // Which notifications have already gone out (key → timestamp), so the
  // scheduled check says "Rent due in 3 days" once, not every two hours.
  PUSH_SENT_KEY: 'push:sent',

  // Registered passkeys (Face ID / Touch ID). Public keys only — the private
  // half never leaves your device's secure enclave.
  PASSKEYS_KEY: 'auth:passkeys',

  // One-time WebAuthn challenges, `${prefix}${purpose}`, expiring in 5 minutes.
  CHALLENGE_PREFIX: 'auth:challenge:',
};
