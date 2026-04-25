const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const plaidClient = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: { headers: { 'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID, 'PLAID-SECRET': process.env.PLAID_SECRET } },
}));

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'Missing access_token' });
  const today = new Date();
  const startDate = new Date(today); startDate.setDate(today.getDate() - 30);
  try {
    const [txRes, balRes] = await Promise.all([
      plaidClient.transactionsGet({ access_token, start_date: startDate.toISOString().split('T')[0], end_date: today.toISOString().split('T')[0], options: { count: 100 } }),
      plaidClient.accountsBalanceGet({ access_token }),
    ]);
    const transactions = txRes.data.transactions.map(t => ({
      id: t.transaction_id, desc: t.merchant_name || t.name,
      amount: Math.abs(t.amount), date: t.date,
      category: t.personal_finance_category?.primary || t.category?.[0] || 'Other',
      pending: t.pending, type: 'bank',
    }));
    const accounts = balRes.data.accounts.map(a => ({
      id: a.account_id, name: a.name, type: a.type, subtype: a.subtype,
      balance: a.balances.current, available: a.balances.available, mask: a.mask,
    }));
    res.json({ transactions, accounts });
  } catch (err) {
    console.error('get_transactions error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
};
