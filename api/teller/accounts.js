// api/teller/accounts.js
// Fetches all accounts for a Teller enrollment, including live balances.
// Returns normalized shape matching what the app expects from Plaid.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' });

  const auth    = Buffer.from(`${accessToken}:`).toString('base64');
  const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };

  try {
    const acctRes = await fetch('https://api.teller.io/accounts', { headers });
    if (!acctRes.ok) {
      const err = await acctRes.json().catch(() => ({}));
      return res.status(400).json({ error: err.error?.message || 'Failed to fetch accounts' });
    }
    const accountList = await acctRes.json();

    // Fetch balances for each account concurrently
    const withBalances = await Promise.all(
      accountList.map(async (a) => {
        try {
          const balRes = await fetch(`https://api.teller.io/accounts/${a.id}/balances`, { headers });
          const bal    = balRes.ok ? await balRes.json() : {};
          return {
            // Normalized shape — mirrors what Plaid returned so screens don't change
            accountId:       a.id,
            name:            a.name,
            type:            a.type,       // 'depository' | 'credit'
            subtype:         a.subtype,    // 'checking' | 'savings' | 'credit_card' etc.
            institutionName: a.institution?.name || '',
            enrollmentId:    a.enrollment_id,
            status:          a.status,
            balances: {
              current:   parseFloat(bal.ledger  ?? bal.available ?? 0),
              available: parseFloat(bal.available ?? 0),
            },
          };
        } catch {
          return null;
        }
      })
    );

    return res.status(200).json({ accounts: withBalances.filter(Boolean) });
  } catch (err) {
    console.error('Teller accounts error:', err);
    return res.status(500).json({ error: 'Failed to fetch accounts' });
  }
}
