// ─────────────────────────────────────────────────────────────────────────────
// notify.js — the scheduled check that sends push notifications.
//
// GET /api/notify            Authorization: Bearer <CRON_SECRET>
// GET /api/notify?dry=1      same, but only reports what it WOULD send
//
// Called every couple of hours by .github/workflows/notify.yml (a GitHub
// Actions schedule — not a Vercel cron, because Vercel crons need a vercel.json
// and this project deliberately has none).
//
// Each run:
//   1. pulls the last two weeks from Plaid (read-only — nothing is saved to
//      your budget; the app still imports when you open it and Sync)
//   2. asks _notifications.js what's worth saying
//   3. sends anything new, and records it so it's never said twice
//
// Quiet hours: nothing goes out between 9pm and 8am in your time zone (taken
// from the device that subscribed). Nothing is marked sent either, so the
// morning's first run delivers whatever was waiting.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { kv } = require('@vercel/kv');
const { STATE_KEY, ACCESS_TOKEN_KEY, PUSH_SENT_KEY, REFRESH_KEY } = require('./_kv');
const { plaidClient, mapTransaction, mapAccount, fetchAllTransactions, requestRefresh } = require('./_plaid');
const { pushConfigured, getSubscriptions, sendToAll } = require('./_push');
const { computeNotifications } = require('./_notifications');

const QUIET_START = 21;   // 9pm
const QUIET_END = 8;      // 8am
const MAX_PER_RUN = 5;    // a backlog arrives as a handful, not a flood
const KEEP_SENT_DAYS = 120;
// Ask Plaid to re-check the bank at most this often from the scheduled check,
// so "new transactions to sort" isn't stuck on Plaid's own (slower) schedule.
// What the refresh finds is picked up by the next run, two hours later.
const REFRESH_MIN_MINUTES = 6 * 60;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), 'utf8');
  const expected = Buffer.from(secret, 'utf8');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function localHour(timeZone) {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()));
}

async function fetchFromBank(accessToken, importSince) {
  const today = new Date();
  const twoWeeksAgo = new Date(today); twoWeeksAgo.setDate(today.getDate() - 14);
  const floor = twoWeeksAgo.toISOString().split('T')[0];
  const start = importSince && importSince > floor ? importSince : floor;
  const end = today.toISOString().split('T')[0];
  if (start > end) return { fresh: [], accounts: null };

  // transactionsGet returns account balances too, so no separate Balance call
  // (which Plaid bills per request) is needed.
  const r = await fetchAllTransactions(accessToken, start, end);
  return {
    fresh: r.transactions.filter(t => t.date >= start).map(mapTransaction),
    accounts: r.accounts.map(mapAccount),
    total: r.total,
  };
}

// Dry-run only: is the app's transaction list keeping up with the bank? Shows
// when Plaid last pulled from the bank, and every recent transaction Plaid has
// that the app doesn't — with the reason a Sync would skip it, if any.
async function syncHealth(accessToken, state, bank) {
  const health = { appLastSync: state.lastSync || null, importSince: state.importSince || null };
  health.lastRefreshRequest = await kv.get(REFRESH_KEY).catch(() => null);
  try {
    const item = await plaidClient.itemGet({ access_token: accessToken });
    const t = item.data.status?.transactions || {};
    health.plaidLastRefresh = t.last_successful_update || null;
    health.plaidLastFailedRefresh = t.last_failed_update || null;
  } catch (err) { health.itemError = err.response?.data?.error_code || err.message; }

  const inApp = new Set([...(state.transactions || []), ...(state.unmapped || [])].map(t => t.id));
  const ignored = new Set(state.ignored || []);
  health.plaidReturned = bank.fresh.length;
  health.plaidTotal = bank.total ?? null;
  health.newestInApp = (state.transactions || []).reduce((m, t) => (t.date > m ? t.date : m), '') || null;
  health.notInApp = bank.fresh
    .filter(t => !inApp.has(t.id))
    .map(t => ({ date: t.date, desc: t.desc, amount: t.amount, ...(t.pending && { pending: true }), ...(ignored.has(t.id) && { ignored: true }) }));
  return health;
}

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });

  const dry = req.query?.dry === '1';
  if (!pushConfigured()) return res.status(503).json({ error: 'VAPID keys are not set' });

  try {
    const subs = await getSubscriptions();
    if (!subs.length && !dry) return res.status(200).json({ skipped: 'no devices subscribed' });

    // Run all date math in your time zone, so "due tomorrow" means YOUR tomorrow
    // and not UTC's.
    const timeZone = subs[0]?.timeZone || 'UTC';
    process.env.TZ = timeZone;

    const hour = localHour(timeZone);
    const quiet = hour >= QUIET_START || hour < QUIET_END;
    if (quiet && !dry) return res.status(200).json({ skipped: 'quiet hours', timeZone, hour });

    const state = await kv.get(STATE_KEY);
    if (!state || !Array.isArray(state.envelopes)) return res.status(200).json({ skipped: 'no budget yet' });

    // Fresh bank data is a bonus. If Plaid is down or needs re-linking, bills
    // are still checked against what the app last synced.
    let bank = { fresh: [], accounts: null };
    let bankError = null;
    const accessToken = await kv.get(ACCESS_TOKEN_KEY);
    if (accessToken) {
      try { bank = await fetchFromBank(accessToken, state.importSince); }
      catch (err) { bankError = err.response?.data?.error_code || err.message; console.error('notify plaid error:', bankError); }
    }

    let refresh = null;
    if (accessToken && !dry) refresh = await requestRefresh(accessToken, REFRESH_MIN_MINUTES);

    const sent = (await kv.get(PUSH_SENT_KEY)) || {};
    const notes = await computeNotifications(state, { ...bank, sent });

    if (dry) {
      const sync = accessToken ? await syncHealth(accessToken, state, bank) : null;
      return res.status(200).json({ dry: true, timeZone, hour, quiet, bankError, sync, notifications: notes });
    }

    const delivered = [];
    for (const n of notes.slice(0, MAX_PER_RUN)) {
      const result = await sendToAll({ title: n.title, body: n.body, url: n.url, tag: n.tag });
      if (result.sent > 0) {
        n.keys.forEach(k => { sent[k] = Date.now(); });
        delivered.push(n.title);
      }
    }

    const cutoff = Date.now() - KEEP_SENT_DAYS * 86400000;
    for (const k of Object.keys(sent)) if (sent[k] < cutoff) delete sent[k];
    await kv.set(PUSH_SENT_KEY, sent);

    return res.status(200).json({ ok: true, delivered, pending: Math.max(0, notes.length - MAX_PER_RUN), bankError, refresh: refresh?.status });
  } catch (err) {
    console.error('notify failed:', err);
    return res.status(500).json({ error: 'Notify run failed', detail: err.message });
  }
};
