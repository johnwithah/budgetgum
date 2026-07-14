// ─────────────────────────────────────────────────────────────────────────────
// login.js — POST { password } → sets an httpOnly session cookie.
//
// The password is NEVER stored anywhere. What's stored (in the env var
// APP_PASSWORD_HASH) is a bcrypt hash — a one-way scramble. We hash what you
// typed and compare hashes. Even someone who reads your env vars can't reverse
// the hash back into your password.
// ─────────────────────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const { createSessionToken, sessionCookieHeader, handlePreflight } = require('./_auth');

// Crude in-memory rate limit. Serverless functions get recycled, so this is not
// airtight — but it does slow down a naive password-guessing loop hitting a warm
// instance. Real protection would need the rate-limit counter in KV.
const attempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function rateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);

  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) {
    console.error('APP_PASSWORD_HASH is not set');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });
  }

  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password required' });
  }

  let ok = false;
  try {
    ok = await bcrypt.compare(password, hash);
  } catch (err) {
    console.error('bcrypt.compare failed:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }

  if (!ok) {
    // Deliberately vague. Don't leak whether the hash exists, is malformed, etc.
    return res.status(401).json({ error: 'Incorrect password' });
  }

  // Success — reset their attempt counter and hand out a session.
  attempts.delete(ip);

  res.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken()));
  res.status(200).json({ ok: true });
};
