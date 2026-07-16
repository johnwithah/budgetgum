// ─────────────────────────────────────────────────────────────────────────────
// state.js — your budget, stored server-side.
//
// GET  /api/state  → read it
// POST /api/state  → write it
//
// Everything (envelopes, transactions, funding) lives in one Redis blob. That's
// crude — a real app would normalize this into separate keys and only write what
// changed. But you're one user with maybe fifty envelopes; the whole thing is a
// few KB, and writing it atomically means the app can never end up half-saved.
// Simplicity is worth more than efficiency at this size.
//
// Every request requires a valid session, so this is only ever *your* budget.
// ─────────────────────────────────────────────────────────────────────────────

const { kv } = require('@vercel/kv');
const { requireAuth, handlePreflight } = require('./_auth');

const STATE_KEY = 'app:state';

// Guard against a runaway payload wedging the store.
const MAX_BYTES = 1_500_000; // ~1.5 MB

const EMPTY = {
  envelopes: [],
  transactions: [],
  accounts: [],
  unmapped: [],
  lastSync: null,
  importSince: '2026-07-14',
  updatedAt: null,
};

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (!requireAuth(req, res)) return;

  // ── READ ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const state = await kv.get(STATE_KEY);
      return res.status(200).json(state || EMPTY);
    } catch (err) {
      console.error('state GET failed:', err.message);
      // Fail loudly rather than returning EMPTY — if we silently handed back an
      // empty budget, the client might "sync" that emptiness back and wipe you out.
      return res.status(500).json({ error: 'Could not read state' });
    }
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body;

    if (!body || typeof body !== 'object' || !Array.isArray(body.envelopes)) {
      return res.status(400).json({ error: 'Malformed state' });
    }

    const payload = {
      envelopes:    body.envelopes    || [],
      transactions: body.transactions || [],
      accounts:     body.accounts     || [],
      unmapped:     body.unmapped     || [],
      lastSync:     body.lastSync     || null,
      importSince:  body.importSince  || '2026-07-14',
      updatedAt:    Date.now(),
    };

    const size = Buffer.byteLength(JSON.stringify(payload));
    if (size > MAX_BYTES) {
      return res.status(413).json({ error: 'State too large' });
    }

    try {
      await kv.set(STATE_KEY, payload);
      return res.status(200).json({ ok: true, updatedAt: payload.updatedAt });
    } catch (err) {
      console.error('state POST failed:', err.message);
      return res.status(500).json({ error: 'Could not save state' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
