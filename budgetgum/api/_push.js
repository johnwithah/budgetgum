// ─────────────────────────────────────────────────────────────────────────────
// _push.js — Web Push plumbing shared by push.js and notify.js.
//
// HOW WEB PUSH WORKS
// ------------------
// When you turn notifications on, your browser (Safari on iPhone, once the app
// is on your Home Screen) hands us a "subscription": a URL at Apple's / Google's
// push service plus encryption keys. To notify you, we encrypt a small JSON
// payload with those keys and POST it to that URL, signed with our VAPID key so
// the push service knows it's really us. The service worker (public/sw.js)
// receives it on your phone and shows the notification — even with the app
// closed.
//
// VAPID keys live in env vars. Generate a pair once with:
//   npx web-push generate-vapid-keys
// ─────────────────────────────────────────────────────────────────────────────

const webpush = require('web-push');
const { kv } = require('@vercel/kv');
const { PUSH_SUBS_KEY } = require('./_kv');

function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let vapidSet = false;
function ensureVapid() {
  if (vapidSet) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:budgetgum@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  vapidSet = true;
}

async function getSubscriptions() {
  return (await kv.get(PUSH_SUBS_KEY)) || [];
}

async function saveSubscriptions(subs) {
  await kv.set(PUSH_SUBS_KEY, subs);
}

// Send one payload ({title, body, url, tag}) to every subscribed device.
// Subscriptions the push service says are gone (404/410 — the app was deleted
// from the Home Screen, or permission was revoked) are pruned on the spot.
async function sendToAll(payload) {
  ensureVapid();
  const subs = await getSubscriptions();
  const dead = new Set();
  let sent = 0;

  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 60 * 60 * 12 });
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) dead.add(s.subscription.endpoint);
      else console.error('push send failed:', err.statusCode, err.body || err.message);
    }
  }));

  if (dead.size) {
    await saveSubscriptions(subs.filter(s => !dead.has(s.subscription.endpoint)));
  }
  return { sent, pruned: dead.size, devices: subs.length };
}

module.exports = { pushConfigured, getSubscriptions, saveSubscriptions, sendToAll };
