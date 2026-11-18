// ─────────────────────────────────────────────────────────────────────────────
// _plaid.js — the Plaid client + the shape we turn Plaid's data into.
//
// Shared by get_transactions.js (you tapping Sync) and notify.js (the scheduled
// check that sends push notifications), so both see transactions and accounts
// in exactly the same form. Underscore prefix = not an endpoint.
// ─────────────────────────────────────────────────────────────────────────────

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const plaidClient = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
}));

function mapTransaction(t) {
  return {
    id: t.transaction_id,
    desc: t.merchant_name || t.name,
    // Preserve Plaid's sign convention: POSITIVE = money leaving (a debit/
    // purchase), NEGATIVE = money coming in (a deposit/credit). The app keys
    // off this: amount > 0 acts on envelopes, amount <= 0 is an inflow that's
    // only recorded. Don't Math.abs() this — it destroys the distinction.
    amount: t.amount,
    date: t.date,
    category: t.personal_finance_category?.primary || t.category?.[0] || 'Other',
    // Merchant branding, when Plaid has enriched this transaction. Not
    // always present — depends on the merchant and your Plaid plan — so the
    // app treats it as a bonus, never a requirement.
    logo: t.logo_url || null,
    website: t.website || null,
    pending: t.pending,
    type: 'bank',
  };
}

function mapAccount(a) {
  return {
    id: a.account_id,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    balance: a.balances.current,
    available: a.balances.available,
    mask: a.mask,
  };
}

module.exports = { plaidClient, mapTransaction, mapAccount };
