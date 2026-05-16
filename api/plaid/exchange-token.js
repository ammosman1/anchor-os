// api/plaid/exchange-token.js
// Exchanges a short-lived public_token for a permanent access_token
// Called immediately after the user completes Plaid Link

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { publicToken, institutionId, institutionName, accounts } = req.body;
  if (!publicToken) return res.status(400).json({ error: 'publicToken required' });

  const baseUrl = `https://${process.env.PLAID_ENV}.plaid.com`;

  try {
    const response = await fetch(`${baseUrl}/item/public_token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:    process.env.PLAID_CLIENT_ID,
        secret:       process.env.PLAID_SECRET,
        public_token: publicToken,
      }),
    });

    const data = await response.json();
    if (data.error_code) return res.status(400).json({ error: data.error_message });

    return res.status(200).json({
      accessToken:     data.access_token,
      itemId:          data.item_id,
      institutionId,
      institutionName,
      accounts,
    });
  } catch (err) {
    console.error('Exchange token error:', err);
    return res.status(500).json({ error: 'Token exchange failed' });
  }
}
