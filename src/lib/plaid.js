// src/lib/plaid.js
// Client-side Plaid helpers

export async function fetchMonthlyCashFlow(plaidItems) {
  if (!plaidItems?.length) return null;
  const item = plaidItems[0];
  if (!item?.accessToken) return null;
  try {
    const res = await fetch('/api/plaid/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: item.accessToken, days: 30 }),
    });
    if (!res.ok) return null;
    const { transactions } = await res.json();
    if (!transactions?.length) return null;
    const income   = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const spending = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    return {
      monthlyIncome:   Math.round(income),
      monthlySpending: Math.round(spending),
      monthlySurplus:  Math.round(income - spending),
    };
  } catch {
    return null;
  }
}

// Compute cash-flow summary from a transactions array (used by OtherScreens)
export function calcCashFlow(transactions = []) {
  if (!transactions.length) return null;
  const income   = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const spending = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  return {
    income:   Math.round(income),
    spending: Math.round(spending),
    surplus:  Math.round(income - spending),
  };
}

// Format a transaction amount for display
export function formatTxAmount(amount) {
  const abs = Math.abs(amount);
  const fmt = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return amount < 0 ? `+${fmt}` : fmt;
}

// Format a transaction date for display
export function formatTxDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00'); // noon avoids timezone shifts
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Fetch accounts for a given access token
export async function fetchAccounts(accessToken) {
  const res = await fetch('/api/plaid/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  if (!res.ok) return [];
  const { accounts } = await res.json();
  return accounts || [];
}

// Fetch transactions for a given access token
export async function fetchTransactions(accessToken, days = 30) {
  const res = await fetch('/api/plaid/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, days }),
  });
  if (!res.ok) return [];
  const { transactions } = await res.json();
  return transactions || [];
}

// Launch Plaid Link flow — gets a link token then opens the widget
export async function openPlaidLink(uid, onSuccess) {
  const tokenRes = await fetch('/api/plaid/create-link-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid }),
  });
  if (!tokenRes.ok) throw new Error('Failed to create link token');
  const { link_token } = await tokenRes.json();

  return new Promise((resolve, reject) => {
    const handler = window.Plaid.create({
      token: link_token,
      onSuccess: async (publicToken, metadata) => {
        const exRes = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token: publicToken }),
        });
        if (!exRes.ok) { reject(new Error('Token exchange failed')); return; }
        const data = await exRes.json();
        await onSuccess({
          accessToken:     data.access_token,
          itemId:          data.item_id,
          institutionId:   metadata.institution?.institution_id,
          institutionName: metadata.institution?.name,
          accounts:        metadata.accounts,
        });
        resolve();
      },
      onExit: (err) => {
        if (err) reject(err);
        else resolve();
      },
    });
    handler.open();
  });
}
