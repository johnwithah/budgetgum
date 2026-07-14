// ─────────────────────────────────────────────────────────────────────────────
// _auth.js — shared auth helpers.
//
// The underscore prefix tells Vercel "this is NOT an endpoint" — it won't be
// exposed at /api/_auth. It's just a library the other routes import.
//
// HOW THE SESSION WORKS
// ---------------------
// When you log in, the server creates a payload like {exp: 1234567890},
// base64-encodes it, and appends an HMAC signature computed with SESSION_SECRET.
// The result looks like:   eyJleHAiOjE3...==.9f2a4b8c1d...
//                          └── payload ──┘ └─ signature ─┘
//
// Anyone can READ the payload (it's just base64, not encryption). But nobody can
// FORGE one, because producing a valid signature requires SESSION_SECRET, which
// only lives on the server. If someone tampers with the payload — say, pushing
// the expiry out a year — the signature stops matching and we reject it.
//
// The cookie is set httpOnly, so browser JavaScript cannot read it at all.
// That's what makes it much safer than a token in localStorage.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const cookie = require('cookie');

const COOKIE_NAME = 'bg_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
}

// HMAC-SHA256 the payload with our secret. Same input + same secret = same output,
// always. Different secret = completely different output. That's what makes it
// unforgeable without the secret.
function sign(payloadB64) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('hex');
}

// Build a signed session token.
function createSessionToken() {
  const payload = { exp: Date.now() + MAX_AGE_SECONDS * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

// Verify a token: signature must match AND it must not be expired.
function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payloadB64, providedSig] = parts;
  const expectedSig = sign(payloadB64);

  // timingSafeEqual instead of === to avoid a timing attack: a naive string
  // compare bails on the first mismatched character, so an attacker could learn
  // the signature byte-by-byte from response times. This always takes the same
  // amount of time regardless of where the mismatch is.
  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number') return false;
    if (Date.now() > payload.exp) return false; // expired
    return true;
  } catch {
    return false;
  }
}

// Serialize the Set-Cookie header for a fresh login.
function sessionCookieHeader(token) {
  return cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,   // JS cannot read this cookie. This is the important one.
    secure: true,     // HTTPS only.
    sameSite: 'lax',  // Not sent on cross-site requests — blunts CSRF.
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

// Serialize a Set-Cookie header that immediately expires the cookie (logout).
function clearCookieHeader() {
  return cookie.serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

// Read the session cookie off an incoming request and check it.
function isAuthenticated(req) {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    return verifySessionToken(cookies[COOKIE_NAME]);
  } catch {
    return false;
  }
}

// The guard every protected route calls first.
//
//   if (!requireAuth(req, res)) return;
//
// If it returns false it has ALREADY sent a 401, so the caller just returns.
function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  res.status(401).json({ error: 'Not authenticated' });
  return false;
}

// Standard CORS/preflight boilerplate, shared so we don't repeat it 6 times.
// Note: no wildcard origin here. Credentials (cookies) can't be sent to a
// wildcard origin anyway, and we're same-origin, so we simply don't need CORS.
function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

module.exports = {
  COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  sessionCookieHeader,
  clearCookieHeader,
  isAuthenticated,
  requireAuth,
  handlePreflight,
};
