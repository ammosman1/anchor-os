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
    if (!acctRes.ok) return res.status(400).json({ error: 'Failed to fetch accounts' });
    const accounts = await acctRes.json();

    // 2. Fetch transactions for each account concurrently
    const txArrays = await Promise.all(
      accounts.map(async (acct) => {
        try {
          const txRes = await fetch(
            `https://api.teller.io/accounts/${acct.id}/transactions?count=500`,
            { headers }
          );
          if (!txRes.ok) return [];
          const txList = await txRes.json();
          return txList.filter(t => t.date >= cutoffStr && t.status === 'posted');
        } catch {
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
