// src/lib/plaid.js
// Client-side Plaid helpers — opens Link widget, exchanges tokens, fetches data

// ─── Plaid Link SDK loader ─────────────────────────────────────────────────────

function loadPlaidScript() {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve();
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.onload  = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ─── Connect a bank account ───────────────────────────────────────────────────

// Opens the Plaid Link widget. Returns a Promise that resolves when the widget
// closes (either success or exit). onSuccess receives the token exchange result.
export async function openPlaidLink(uid, onSuccess) {
  await loadPlaidScript();

  const res = await fetch('/api/plaid/create-link-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid }),
  });

  const { linkToken, error } = await res.json();
  if (error) throw new Error(error);

  return new Promise((resolve) => {
    const handler = window.Plaid.create({
      token: linkToken,

      onSuccess: async (publicToken, metadata) => {
        try {
          const exchangeRes = await fetch('/api/plaid/exchange-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              publicToken,
              institutionId:   metadata.institution.institution_id,
              institutionName: metadata.institution.name,
              accounts:        metadata.accounts,
            }),
          });
          const data = await exchangeRes.json();
          if (!data.error) await onSuccess(data);
        } catch (err) {
          console.error('Token exchange error:', err);
        }
        resolve();
      },

      onExit: () => resolve(),
    });

    handler.open();
  });
}

// ─── Data fetching ────────────────────────────────────────────────────────────

export async function fetchAccounts(accessToken) {
  const res = await fetch('/api/plaid/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  if (!res.ok) throw new Error('Failed to fetch accounts');
  return res.json(); // { accounts: [...] }
}

export async function fetchTransactions(accessToken, days = 30) {
  const res = await fetch('/api/plaid/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, days }),
  });
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json(); // { transactions: [...], totalTransactions: N }
}

// ─── Cash flow calculation ────────────────────────────────────────────────────

// Plaid convention: positive amount = money OUT (expense), negative = money IN (income)
export function calcCashFlow(transactions) {
  const nonPending = transactions.filter(t => !t.pending);
  const income   = nonPending.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const spending  = nonPending.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const surplus   = income - spending;
  return { income, spending, surplus };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatTxAmount(amount) {
  const abs = Math.abs(amount).toFixed(2);
  return amount < 0 ? `+$${abs}` : `-$${abs}`;
}

export function formatTxDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
