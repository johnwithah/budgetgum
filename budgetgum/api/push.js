// ─────────────────────────────────────────────────────────────────────────────
// push.js — manage this device's notification subscription.
//
// GET  /api/push                                  → { configured, publicKey, devices }
// POST /api/push { action: "subscribe", subscription, timeZone, label }
// POST /api/push { action: "unsubscribe", endpoint }
// POST /api/push { action: "test" }               → sends a test notification
//
// One file, several actions, because Vercel's Hobby plan caps a deployment at
// 12 functions and every api/*.js file is one.
// ─────────────────────────────────────────────────────────────────────────────

const { requireAuth, handlePreflight } = require('./_auth');
const { pushConfigured, getSubscriptions, saveSubscriptions, sendToAll } = require('./_push');

// Only accept a well-formed subscription pointing at a real https push service.
function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function cleanTimeZone(tz) {
  if (typeof tz !== 'string') return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const subs = pushConfigured() ? await getSubscriptions() : [];
      return res.status(200).json({
        configured: pushConfigured(),
        publicKey: process.env.VAPID_PUBLIC_KEY || null,
        devices: subs.length,
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!pushConfigured()) return res.status(503).json({ error: 'Push is not configured on the server' });

    const { action } = req.body || {};

    if (action === 'subscribe') {
      const subscription = cleanSubscription(req.body.subscription);
      if (!subscription) return res.status(400).json({ error: 'Malformed subscription' });
      const subs = (await getSubscriptions()).filter(s => s.subscription.endpoint !== subscription.endpoint);
      subs.push({
        subscription,
        timeZone: cleanTimeZone(req.body.timeZone) || 'UTC',
        label: typeof req.body.label === 'string' ? req.body.label.slice(0, 60) : 'Device',
        createdAt: new Date().toISOString(),
      });
      await saveSubscriptions(subs);
      return res.status(200).json({ ok: true, devices: subs.length });
    }

    if (action === 'unsubscribe') {
      const endpoint = req.body.endpoint;
      const subs = (await getSubscriptions()).filter(s => s.subscription.endpoint !== endpoint);
      await saveSubscriptions(subs);
      return res.status(200).json({ ok: true, devices: subs.length });
    }

    if (action === 'test') {
      const result = await sendToAll({
        title: 'Budgetgum notifications are on',
        body: "You'll hear about bills before they're due.",
        url: '/',
        tag: 'test',
      });
      return res.status(200).json({ ok: true, ...result });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('push error:', err.message);
    return res.status(500).json({ error: 'Push request failed' });
  }
};
