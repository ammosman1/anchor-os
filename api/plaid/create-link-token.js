// api/plaid/create-link-token.js
// Creates a Plaid Link token to initialize the bank-connection widget

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { uid } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid required' });

  const baseUrl = `https://${process.env.PLAID_ENV}.plaid.com`;

  try {
    const response = await fetch(`${baseUrl}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     process.env.PLAID_CLIENT_ID,
        secret:        process.env.PLAID_SECRET,
        user:          { client_user_id: uid },
        client_name:   'Anchor OS',
        products:      ['transactions'],
        country_codes: ['US'],
        language:      'en',
      }),
    });

    const data = await response.json();
    if (data.error_code) return res.status(400).json({ error: data.error_message });

    return res.status(200).json({ linkToken: data.link_token });
  } catch (err) {
    console.error('Create link token error:', err);
    return res.status(500).json({ error: 'Failed to create link token' });
  }
}
