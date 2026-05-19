// src/components/screens/DebtScreen.js
import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getDebtAdvice } from '../../lib/ai';
import { auth } from '../../lib/firebase';
import { addDebtAccount, updateDebtAccount, deleteDebtAccount, savePlaidItem, deletePlaidItem, saveManualCashFlow, addTask, addAssetAccount, updateAssetAccount, deleteAssetAccount, addDebtBalanceSnapshot } from '../../lib/db';
import { openPlaidLink, calcCashFlow, formatTxAmount, formatTxDate } from '../../lib/plaid';
import { Card, Button, Input, Select, SectionLabel, MomentumBar, Modal, AICard, EmptyState } from '../ui';

const isDev = process.env.NODE_ENV !== 'production';

// â”€â”€â”€ Payoff simulation math â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function simulatePayoff(accounts, extraPayment, strategy) {
  if (!accounts.length) return { months: 0, totalInterest: 0 };
  let accts = accounts
    .filter(a => (a.balance || 0) > 0)
    .map(a => ({ ...a, balance: a.balance || 0 }));

  // Sort by strategy
  if (strategy === 'avalanche') {
    accts.sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0));
  } else {
    accts.sort((a, b) => (a.balance || 0) - (b.balance || 0));
  }

  const totalMin     = accts.reduce((s, a) => s + (a.minimumPayment || 0), 0);
  const totalMonthly = totalMin + extraPayment;

  let months = 0;
  let totalInterest = 0;

  while (accts.some(a => a.balance > 0.01) && months < 600) {
    months++;
    let remaining = totalMonthly;

    // Apply interest and minimums
    for (const a of accts) {
      if (a.balance <= 0.01) continue;
      const interest = a.balance * ((a.interestRate || 0) / 100 / 12);
      totalInterest += interest;
      a.balance += interest;
      const minPay = Math.min(a.minimumPayment || 0, a.balance);
      a.balance -= minPay;
      remaining  -= (a.minimumPayment || 0);
    }

    // Apply extra to priority account
    for (const a of accts) {
      if (a.balance <= 0.01 || remaining <= 0) continue;
      const pay   = Math.min(remaining, a.balance);
      a.balance  -= pay;
      remaining  -= pay;
    }
  }

  return { months, totalInterest: Math.round(totalInterest) };
}

function monthsToLabel(months) {
  if (months >= 600) return 'Over 50 years';
  const yrs  = Math.floor(months / 12);
  const mos  = months % 12;
  if (yrs === 0) return `${mos} mo`;
  if (mos === 0) return `${yrs} yr`;
  return `${yrs} yr ${mos} mo`;
}

function PayoffSimulator({ accounts }) {
  const [extra, setExtra] = useState(500);

  const totalBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const hasAccounts  = accounts.length > 0 && totalBalance > 0;

  const avalanche = hasAccounts ? simulatePayoff(accounts, extra, 'avalanche') : null;
  const snowball  = hasAccounts ? simulatePayoff(accounts, extra, 'snowball')  : null;

  const interestSaved = avalanche && snowball
    ? snowball.totalInterest - avalanche.totalInterest
    : 0;

  const monthsFaster = avalanche && snowball
    ? snowball.months - avalanche.months
    : 0;

  if (!hasAccounts) return null;

  return (
    <div style={{ marginBottom: '16px' }}>
      <Card>
        <SectionLabel>Payoff Simulator</SectionLabel>
        <p style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '-4px', marginBottom: '16px' }}>
          How fast can you pay this off? Avalanche (highest rate first) vs Snowball (lowest balance first).
        </p>

        {/* Extra payment slider */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', color: tokens.textSecondary, fontWeight: 600 }}>Extra monthly payment</span>
            <span style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: tokens.accent }}>${extra.toLocaleString()}</span>
          </div>
          <input
            type="range" min={0} max={5000} step={50} value={extra}
            onChange={e => setExtra(Number(e.target.value))}
            style={{ width: '100%', accentColor: tokens.accent }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: tokens.textMuted, marginTop: '4px' }}>
            <span>$0</span><span>$5,000/mo extra</span>
          </div>
        </div>

        {/* Side by side comparison */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
          {[
            { label: 'Avalanche', sublabel: 'Highest rate first', result: avalanche, color: tokens.green, icon: 'â–²' },
            { label: 'Snowball',  sublabel: 'Lowest balance first', result: snowball, color: tokens.blue,  icon: 'â—' },
          ].map(({ label, sublabel, result, color, icon }) => (
            <div key={label} style={{ padding: '14px', background: tokens.bgCardHover, borderRadius: '10px', border: `1px solid ${tokens.border}` }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color, letterSpacing: '0.06em', marginBottom: '4px' }}>{icon} {label}</div>
              <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '12px' }}>{sublabel}</div>
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '2px' }}>Payoff in</div>
                <div style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color }}>{monthsToLabel(result.months)}</div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '2px' }}>Total interest</div>
                <div style={{ fontFamily: fonts.display, fontSize: '16px', fontWeight: 700, color: tokens.red }}>${result.totalInterest.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Avalanche advantage callout */}
        {interestSaved > 0 && (
          <div style={{ padding: '10px 14px', background: tokens.greenDim, borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: tokens.green }}>Avalanche saves you ${interestSaved.toLocaleString()}</div>
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                {monthsFaster > 0 ? `${monthsToLabel(monthsFaster)} faster than snowball` : 'Same timeline, less interest'}
              </div>
            </div>
            <span style={{ fontSize: '20px' }}>â–²</span>
          </div>
        )}

        {interestSaved === 0 && avalanche && (
          <div style={{ padding: '10px 14px', background: tokens.accentDim, borderRadius: '8px', fontSize: '12px', color: tokens.textMuted }}>
            Both strategies payoff at the same rate with these accounts.
          </div>
        )}
      </Card>
    </div>
  );
}

const DEBT_TYPES = [
  { value: 'tax',      label: 'Tax Debt'      },
  { value: 'business', label: 'Business Debt' },
  { value: 'personal', label: 'Personal Debt' },
  { value: 'credit',   label: 'Credit Card'   },
  { value: 'auto',     label: 'Auto Loan'     },
  { value: 'student',  label: 'Student Loan'  },
  { value: 'mortgage', label: 'Mortgage'      },
  { value: 'medical',  label: 'Medical Debt'  },
  { value: 'other',    label: 'Other'         },
];

const ASSET_TYPES = [
  { value: 'checking',   label: 'Checking Account'    },
  { value: 'savings',    label: 'Savings Account'     },
  { value: 'retirement', label: 'Retirement (401k/IRA)' },
  { value: 'investment', label: 'Investment Account'  },
  { value: 'property',   label: 'Real Estate / Property' },
  { value: 'other',      label: 'Other Asset'         },
];

const assetTypeColors = {
  checking:   { bg: 'rgba(91,143,212,0.12)',  text: '#5B8FD4' },
  savings:    { bg: 'rgba(109,191,158,0.12)', text: '#6DBF9E' },
  retirement: { bg: 'rgba(155,133,201,0.12)', text: '#9B85C9' },
  investment: { bg: 'rgba(200,169,110,0.12)', text: '#C8A96E' },
  property:   { bg: 'rgba(109,191,158,0.15)', text: '#5BAF8E' },
  other:      { bg: 'rgba(28,24,20,0.07)',    text: 'rgba(28,24,20,0.42)' },
};

