const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');

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
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'budgetgum-user' },
      client_name: 'Budgetgum',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    res.json({ link_token: response.data.link_token });
  } catch (err) {
  const detail = err.response?.data || { message: err.message };
  console.error('create_link_token error:', JSON.stringify(detail));
  res.status(500).json({ error: 'Failed to create link token', plaid: detail });
}
};
