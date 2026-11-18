// ─────────────────────────────────────────────────────────────────────────────
// passkey.js — unlock with Face ID / Touch ID instead of typing the password.
//
// GET  /api/passkey                              → { count, passkeys }      (signed in)
// POST /api/passkey { action: "register-options" }                         (signed in)
// POST /api/passkey { action: "register-verify", response, label }         (signed in)
// POST /api/passkey { action: "login-options" }
// POST /api/passkey { action: "login-verify", response }  → sets the session cookie
// POST /api/passkey { action: "remove-all" }                               (signed in)
//
// HOW IT WORKS
// ------------
// A passkey is a key pair your phone creates inside its secure hardware. We
// only ever receive the PUBLIC half. To unlock, the server sends a random
// one-time challenge; your phone signs it with the private half — and it will
// only do that after Face ID passes. We check the signature against the public
// key we stored. There's no shared secret to steal, phish, or brute-force: a
// leaked copy of this database couldn't unlock anything.
//
// You can only add a passkey while already signed in with the password, so the
// password stays the root of trust — and the fallback if Face ID isn't
// available.
// ─────────────────────────────────────────────────────────────────────────────

const { kv } = require('@vercel/kv');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');
const { requireAuth, handlePreflight, createSessionToken, sessionCookieHeader } = require('./_auth');
const { PASSKEYS_KEY, CHALLENGE_PREFIX } = require('./_kv');

const CHALLENGE_TTL_SECONDS = 300;

// A passkey is bound to the domain it was made on. Derive it from the request
// so it works on whatever domain Vercel serves the app from.
function relyingParty(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return { rpID: host.split(':')[0], origin: `${proto}://${host}` };
}

async function getPasskeys() {
  return (await kv.get(PASSKEYS_KEY)) || [];
}

// Challenges are single-use: read it and delete it in the same breath.
async function takeChallenge(purpose) {
  const key = CHALLENGE_PREFIX + purpose;
  const challenge = await kv.get(key);
  await kv.del(key);
  return challenge;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;

  try {
    if (req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const passkeys = await getPasskeys();
      return res.status(200).json({
        count: passkeys.length,
        passkeys: passkeys.map(p => ({ label: p.label, createdAt: p.createdAt })),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action } = req.body || {};
    const { rpID, origin } = relyingParty(req);

    // ── Add a passkey (must already be signed in) ───────────────────────────
    if (action === 'register-options') {
      if (!requireAuth(req, res)) return;
      const passkeys = await getPasskeys();
      const options = await generateRegistrationOptions({
        rpName: 'Budgetgum',
        rpID,
        userName: 'Budgetgum',
        // One fixed user — this is a single-user app. Re-registering on the same
        // device replaces that device's passkey rather than piling up duplicates.
        userID: new TextEncoder().encode('budgetgum-owner'),
        attestationType: 'none',
        excludeCredentials: passkeys.map(p => ({ id: p.id, transports: p.transports })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      });
      await kv.set(CHALLENGE_PREFIX + 'register', options.challenge, { ex: CHALLENGE_TTL_SECONDS });
      return res.status(200).json(options);
    }

    if (action === 'register-verify') {
      if (!requireAuth(req, res)) return;
      const expectedChallenge = await takeChallenge('register');
      if (!expectedChallenge) return res.status(400).json({ error: 'Setup timed out — try again' });

      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response: req.body.response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!verified) return res.status(400).json({ error: 'Could not verify passkey' });

      const { credential } = registrationInfo;
      const passkeys = (await getPasskeys()).filter(p => p.id !== credential.id);
      passkeys.push({
        id: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports || [],
        label: typeof req.body.label === 'string' ? req.body.label.slice(0, 60) : 'Device',
        createdAt: new Date().toISOString(),
      });
      await kv.set(PASSKEYS_KEY, passkeys);
      return res.status(200).json({ ok: true, count: passkeys.length });
    }

    if (action === 'remove-all') {
      if (!requireAuth(req, res)) return;
      await kv.del(PASSKEYS_KEY);
      return res.status(200).json({ ok: true });
    }

    // ── Unlock with a passkey (no session yet — that's the point) ───────────
    if (action === 'login-options') {
      const passkeys = await getPasskeys();
      if (!passkeys.length) return res.status(404).json({ error: 'No passkeys set up' });
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: passkeys.map(p => ({ id: p.id, transports: p.transports })),
        userVerification: 'required',
      });
      await kv.set(CHALLENGE_PREFIX + 'login', options.challenge, { ex: CHALLENGE_TTL_SECONDS });
      return res.status(200).json(options);
    }

    if (action === 'login-verify') {
      const response = req.body.response;
      const expectedChallenge = await takeChallenge('login');
      if (!expectedChallenge) return res.status(400).json({ error: 'Timed out — try again' });

      const passkeys = await getPasskeys();
      const stored = passkeys.find(p => p.id === response?.id);
      if (!stored) return res.status(401).json({ error: 'Unknown passkey' });

      const { verified, authenticationInfo } = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: stored.id,
          publicKey: isoBase64URL.toBuffer(stored.publicKey),
          counter: stored.counter,
          transports: stored.transports,
        },
        requireUserVerification: true,
      });
      if (!verified) return res.status(401).json({ error: 'Face ID check failed' });

      stored.counter = authenticationInfo.newCounter;
      stored.lastUsedAt = new Date().toISOString();
      await kv.set(PASSKEYS_KEY, passkeys);

      res.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken()));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    // simplewebauthn throws descriptive errors on any mismatch (wrong origin,
    // replayed challenge, bad signature) — all of which mean "no."
    console.error('passkey error:', err.message);
    return res.status(400).json({ error: 'Passkey check failed' });
  }
};