const emptyForm      = { name: '', balance: '', interestRate: '', type: 'personal', minimumPayment: '', notes: '' };
const emptyAssetForm = { name: '', balance: '', type: 'checking', notes: '' };

const typeColors = {
  tax:      { bg: 'rgba(212,122,107,0.12)', text: '#D47A6B' },
  business: { bg: 'rgba(155,133,201,0.12)', text: '#9B85C9' },
  personal: { bg: 'rgba(91,143,212,0.12)',  text: '#5B8FD4' },
  credit:   { bg: 'rgba(200,169,110,0.12)', text: '#C8A96E' },
  auto:     { bg: 'rgba(109,191,158,0.12)', text: '#6DBF9E' },
  student:  { bg: 'rgba(200,169,110,0.12)', text: '#C8A96E' },
  mortgage: { bg: 'rgba(91,143,212,0.15)',  text: '#4A7BC4' },
  medical:  { bg: 'rgba(212,122,107,0.10)', text: '#C06858' },
  other:    { bg: 'rgba(28,24,20,0.07)',    text: 'rgba(28,24,20,0.42)'  },
};

// â”€â”€â”€ File-to-base64 helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// â”€â”€â”€ Format import date â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fmtImportDate(ts) {
  if (!ts) return '';
  try {
    const ms = ts.toMillis?.() ?? (ts._seconds ? ts._seconds * 1000 : new Date(ts).getTime());
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

export default function DebtScreen() {
  const { user }                                                    = useAuth();
  const { debtAccounts, totalDebt, assetAccounts, totalAssets, plaidItems, manualCashFlow, goals } = useData();

  // â”€â”€ Existing account modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [showModal,     setShowModal]     = useState(false);
  const [form,          setForm]          = useState(emptyForm);
  const [editing,       setEditing]       = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [aiText,        setAiText]        = useState('');
  const [aiLoading,     setAiLoading]     = useState(false);
  const [showAllTx,     setShowAllTx]     = useState(false);

  // â”€â”€ Plaid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [plaidAccounts, setPlaidAccounts] = useState([]);
  const [transactions,  setTransactions]  = useState([]);
  const [loadingPlaid,  setLoadingPlaid]  = useState(false);
  const [connecting,    setConnecting]    = useState(false);

  // â”€â”€ File import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fileInputRef                            = useRef(null);
  const [importLoading,    setImportLoading]    = useState(false);
  const [importError,      setImportError]      = useState('');
  const [showImportModal,  setShowImportModal]  = useState(false);
  const [importSummary,    setImportSummary]    = useState('');
  const [importFileName,   setImportFileName]   = useState('');
  const [editableAccounts, setEditableAccounts] = useState([]);
  const [selectedIndices,  setSelectedIndices]  = useState(new Set());
  const [importCashFlow,   setImportCashFlow]   = useState(null);
  const [includeCashFlow,  setIncludeCashFlow]  = useState(false);
  const [editableCF,       setEditableCF]       = useState({ monthlyIncome: '', monthlySpending: '', monthlySurplus: '' });
  const [importSaving,     setImportSaving]     = useState(false);
  const [importProgress,   setImportProgress]   = useState(null); // { current, total }

  // â”€â”€ Asset account modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetForm,      setAssetForm]      = useState(emptyAssetForm);
  const [editingAsset,   setEditingAsset]   = useState(null);
  const [savingAsset,    setSavingAsset]    = useState(false);

  // â”€â”€ Clarification modal (pre-import: smart account matching) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [showClarifyModal, setShowClarifyModal] = useState(false);
  const [clarifyData,      setClarifyData]      = useState(null);  // { matches, questions, insights }
  const [clarifyAnswers,   setClarifyAnswers]   = useState({});    // { [extractedIndex]: 'yes'|'no' }

  // â”€â”€ Plaid load â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!plaidItems.length) { setPlaidAccounts([]); setTransactions([]); return; }
    let cancelled = false;
    const load = async () => {
      setLoadingPlaid(true);
      try {
        const allAccounts = [], allTx = [];
        await Promise.all(plaidItems.map(async item => {
          const [aRes, tRes] = await Promise.all([
            fetch('/api/plaid/accounts',     { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: item.accessToken }) }),
            fetch('/api/plaid/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: item.accessToken, days: 30 }) }),
          ]);
          const aData = await aRes.json(); const tData = await tRes.json();
          if (aData.accounts)     allAccounts.push(...aData.accounts.map(a => ({ ...a, institutionName: item.institutionName })));
          if (tData.transactions) allTx.push(...tData.transactions);
        }));
        if (!cancelled) {
          setPlaidAccounts(allAccounts);
          setTransactions(allTx.sort((a, b) => new Date(b.date) - new Date(a.date)));
        }
      } catch (err) { if (isDev) console.error('Plaid load error:', err); }
      finally { if (!cancelled) setLoadingPlaid(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [plaidItems.map(i => i.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps -- string key intentionally tracks identity of plaid items; fetchTransactions is a stable import

  const plaidCashFlow = calcCashFlow(transactions);

  // â”€â”€ Effective cash flow (Plaid preferred, manual fallback) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const effectiveFlow = useMemo(() => {
    if (plaidCashFlow) return { income: plaidCashFlow.income, spending: plaidCashFlow.spending, surplus: plaidCashFlow.surplus, source: 'plaid' };
    if (manualCashFlow) return {
      income:   manualCashFlow.monthlyIncome   || 0,
      spending: manualCashFlow.monthlySpending  || 0,
      surplus:  manualCashFlow.monthlySurplus   || 0,
      source: 'manual',
      importedAt: manualCashFlow.updatedAt || manualCashFlow.importedAt,
      importedFrom: manualCashFlow.importedFrom,
    };
    return null;
  }, [plaidCashFlow, manualCashFlow]); // eslint-disable-line react-hooks/exhaustive-deps -- only the derived cash flow values trigger recalculation; helper functions are stable

  // â”€â”€ Financial health metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const totalMinimums      = debtAccounts.reduce((s, a) => s + (a.minimumPayment || 0), 0);
  const surplus            = effectiveFlow?.surplus ?? 0;
  const extraAfterMinimums = surplus - totalMinimums;
  const debtFreeMonths     = totalDebt > 0 && extraAfterMinimums > 0 ? Math.ceil(totalDebt / extraAfterMinimums) : null;
  const coveragePct        = totalMinimums > 0 ? Math.round((surplus / totalMinimums) * 100) : null;
  const isDanger           = effectiveFlow && surplus < 0;
  const isWarning          = effectiveFlow && !isDanger && totalMinimums > 0 && surplus < totalMinimums;
  const netWorth           = (totalAssets || 0) - totalDebt;

  // Goal alignment (active financial goal pace)
  const finGoal = useMemo(() => goals.find(g => g.status === 'active' && g.goalType === 'financial'), [goals]);
  const goalPace = useMemo(() => {
    if (!finGoal?.targetAmount || finGoal.currentAmount == null || !finGoal.targetDate) return null;
    const [y, m] = finGoal.targetDate.split('-').map(Number);
    const now = new Date();
    const monthsLeft = (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1));
    if (monthsLeft <= 0) return null;
    const needed = finGoal.targetAmount - (finGoal.currentAmount || 0);
    const requiredPerMonth = Math.round(needed / monthsLeft);
    return { requiredPerMonth, onPace: surplus >= requiredPerMonth, monthsLeft, goalTitle: finGoal.title };
  }, [finGoal, surplus]);

  // â”€â”€ Plaid connect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleConnect = async () => {
    setConnecting(true);
    try {
      await openPlaidLink(user.uid, async (data) => {
        await savePlaidItem(user.uid, data.itemId, { accessToken: data.accessToken, itemId: data.itemId, institutionId: data.institutionId, institutionName: data.institutionName, accounts: data.accounts });
      });
    } catch (err) { if (isDev) console.error('Plaid connect error:', err); }
    finally { setConnecting(false); }
  };

  // â”€â”€ Debt account grouping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [openGroups, setOpenGroups] = useState(new Set());
  const toggleGroup = (type) => setOpenGroups(prev => {
    const next = new Set(prev);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });

  const TYPE_ORDER = ['tax', 'mortgage', 'auto', 'student', 'credit', 'business', 'personal', 'medical', 'other'];
  const highestBalance = Math.max(...debtAccounts.map(a => a.balance || 0), 1);
  const groupedDebt = useMemo(() => {
    const groups = {};
    for (const a of debtAccounts) {
      const t = a.type || 'other';
      if (!groups[t]) groups[t] = [];
      groups[t].push(a);
    }
    return TYPE_ORDER
      .filter(t => groups[t]?.length > 0)
      .map(t => {
        const accs         = [...groups[t]].sort((a, b) => (b.balance || 0) - (a.balance || 0));
        const typeLabel    = DEBT_TYPES.find(dt => dt.value === t)?.label || t;
        const totalBalance = accs.reduce((s, a) => s + (a.balance || 0), 0);
        const totalMin     = accs.reduce((s, a) => s + (a.minimumPayment || 0), 0);
        const totalInterest = Math.round(accs.reduce((s, a) => s + ((a.balance || 0) * ((a.interestRate || 0) / 100 / 12)), 0));
        return { type: t, label: typeLabel, accounts: accs, totalBalance, totalMin, totalInterest };
      });
  }, [debtAccounts]); // eslint-disable-line react-hooks/exhaustive-deps -- DEBT_TYPES is a module-level constant, not a reactive value

  const fetchAI = async () => {
    if (!debtAccounts.length) return;
    setAiLoading(true);
    const text = await getDebtAdvice(debtAccounts);
    setAiText(text || 'Focus on the highest-interest debt first. Every extra dollar there saves the most.');
    setAiLoading(false);
  };

  const openNew  = () => { setForm(emptyForm); setEditing(null); setShowModal(true); };
  const openEdit = (a) => {
    setForm({ name: a.name || '', balance: String(a.balance ?? ''), interestRate: String(a.interestRate ?? ''), type: a.type || 'personal', minimumPayment: String(a.minimumPayment ?? ''), notes: a.notes || '' });
    setEditing(a.id); setShowModal(true);
  };
  const handleSave = async () => {
    if (!form.name.trim() || !form.balance) return;
    setSaving(true);
    const data = { name: form.name.trim(), balance: parseFloat(form.balance) || 0, interestRate: parseFloat(form.interestRate) || 0, type: form.type, minimumPayment: parseFloat(form.minimumPayment) || 0, notes: form.notes };
    if (editing) { await updateDebtAccount(user.uid, editing, data); }
    else         { await addDebtAccount(user.uid, data); }
    setSaving(false); setShowModal(false); setAiText('');
  };
  const handleDelete = async (id) => {
    if (!window.confirm('Remove this account?')) return;
    await deleteDebtAccount(user.uid, id); setAiText('');
  };

  useEffect(() => { if (debtAccounts.length > 0 && !aiText) fetchAI(); }, [debtAccounts]); // eslint-disable-line react-hooks/exhaustive-deps -- fetchAI lacks useCallback; aiText intentionally omitted to avoid re-running when advice text changes

  // â”€â”€ File import (up to 10 files) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 10);
    if (!files.length) return;
    setImportLoading(true); setImportError(''); setImportProgress(null);

    const token        = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    const allAccounts  = [];
    const allCashFlows = [];
    const summaries    = [];
    const skipped      = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setImportProgress({ current: i + 1, total: files.length });
      try {
        let payload;
        if (/\.(xlsx|xls|csv)$/i.test(file.name)) {
          const arrayBuffer = await file.arrayBuffer();
          const workbook    = XLSX.read(arrayBuffer, { type: 'array' });
          // Convert all sheets to plain text to stay well under Vercel's 4.5MB body limit
          const textParts = [];
          for (const sheetName of workbook.SheetNames) {
            const sheet    = workbook.Sheets[sheetName];
            const rows     = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            const nonEmpty = rows.filter(r => r.some(c => c !== '' && c != null)).slice(0, 200);
            if (nonEmpty.length > 0) {
              textParts.push(`=== Sheet: ${sheetName} ===`);
              nonEmpty.forEach(row => textParts.push(row.map(c => String(c ?? '')).join('\t')));
            }
          }
          const tableText = textParts.join('\n').slice(0, 40000);
          payload = { type: 'structured', data: { text: tableText }, fileName: file.name };
        } else if (/\.pdf$/i.test(file.name)) {
          const base64 = await fileToBase64(file);
          payload = { type: 'pdf', data: base64, fileName: file.name };
        } else {
          skipped.push(file.name); continue;
        }

        const res  = await fetch('/api/finance/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          body: JSON.stringify({ ...payload, existingAccounts: debtAccounts }),
        });
        const data = await res.json();
        if (!res.ok) { skipped.push(file.name); continue; }

        if (data.accounts?.length) allAccounts.push(...data.accounts);
        if (data.cashFlow)         allCashFlows.push(data.cashFlow);
        if (data.summary)          summaries.push(data.summary);
      } catch (err) {
        if (isDev) console.error(`Error processing ${file.name}:`, err);
        skipped.push(file.name);
      }
    }

    if (allAccounts.length === 0 && allCashFlows.length === 0) {
      setImportError('No financial data found in the selected files. Check that the files contain account or transaction data.');
      setImportLoading(false); setImportProgress(null); e.target.value = ''; return;
    }

    // Merge accounts â€” deduplicate by normalized name
    // normName strips apostrophes, spaces, punctuation, and parentheses so that
    // "Lowe's" === "Lowes" and "Mastercard (Leadbank)" normalizes cleanly
    const normName = n => (n || '').toLowerCase().replace(/[''`'\s\-.,()]/g, '').trim();
    const accountMap = new Map();
    for (const a of allAccounts) {
      const key = normName(a.name);
      const prev = accountMap.get(key);
      if (!prev || (parseFloat(a.balance) || 0) > (parseFloat(prev.balance) || 0)) accountMap.set(key, a);
    }
    const preDedupList = Array.from(accountMap.values()).map(a => ({
      ...a,
      balance:        String(a.balance        || ''),
      interestRate:   String(a.interestRate   || ''),
      minimumPayment: String(a.minimumPayment || ''),
      existingId:     a.isDuplicate ? (debtAccounts.find(e => normName(e.name) === normName(a.name))?.id || null) : null,
    }));

    // Second-pass containment dedup: catches "Best Buy Credit" vs "Best Buy Credit Card"
    // (one normalized name is a prefix of the other â†’ likely the same account)
    const dominated = new Set();
    for (let i = 0; i < preDedupList.length; i++) {
      if (dominated.has(i)) continue;
      const normA = normName(preDedupList[i].name);
      if (normA.length < 6) continue;
      for (let j = i + 1; j < preDedupList.length; j++) {
        if (dominated.has(j)) continue;
        const normB = normName(preDedupList[j].name);
        if (normB.length < 6) continue;
        if (normB.startsWith(normA) || normA.startsWith(normB)) {
          // Keep the entry with the higher balance; tiebreak keeps i
          const balA = parseFloat(preDedupList[i].balance) || 0;
          const balB = parseFloat(preDedupList[j].balance) || 0;
          dominated.add(balB > balA ? i : j);
        }
      }
    }
    const mergedAccounts = preDedupList.filter((_, i) => !dominated.has(i));

    // Merge cash flow â€” average across files (handles multiple months of same bank without inflating)
    const mergedCF = allCashFlows.length > 0 ? (() => {
      const n    = allCashFlows.length;
      const inc  = Math.round(allCashFlows.reduce((s, cf) => s + (cf.monthlyIncome   || 0), 0) / n);
      const spen = Math.round(allCashFlows.reduce((s, cf) => s + (cf.monthlySpending || 0), 0) / n);
      return { monthlyIncome: inc, monthlySpending: spen, monthlySurplus: inc - spen,
        notes: n > 1 ? `Monthly average across ${n} statements` : (allCashFlows[0]?.notes || '') };
    })() : null;

    const processedCount = files.length - skipped.length;
    const combinedSummary = files.length > 1
      ? `Processed ${processedCount} of ${files.length} file${files.length !== 1 ? 's' : ''} â€” found ${mergedAccounts.length} account${mergedAccounts.length !== 1 ? 's' : ''}${allCashFlows.length > 0 ? ` and cash flow from ${allCashFlows.length} source${allCashFlows.length !== 1 ? 's' : ''}` : ''}${skipped.length > 0 ? `. Skipped: ${skipped.join(', ')}` : ''}.`
      : (summaries[0] || `Found ${mergedAccounts.length} accounts.`);

    const cfForState = mergedCF ? {
      monthlyIncome: String(mergedCF.monthlyIncome), monthlySpending: String(mergedCF.monthlySpending), monthlySurplus: String(mergedCF.monthlySurplus),
    } : { monthlyIncome: '', monthlySpending: '', monthlySurplus: '' };

    // â”€â”€ Smart account matching (clarify API) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let finalAccounts = mergedAccounts;
    let clarifyResult = null;

    if (debtAccounts.length > 0 && mergedAccounts.length > 0) {
      try {
        const cRes = await fetch('/api/finance/clarify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ extractedAccounts: mergedAccounts, existingAccounts: debtAccounts }),
        });
        if (cRes.ok) {
          clarifyResult = await cRes.json();
          // Auto-apply exact matches (no user confirmation needed)
          finalAccounts = mergedAccounts.map((a, i) => {
            const match = (clarifyResult.matches || []).find(m => m.extractedIndex === i);
            if (match?.matchType === 'exact' && match.existingIndex != null && match.existingIndex < debtAccounts.length) {
              return { ...a, isDuplicate: true, existingId: debtAccounts[match.existingIndex].id };
            }
            return a;
          });
        }
      } catch (err) {
        if (isDev) console.error('Clarify API error:', err);
      }
    }

    // Stage common state regardless of which modal comes next
    setEditableAccounts(finalAccounts);
    setSelectedIndices(new Set(finalAccounts.map((_, i) => i)));
    setImportCashFlow(mergedCF);
    setIncludeCashFlow(!!mergedCF);
    setEditableCF(cfForState);
    setImportSummary(combinedSummary);
    setImportFileName(files.map(f => f.name).join(', '));
    setImportLoading(false); setImportProgress(null);
    e.target.value = '';

    const questions = clarifyResult?.questions || [];
    if (questions.length > 0) {
      // Show clarification step first â€” stash clarify data for handleClarifyComplete
      setClarifyData(clarifyResult);
      setClarifyAnswers({});
      setShowClarifyModal(true);
    } else {
      // No questions â€” surface any insights inline then go straight to review
      if (clarifyResult) setClarifyData(clarifyResult);
      setShowImportModal(true);
    }
  };

  const toggleImportIndex = (i) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const toggleAllImport = () => {
    if (selectedIndices.size === editableAccounts.length) setSelectedIndices(new Set());
    else setSelectedIndices(new Set(editableAccounts.map((_, i) => i)));
  };

  // Apply user's answers from the clarify modal then open the review modal
  const handleClarifyComplete = () => {
    setEditableAccounts(prev => prev.map((a, i) => {
      const q = (clarifyData?.questions || []).find(q => q.extractedIndex === i);
      if (!q) return a;
      if (clarifyAnswers[i] === 'yes' && q.existingIndex != null && q.existingIndex < debtAccounts.length) {
        return { ...a, isDuplicate: true, existingId: debtAccounts[q.existingIndex].id };
      }
      return a; // user said "no" â€” treat as new account
    }));
    setShowClarifyModal(false);
    setClarifyData(null);
    setClarifyAnswers({});
    setShowImportModal(true);
  };

  // â”€â”€ Asset account handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openAssetNew  = () => { setAssetForm(emptyAssetForm); setEditingAsset(null); setShowAssetModal(true); };
  const openAssetEdit = (a) => {
    setAssetForm({ name: a.name || '', balance: String(a.balance || ''), type: a.type || 'checking', notes: a.notes || '' });
    setEditingAsset(a.id); setShowAssetModal(true);
  };
  const handleAssetSave = async () => {
    if (!assetForm.name.trim() || !assetForm.balance) return;
    setSavingAsset(true);
    const data = { name: assetForm.name.trim(), balance: parseFloat(assetForm.balance) || 0, type: assetForm.type, notes: assetForm.notes };
    if (editingAsset) await updateAssetAccount(user.uid, editingAsset, data);
    else              await addAssetAccount(user.uid, data);
    setSavingAsset(false); setShowAssetModal(false);
  };
  const handleAssetDelete = async (id) => {
    if (!window.confirm('Remove this asset account?')) return;
    await deleteAssetAccount(user.uid, id);
  };

  const handleImportConfirm = async () => {
    setImportSaving(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      for (const idx of selectedIndices) {
        const a    = editableAccounts[idx];
        const bal  = parseFloat(a.balance) || 0;
        const data = { name: (a.name || '').trim(), balance: bal, interestRate: parseFloat(a.interestRate) || 0, minimumPayment: parseFloat(a.minimumPayment) || 0, type: a.type || 'other', notes: a.notes || '' };
        if (a.isDuplicate && a.existingId) {
          await updateDebtAccount(user.uid, a.existingId, data);
          await addDebtBalanceSnapshot(user.uid, a.existingId, bal);
        } else {
          await addDebtAccount(user.uid, { ...data, balanceHistory: [{ date: today, balance: bal }] });
        }
      }

      if (includeCashFlow) {
        const inc  = parseFloat(editableCF.monthlyIncome)   || 0;
        const spen = parseFloat(editableCF.monthlySpending)  || 0;
        const sur  = parseFloat(editableCF.monthlySurplus)   || (inc - spen);
        await saveManualCashFlow(user.uid, { monthlyIncome: inc, monthlySpending: spen, monthlySurplus: sur, importedFrom: importFileName, importedAt: new Date().toISOString() });
      }

      // Create upload reminder for next month
      const next     = new Date(); next.setMonth(next.getMonth() + 1);
      const monthLbl = next.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const dueDate  = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-15`;
      await addTask(user.uid, { title: `Upload ${monthLbl} bank statements`, priority: 'medium', dueDate, goalId: finGoal?.id || null, source: 'finance-import' });

      setShowImportModal(false); setClarifyData(null); setAiText('');
    } catch (err) { if (isDev) console.error('Import save error:', err); }
    finally { setImportSaving(false); }
  };

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>

      {/* â”€â”€ Header â”€â”€ */}
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Finance</div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Finance OS</h1>
          <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>Real accounts. Real numbers. No guessing.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
          <Button onClick={() => fileInputRef.current?.click()} loading={importLoading} variant="ghost" size="sm">
            {importLoading ? (importProgress ? `Reading ${importProgress.current}/${importProgress.total}...` : 'Reading...') : 'â†‘ Import Files'}
          </Button>
          <Button onClick={openNew} variant="ghost" size="sm">+ Manual</Button>
        </div>
      </div>

      {/* Import error banner */}
      {importError && (
        <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'rgba(212,122,107,0.1)', border: '1px solid rgba(212,122,107,0.25)', borderRadius: '8px', fontSize: '13px', color: tokens.red, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {importError}
          <button onClick={() => setImportError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.red, fontSize: '16px', lineHeight: 1 }}>Ã—</button>
        </div>
      )}

      {/* â”€â”€ Plaid: no accounts connected â”€â”€ */}
      {plaidItems.length === 0 && (
        <div className="fade-up stagger-1" style={{ marginBottom: '16px' }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(91,143,212,0.08), rgba(91,143,212,0.03))', border: `1px dashed rgba(91,143,212,0.3)`, borderRadius: tokens.radiusLg, padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '4px' }}>Connect your bank accounts</div>
                <div style={{ fontSize: '12px', color: tokens.textMuted }}>See live balances and transactions â€” or use â†‘ Import File to upload a statement manually.</div>
              </div>
              <Button loading={connecting} onClick={handleConnect}>Connect Bank</Button>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Plaid: connected accounts â”€â”€ */}
      {plaidItems.length > 0 && (
        <div className="fade-up stagger-1" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>Connected Accounts</SectionLabel>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {loadingPlaid && <span style={{ fontSize: '11px', color: tokens.textMuted }}>Refreshing...</span>}
              <Button size="sm" loading={connecting} onClick={handleConnect}>+ Add Bank</Button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {plaidItems.map(item => {
              const itemAccounts = plaidAccounts.filter(a => a.institutionName === item.institutionName);
              return (
                <Card key={item.id} style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: itemAccounts.length ? '12px' : 0 }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div style={{ width: 34, height: 34, borderRadius: '8px', background: tokens.bgInput, border: `1px solid ${tokens.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>ðŸ¦</div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>{item.institutionName}</div>
                        <div style={{ fontSize: '11px', color: tokens.green, marginTop: '1px' }}>â— Connected</div>
                      </div>
                    </div>
                    <button onClick={() => deletePlaidItem(user.uid, item.id)} style={{ background: 'none', border: 'none', color: tokens.red, fontSize: '11px', cursor: 'pointer', opacity: 0.55, fontFamily: fonts.body, padding: '2px 6px' }}>Disconnect</button>
                  </div>
                  {itemAccounts.map(account => (
                    <div key={account.account_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${tokens.border}` }}>
                      <div>
                        <div style={{ fontSize: '13px', color: tokens.textPrimary }}>{account.name}</div>
                        <div style={{ fontSize: '10px', color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>{account.subtype}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: fonts.display, fontSize: '17px', fontWeight: 700, color: account.type === 'credit' ? tokens.red : tokens.green }}>
                          ${(account.balances.current || 0).toLocaleString()}
                        </div>
                        {account.balances.available != null && account.balances.available !== account.balances.current && (
                          <div style={{ fontSize: '10px', color: tokens.textMuted }}>${account.balances.available.toLocaleString()} avail.</div>
                        )}
                      </div>
                    </div>
                  ))}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* â”€â”€ Financial Health Dashboard â”€â”€ */}
      {effectiveFlow && (
        <div className="fade-up stagger-2" style={{ marginBottom: '16px' }}>

          {/* Danger / warning alert */}
          {isDanger && (
            <div style={{ marginBottom: '10px', padding: '10px 14px', background: 'rgba(212,122,107,0.1)', border: '1px solid rgba(212,122,107,0.3)', borderRadius: '8px', fontSize: '13px', color: tokens.red, fontWeight: 600 }}>
              âš  Monthly spending exceeds income by ${Math.abs(surplus).toLocaleString()}. Address this before adding extra debt payments.
            </div>
          )}
          {isWarning && (
            <div style={{ marginBottom: '10px', padding: '10px 14px', background: 'rgba(200,169,110,0.1)', border: '1px solid rgba(200,169,110,0.3)', borderRadius: '8px', fontSize: '13px', color: tokens.amber, fontWeight: 600 }}>
              âš  Monthly surplus (${surplus.toLocaleString()}) is less than total minimums (${totalMinimums.toLocaleString()}). Review your budget.
            </div>
          )}

          {/* Cash flow row */}
          <Card style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <SectionLabel style={{ marginBottom: 0 }}>Monthly Cash Flow</SectionLabel>
              <span style={{ fontSize: '10px', color: tokens.textMuted }}>
                {effectiveFlow.source === 'plaid' ? 'Via Plaid Â· last 30 days' : `Via import Â· ${fmtImportDate(effectiveFlow.importedAt)}${effectiveFlow.importedFrom ? ' Â· ' + effectiveFlow.importedFrom : ''}`}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', textAlign: 'center' }}>
              {[
                { label: 'Income',   val: effectiveFlow.income,   color: tokens.green, prefix: '+$' },
                { label: 'Spending', val: effectiveFlow.spending,  color: tokens.red,   prefix: '-$' },
                { label: 'Surplus',  val: Math.abs(effectiveFlow.surplus), color: surplus >= 0 ? tokens.accent : tokens.red, prefix: surplus >= 0 ? '+$' : '-$' },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{item.label}</div>
                  <div style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color: item.color }}>
                    {item.prefix}{(item.val || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Metrics row */}
          {debtAccounts.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: goalPace ? 'repeat(3, 1fr)' : '1fr 1fr', gap: '10px' }}>
              {/* Minimums coverage */}
              <Card style={{ padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Min. Coverage</div>
                {coveragePct !== null ? (
                  <>
                    <div style={{ fontFamily: fonts.display, fontSize: '24px', fontWeight: 700, color: coveragePct >= 100 ? tokens.green : tokens.red }}>{coveragePct}%</div>
                    <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '4px' }}>
                      {coveragePct >= 100 ? `${(surplus - totalMinimums).toLocaleString()} left after minimums` : `$${(totalMinimums - surplus).toLocaleString()} shortfall`}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '12px', color: tokens.textMuted }}>No minimums set</div>
                )}
              </Card>

              {/* Debt-free estimate */}
              <Card style={{ padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Debt-Free Est.</div>
                {debtFreeMonths !== null ? (
                  <>
                    <div style={{ fontFamily: fonts.display, fontSize: '24px', fontWeight: 700, color: debtFreeMonths <= 24 ? tokens.green : debtFreeMonths <= 60 ? tokens.accent : tokens.amber }}>
                      {debtFreeMonths <= 11 ? `${debtFreeMonths}mo` : `${(debtFreeMonths / 12).toFixed(1)}yr`}
                    </div>
                    <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '4px' }}>at current surplus rate</div>
                  </>
                ) : (
                  <div style={{ fontSize: '12px', color: tokens.textMuted }}>{extraAfterMinimums <= 0 ? 'Need more surplus' : 'Debt free!'}</div>
                )}
              </Card>

              {/* Goal alignment */}
              {goalPace && (
                <Card style={{ padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Goal Pace</div>
                  <div style={{ fontFamily: fonts.display, fontSize: '24px', fontWeight: 700, color: goalPace.onPace ? tokens.green : tokens.red }}>
                    {goalPace.onPace ? 'On Track' : 'Behind'}
                  </div>
                  <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '4px' }}>
                    {goalPace.onPace
                      ? `Need $${goalPace.requiredPerMonth.toLocaleString()}/mo âœ“`
                      : `Need $${goalPace.requiredPerMonth.toLocaleString()}/mo, have $${surplus.toLocaleString()}`}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* â”€â”€ Net Worth â”€â”€ */}
      {(totalDebt > 0 || (assetAccounts || []).length > 0) && (
        <div className="fade-up stagger-3" style={{ marginBottom: '16px' }}>
          <Card>
            <SectionLabel>Net Worth</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', textAlign: 'center' }}>
              {[
                { label: 'Assets', val: totalAssets || 0, color: tokens.green, prefix: '+$' },
                { label: 'Debts',  val: totalDebt,        color: tokens.red,   prefix: '-$' },
                { label: 'Net Worth', val: Math.abs(netWorth), color: netWorth >= 0 ? tokens.accent : tokens.red, prefix: netWorth >= 0 ? '+$' : '-$' },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{item.label}</div>
                  <div style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color: item.color }}>
                    {item.prefix}{item.val.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* â”€â”€ Recent Transactions (Plaid only) â”€â”€ */}
      {transactions.length > 0 && (
        <div className="fade-up stagger-3" style={{ marginBottom: '16px' }}>
          <Card>
            <SectionLabel>Recent Transactions</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {transactions.slice(0, showAllTx ? undefined : 12).map(tx => (
                <div key={tx.transaction_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${tokens.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: tokens.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.merchant_name || tx.name}</div>
                    <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '2px' }}>{formatTxDate(tx.date)} Â· {(tx.personal_finance_category?.primary || tx.category?.[0] || 'Uncategorized').replace(/_/g, ' ')}</div>
                  </div>
                  <div style={{ fontFamily: fonts.display, fontSize: '14px', fontWeight: 600, color: tx.amount < 0 ? tokens.green : tokens.textPrimary, flexShrink: 0, marginLeft: '16px' }}>{formatTxAmount(tx.amount)}</div>
                </div>
              ))}
            </div>
            {transactions.length > 12 && (
              <button onClick={() => setShowAllTx(t => !t)} style={{ marginTop: '12px', fontSize: '12px', color: tokens.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.body }}>
                {showAllTx ? 'Show less' : `Show all ${transactions.length} transactions`}
              </button>
            )}
          </Card>
        </div>
      )}

      {/* â”€â”€ Debt Accounts â”€â”€ */}
      <div className="fade-up stagger-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <SectionLabel style={{ marginBottom: 0 }}>Debt Accounts</SectionLabel>
        <Button onClick={openNew} size="sm">+ Add Account</Button>
      </div>

      {debtAccounts.length > 0 && (
        <div className="fade-up stagger-4" style={{ marginBottom: '16px' }}>
          <Card accent>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <SectionLabel>Total Debt Load</SectionLabel>
                <div style={{ fontFamily: fonts.display, fontSize: '38px', fontWeight: 700, color: tokens.red, lineHeight: 1 }}>${totalDebt.toLocaleString()}</div>
                <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '4px' }}>{debtAccounts.length} account{debtAccounts.length !== 1 ? 's' : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '12px', color: tokens.textMuted, marginBottom: '4px' }}>Monthly Minimums</div>
                <div style={{ fontFamily: fonts.display, fontSize: '22px', color: tokens.amber }}>${totalMinimums.toLocaleString()}</div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {debtAccounts.length > 0 && (
        <div className="fade-up stagger-5" style={{ marginBottom: '16px' }}>
          <AICard text={aiText} loading={aiLoading} onRefresh={fetchAI} label="PAYOFF STRATEGY" />
        </div>
      )}

      {debtAccounts.length > 0 && (
        <div className="fade-up stagger-5">
          <PayoffSimulator accounts={debtAccounts} />
        </div>
      )}

      <div className="fade-up stagger-5" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {debtAccounts.length === 0 ? (
          <EmptyState icon="â—‰" title="No debt accounts tracked" subtitle="Import a bank statement or add accounts manually to get started." action={
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button onClick={() => fileInputRef.current?.click()} variant="ghost">â†‘ Import File</Button>
              <Button onClick={openNew}>+ Add Manually</Button>
            </div>
          } />
        ) : (
          groupedDebt.map(({ type, label, accounts, totalBalance, totalMin, totalInterest }) => {
            const tc     = typeColors[type] || typeColors.other;
            const isOpen = openGroups.has(type);
            return (
              <div key={type} style={{ border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg, overflow: 'hidden', background: tokens.bgCard }}>
                {/* Group header â€” click to expand/collapse */}
                <button
                  onClick={() => toggleGroup(type)}
                  style={{ width: '100%', background: 'transparent', border: 'none', padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: fonts.body, textAlign: 'left' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '4px', background: tc.bg, color: tc.text, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>{label}</span>
                    <span style={{ fontSize: '12px', color: tokens.textMuted }}>{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: fonts.display, fontSize: '16px', fontWeight: 700, color: totalBalance > 0 ? tokens.red : tokens.textMuted }}>
                        ${totalBalance.toLocaleString()}
                      </div>
                      <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '1px' }}>
                        Min ${totalMin.toLocaleString()}/mo{totalInterest > 0 ? ` Â· ~$${totalInterest.toLocaleString()}/mo interest` : ''}
                      </div>
                    </div>
                    <span style={{ fontSize: '10px', color: tokens.textMuted, display: 'inline-block', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>â–¼</span>
                  </div>
                </button>

                {/* Expanded accounts */}
                {isOpen && (
                  <div style={{ borderTop: `1px solid ${tokens.border}` }}>
                    {accounts.map((account, i) => {
                      const pct = Math.max(0, Math.min(100, ((account.balance || 0) / highestBalance) * 100));
                      return (
                        <div key={account.id} style={{ padding: '14px 16px', borderBottom: i < accounts.length - 1 ? `1px solid ${tokens.border}` : 'none', background: tokens.bgCard }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                              <div style={{ fontWeight: 600, fontSize: '14px', color: tokens.textPrimary }}>{account.name}</div>
                              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                                {account.interestRate || 0}% APR Â· Min ${(account.minimumPayment || 0).toLocaleString()}/mo
                                {account.interestRate > 0 && account.balance > 0 && (
                                  <span style={{ color: tokens.amber }}> Â· ~${Math.round(account.balance * account.interestRate / 100 / 12).toLocaleString()}/mo interest</span>
                                )}
                              </div>
                            </div>
                            <span style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: (account.balance || 0) > 0 ? tokens.red : tokens.textMuted, flexShrink: 0 }}>
                              ${(account.balance || 0).toLocaleString()}
                            </span>
                          </div>
                          {(account.balance || 0) > 0 && <MomentumBar value={pct} color={tokens.red} height={3} />}
                          {account.notes && <div style={{ marginTop: '6px', fontSize: '11px', color: tokens.textMuted }}>{account.notes}</div>}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '10px' }}>
                            <Button onClick={() => openEdit(account)} variant="ghost" size="sm">Edit</Button>
                            <Button onClick={() => handleDelete(account.id)} variant="danger" size="sm">Remove</Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* â”€â”€ Manual account modal â”€â”€ */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Account' : 'Add Debt Account'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Account Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="e.g. IRS Tax Debt 2023" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Input label="Current Balance ($)" value={form.balance} onChange={v => setForm(f => ({ ...f, balance: v }))} placeholder="25000" type="number" />
            <Input label="Interest Rate (%)" value={form.interestRate} onChange={v => setForm(f => ({ ...f, interestRate: v }))} placeholder="18.5" type="number" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Select label="Type" value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))} options={DEBT_TYPES} />
            <Input label="Monthly Minimum ($)" value={form.minimumPayment} onChange={v => setForm(f => ({ ...f, minimumPayment: v }))} placeholder="250" type="number" />
          </div>
          <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Context, payment plan details..." multiline rows={2} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button onClick={() => setShowModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.name.trim() || (form.balance === '' && !editing)}>{editing ? 'Save' : 'Add Account'}</Button>
          </div>
        </div>
      </Modal>

      {/* â”€â”€ Import Review Modal â”€â”€ */}
      <Modal open={showImportModal} onClose={() => setShowImportModal(false)} title="Review Extracted Data">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Summary */}
          {importSummary && (
            <div style={{ padding: '10px 14px', background: tokens.accentDim, borderRadius: '8px', fontSize: '13px', color: tokens.textSecondary }}>
              âœ¦ {importSummary}
            </div>
          )}

          {/* Insights from clarify step (shown when questions were skipped) */}
          {(clarifyData?.insights || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {clarifyData.insights.map((insight, i) => (
                <div key={i} style={{ padding: '7px 12px', background: 'rgba(109,191,158,0.08)', border: '1px solid rgba(109,191,158,0.2)', borderRadius: '8px', fontSize: '12px', color: tokens.textSecondary }}>
                  ðŸ’¡ {insight}
                </div>
              ))}
            </div>
          )}

          {/* Accounts section */}
          {editableAccounts.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <SectionLabel style={{ marginBottom: 0 }}>Accounts Found ({editableAccounts.length})</SectionLabel>
                <button onClick={toggleAllImport} style={{ fontSize: '11px', color: tokens.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.body }}>
                  {selectedIndices.size === editableAccounts.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {editableAccounts.map((a, i) => (
                  <div key={i} style={{ padding: '12px', background: selectedIndices.has(i) ? tokens.bgCardHover : 'transparent', border: `1px solid ${selectedIndices.has(i) ? tokens.border : 'transparent'}`, borderRadius: '10px', transition: 'all 0.15s' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                      <input type="checkbox" checked={selectedIndices.has(i)} onChange={() => toggleImportIndex(i)}
                        style={{ width: '16px', height: '16px', accentColor: tokens.accent, flexShrink: 0, cursor: 'pointer' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <input
                          value={a.name}
                          onChange={e => setEditableAccounts(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                          style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: `1px solid ${tokens.border}`, padding: '2px 0', fontSize: '14px', fontWeight: 600, color: tokens.textPrimary, fontFamily: fonts.body, outline: 'none' }}
                        />
                      </div>
                      {a.isDuplicate && <span style={{ fontSize: '10px', color: tokens.amber, background: 'rgba(200,169,110,0.12)', padding: '2px 7px', borderRadius: '4px', fontWeight: 700, flexShrink: 0 }}>exists Â· will update</span>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', paddingLeft: '26px' }}>
                      <div>
                        <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '3px' }}>TYPE</div>
                        <select value={a.type} onChange={e => setEditableAccounts(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                          style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '4px 6px', fontSize: '11px', color: tokens.textPrimary, fontFamily: fonts.body, cursor: 'pointer' }}>
                          {DEBT_TYPES.map(dt => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
                        </select>
                      </div>
                      {[
                        { label: 'Balance $', field: 'balance' },
                        { label: 'Rate %',    field: 'interestRate' },
                        { label: 'Min/mo $',  field: 'minimumPayment' },
                      ].map(({ label, field }) => (
                        <div key={field}>
                          <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '3px' }}>{label}</div>
                          <input type="number" value={a[field]}
                            onChange={e => setEditableAccounts(prev => prev.map((x, j) => j === i ? { ...x, [field]: e.target.value } : x))}
                            style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '4px 6px', fontSize: '12px', color: tokens.textPrimary, fontFamily: fonts.body, outline: 'none' }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {editableAccounts.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: tokens.textMuted, fontSize: '13px' }}>
              No debt accounts found in this file. You can still import cash flow data below.
            </div>
          )}

          {/* Cash flow section */}
          {importCashFlow && (
            <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <SectionLabel style={{ marginBottom: 0 }}>Cash Flow Data</SectionLabel>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: tokens.textSecondary }}>
                  <input type="checkbox" checked={includeCashFlow} onChange={e => setIncludeCashFlow(e.target.checked)}
                    style={{ accentColor: tokens.accent, cursor: 'pointer' }} />
                  Include in import
                </label>
              </div>
              {includeCashFlow && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {[
                    { label: 'Monthly Income $',   field: 'monthlyIncome' },
                    { label: 'Monthly Spending $',  field: 'monthlySpending' },
                    { label: 'Monthly Surplus $',   field: 'monthlySurplus' },
                  ].map(({ label, field }) => (
                    <div key={field}>
                      <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '4px' }}>{label}</div>
                      <input type="number" value={editableCF[field]}
                        onChange={e => setEditableCF(prev => ({ ...prev, [field]: e.target.value }))}
                        style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '8px 10px', fontSize: '13px', color: tokens.textPrimary, fontFamily: fonts.body, outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                  ))}
                </div>
              )}
              {importCashFlow.notes && (
                <div style={{ marginTop: '8px', fontSize: '11px', color: tokens.textMuted }}>Note: {importCashFlow.notes}</div>
              )}
            </div>
          )}

          {/* Footer note about reminder task */}
          <div style={{ fontSize: '11px', color: tokens.textMuted, padding: '8px 0', borderTop: `1px solid ${tokens.border}` }}>
            A reminder task will be created to upload next month's statements.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button onClick={() => setShowImportModal(false)} variant="ghost">Cancel</Button>
            <Button
              onClick={handleImportConfirm}
              loading={importSaving}
              disabled={selectedIndices.size === 0 && !includeCashFlow}
            >
              Import {selectedIndices.size > 0 ? `${selectedIndices.size} Account${selectedIndices.size !== 1 ? 's' : ''}` : 'Cash Flow Only'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* â”€â”€ Clarification Modal (pre-import: smart account matching) â”€â”€ */}
      <Modal open={showClarifyModal} onClose={() => { setShowClarifyModal(false); setClarifyData(null); setClarifyAnswers({}); }} title="Verify Accounts">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '13px', color: tokens.textSecondary }}>
            I found some accounts that might match your existing records. Confirm before importing.
          </div>

          {/* Insights (balance changes) */}
          {(clarifyData?.insights || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {clarifyData.insights.map((insight, i) => (
                <div key={i} style={{ padding: '8px 12px', background: tokens.accentDim, borderRadius: '8px', fontSize: '12px', color: tokens.textSecondary }}>
                  ðŸ’¡ {insight}
                </div>
              ))}
            </div>
          )}

          {/* Questions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {(clarifyData?.questions || []).map((q, qi) => (
              <div key={qi} style={{ padding: '14px', background: tokens.bgCardHover, borderRadius: '10px', border: `1px solid ${tokens.border}` }}>
                <div style={{ fontSize: '13px', color: tokens.textPrimary, marginBottom: '12px', fontWeight: 500 }}>{q.question}</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(q.options || []).map((opt, oi) => {
                    const chosen = clarifyAnswers[q.extractedIndex] === (oi === 0 ? 'yes' : 'no');
                    return (
                      <button key={oi}
                        onClick={() => setClarifyAnswers(prev => ({ ...prev, [q.extractedIndex]: oi === 0 ? 'yes' : 'no' }))}
                        style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', fontFamily: fonts.body, fontWeight: 600, transition: 'all 0.15s',
                          background: chosen ? tokens.accent : tokens.bgInput,
                          color:      chosen ? '#fff' : tokens.textSecondary,
                          border:     `1px solid ${chosen ? tokens.accent : tokens.border}`,
                        }}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px' }}>
            <Button onClick={() => { setShowClarifyModal(false); setClarifyData(null); setClarifyAnswers({}); }} variant="ghost">Cancel</Button>
            <Button
              onClick={handleClarifyComplete}
              disabled={(clarifyData?.questions || []).some(q => !clarifyAnswers[q.extractedIndex])}
            >
              Continue to Review â†’
            </Button>
          </div>
        </div>
      </Modal>

      {/* â”€â”€ Asset Account Modal â”€â”€ */}
      <Modal open={showAssetModal} onClose={() => setShowAssetModal(false)} title={editingAsset ? 'Edit Asset' : 'Add Asset Account'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Account Name" value={assetForm.name} onChange={v => setAssetForm(f => ({ ...f, name: v }))} placeholder="e.g. Veridian Checking, 401k, Home Equity" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Input label="Current Balance ($)" value={assetForm.balance} onChange={v => setAssetForm(f => ({ ...f, balance: v }))} placeholder="15000" type="number" />
            <Select label="Type" value={assetForm.type} onChange={v => setAssetForm(f => ({ ...f, type: v }))} options={ASSET_TYPES} />
          </div>
          <Input label="Notes" value={assetForm.notes} onChange={v => setAssetForm(f => ({ ...f, notes: v }))} placeholder="Institution, account number last 4..." multiline rows={2} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button onClick={() => setShowAssetModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleAssetSave} loading={savingAsset} disabled={!assetForm.name.trim() || !assetForm.balance}>
              {editingAsset ? 'Save' : 'Add Asset'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* â”€â”€ Asset Accounts Section â”€â”€ */}
      <div className="fade-up stagger-6" style={{ marginTop: '32px', paddingTop: '24px', borderTop: `1px solid ${tokens.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div>
            <SectionLabel style={{ marginBottom: '2px' }}>Assets</SectionLabel>
            <p style={{ fontSize: '12px', color: tokens.textMuted, margin: 0 }}>Checking, savings, retirement, investments</p>
          </div>
          <Button onClick={openAssetNew} size="sm">+ Add Asset</Button>
        </div>

        {(assetAccounts || []).length === 0 ? (
          <EmptyState icon="â—ˆ" title="No asset accounts tracked" subtitle="Add checking, savings, retirement, and investment accounts for a complete net worth picture." action={
            <Button onClick={openAssetNew} variant="ghost">+ Add Asset Account</Button>
          } />
        ) : (
          <>
            <div className="fade-up" style={{ marginBottom: '10px' }}>
              <Card accent>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <SectionLabel>Total Assets</SectionLabel>
                    <div style={{ fontFamily: fonts.display, fontSize: '38px', fontWeight: 700, color: tokens.green, lineHeight: 1 }}>${(totalAssets || 0).toLocaleString()}</div>
                    <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '4px' }}>{assetAccounts.length} account{assetAccounts.length !== 1 ? 's' : ''}</div>
                  </div>
                </div>
              </Card>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {assetAccounts.map(account => {
                const tc = assetTypeColors[account.type] || assetTypeColors.other;
                return (
                  <Card key={account.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: tokens.textPrimary }}>{account.name}</div>
                        {account.notes && <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>{account.notes}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0, marginLeft: '12px' }}>
                        <span style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.green }}>${(account.balance || 0).toLocaleString()}</span>
                        <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: tc.bg, color: tc.text, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{account.type}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '10px' }}>
                      <Button onClick={() => openAssetEdit(account)} variant="ghost" size="sm">Edit</Button>
                      <Button onClick={() => handleAssetDelete(account.id)} variant="danger" size="sm">Remove</Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

