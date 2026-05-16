// api/plaid/accounts.js
// Fetches real-time account balances for a connected item

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' });

  const baseUrl = `https://${process.env.PLAID_ENV}.plaid.com`;

  try {
    const response = await fetch(`${baseUrl}/accounts/balance/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:    process.env.PLAID_CLIENT_ID,
        secret:       process.env.PLAID_SECRET,
        access_token: accessToken,
      }),
    });

    const data = await response.json();
    if (data.error_code) return res.status(400).json({ error: data.error_message });

    return res.status(200).json({ accounts: data.accounts });
  } catch (err) {
    console.error('Accounts fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch accounts' });
  }
}
