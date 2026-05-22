// api/teller/transactions.js
// Fetches transactions across all accounts for a Teller enrollment.
// Normalizes amounts to Plaid sign convention (positive=spending, negative=income)
// so all downstream cash-flow logic stays identical.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { accessToken, days = 30 } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' });

  const auth    = Buffer.from(`${accessToken}:`).toString('base64');
  const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  try {
    // 1. Get all accounts for this enrollment
    const acctRes = await fetch('https://api.teller.io/accounts', { headers });
    if (!acctRes.ok) {
      const errBody = await acctRes.json().catch(() => ({}));
      console.error('Teller accounts error:', acctRes.status, errBody);
      return res.status(400).json({ error: errBody.error?.message || 'Failed to fetch accounts', teller_status: acctRes.status });
    }
    const accounts = await acctRes.json();
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return res.status(200).json({ transactions: [], totalTransactions: 0 });
    }

    // 2. Fetch transactions for each account concurrently
    // Include both posted and pending — pending is common on freshly connected accounts
    const txArrays = await Promise.all(
      accounts.map(async (acct) => {
        try {
          const txRes = await fetch(
            `https://api.teller.io/accounts/${acct.id}/transactions?count=500`,
            { headers }
          );
          if (!txRes.ok) {
            console.error(`Teller tx error for account ${acct.id}:`, txRes.status);
            return [];
          }
          const txList = await txRes.json();
          // Include posted + pending; filter by date
          return txList.filter(t =>
            t.date >= cutoffStr &&
            (t.status === 'posted' || t.status === 'pending')
          );
        } catch (e) {
          console.error(`Teller tx fetch failed for account ${acct.id}:`, e.message);
          return [];
        }
      })
    );

    const allTx = txArrays.flat();

    // 3. Normalize to Plaid sign convention:
    //    Teller: negative = debit (spending), positive = credit (income)
    //    Plaid:  positive = debit (spending), negative = credit (income)
    //    We flip so existing calcCashFlow() works unchanged.
    const normalized = allTx.map(t => ({
      transaction_id: t.id,
      account_id:     t.account_id,
      name:           t.description,
      merchant_name:  t.details?.counterparty?.name || t.description,
      amount:         -(parseFloat(t.amount)),   // flip sign to match Plaid convention
      date:           t.date,
      category:       t.details?.category ? [t.details.category] : [],
      // Keep Teller-native fields for richer AI context
      teller_type:    t.type,
      teller_amount:  parseFloat(t.amount),
    }));

    // Sort newest first (matches Plaid behaviour)
    normalized.sort((a, b) => b.date.localeCompare(a.date));

    return res.status(200).json({
      transactions:      normalized,
      totalTransactions: normalized.length,
    });
  } catch (err) {
    console.error('Teller transactions error:', err);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
}
