// logout.js — clears the session cookie.
//
// We overwrite the cookie with an empty value and maxAge 0, which tells the
// browser to delete it. Nothing to clean up server-side: the session isn't
// stored anywhere, it's just a signed token. Once the browser drops it, it's gone.

const { clearCookieHeader, handlePreflight } = require('./_auth');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Set-Cookie', clearCookieHeader());
  res.status(200).json({ ok: true });
};
