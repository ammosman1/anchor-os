// api/plaid/transactions.js
// Fetches transactions for a date range and returns them with cash flow totals

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { accessToken, days = 30 } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' });

  const endDate   = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const baseUrl   = `https://${process.env.PLAID_ENV}.plaid.com`;

  try {
    const response = await fetch(`${baseUrl}/transactions/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:    process.env.PLAID_CLIENT_ID,
        secret:       process.env.PLAID_SECRET,
        access_token: accessToken,
        start_date:   startDate,
        end_date:     endDate,
        options:      { count: 100, offset: 0 },
      }),
    });

    const data = await response.json();
    if (data.error_code) return res.status(400).json({ error: data.error_message });

    return res.status(200).json({
      transactions:      data.transactions || [],
      totalTransactions: data.total_transactions || 0,
    });
  } catch (err) {
    console.error('Transactions fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
}
