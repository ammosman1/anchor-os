// src/lib/teller.js
// Teller.io bank connectivity — replaces Plaid.
// Exports match the old plaid.js signatures so all screens work unchanged.
// Amount sign convention is normalized to match Plaid (positive=spending, negative=income)
// so calcCashFlow and all AI context logic stays identical.

// ─── Cash flow from stored teller items ──────────────────────────────────────
export async function fetchMonthlyCashFlow(tellerItems) {
  if (!tellerItems?.length) return null;
  const item = tellerItems[0];
  if (!item?.accessToken) return null;
  try {
    const res = await fetch('/api/teller/transactions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ accessToken: item.accessToken, days: 30 }),
    });
    if (!res.ok) return null;
    const { transactions } = await res.json();
    if (!transactions?.length) return null;

    // Normalized to Plaid convention: negative=income, positive=spending
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

// ─── Cash flow from a raw transactions array ─────────────────────────────────
// Used by DebtScreen which holds transactions locally.
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

// ─── Format helpers ───────────────────────────────────────────────────────────
export function formatTxAmount(amount) {
  const abs = Math.abs(amount);
  const fmt = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return amount < 0 ? `+${fmt}` : fmt;
}

export function formatTxDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Fetch accounts for a given access token ─────────────────────────────────
export async function fetchAccounts(accessToken) {
  const res = await fetch('/api/teller/accounts', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ accessToken }),
  });
  if (!res.ok) return [];
  const { accounts } = await res.json();
  return accounts || [];
}

// ─── Fetch transactions for a given access token ──────────────────────────────
export async function fetchTransactions(accessToken, days = 30) {
  const res = await fetch('/api/teller/transactions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ accessToken, days }),
  });
  if (!res.ok) return [];
  const { transactions } = await res.json();
  return transactions || [];
}

// ─── Open Teller Connect widget ───────────────────────────────────────────────
// Drop-in replacement for openPlaidLink. onSuccess receives the same shape
// the app used to receive from Plaid so Firestore storage is identical.
export function openTellerConnect(onSuccess) {
  if (!window.TellerConnect) {
    console.error('Teller Connect script not loaded');
    return;
  }

  const teller = window.TellerConnect.setup({
    applicationId: process.env.REACT_APP_TELLER_APP_ID,
    onSuccess: (enrollment) => {
      onSuccess({
        accessToken:     enrollment.accessToken,
        enrollmentId:    enrollment.enrollment?.id   || enrollment.id,
        institutionId:   enrollment.enrollment?.institution?.id   || '',
        institutionName: enrollment.enrollment?.institution?.name || 'Bank',
        accounts:        [],
      });
    },
    onExit: () => {},
    onFailure: (failure) => {
      console.error('Teller Connect failure:', failure);
    },
  });

  teller.open();
}
