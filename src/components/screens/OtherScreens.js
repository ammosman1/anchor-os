// src/components/screens/OtherScreens.js
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

// ─── Payoff simulation math ───────────────────────────────────────────────────
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
            { label: 'Avalanche', sublabel: 'Highest rate first', result: avalanche, color: tokens.green, icon: '▲' },
            { label: 'Snowball',  sublabel: 'Lowest balance first', result: snowball, color: tokens.blue,  icon: '●' },
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
            <span style={{ fontSize: '20px' }}>▲</span>
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
  other:    { bg: 'rgba(28,24,20,0.07)',    text: 'rgba(28,24,20,0.42)'  },
};

// ─── File-to-base64 helper ────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Format import date ───────────────────────────────────────────────────────
function fmtImportDate(ts) {
  if (!ts) return '';
  try {
    const ms = ts.toMillis?.() ?? (ts._seconds ? ts._seconds * 1000 : new Date(ts).getTime());
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

export function DebtScreen() {
  const { user }                                                    = useAuth();
  const { debtAccounts, totalDebt, assetAccounts, totalAssets, plaidItems, manualCashFlow, goals } = useData();

  // ── Existing account modal ────────────────────────────────────────────────
  const [showModal,     setShowModal]     = useState(false);
  const [form,          setForm]          = useState(emptyForm);
  const [editing,       setEditing]       = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [aiText,        setAiText]        = useState('');
  const [aiLoading,     setAiLoading]     = useState(false);
  const [showAllTx,     setShowAllTx]     = useState(false);

  // ── Plaid ─────────────────────────────────────────────────────────────────
  const [plaidAccounts, setPlaidAccounts] = useState([]);
  const [transactions,  setTransactions]  = useState([]);
  const [loadingPlaid,  setLoadingPlaid]  = useState(false);
  const [connecting,    setConnecting]    = useState(false);

  // ── File import ───────────────────────────────────────────────────────────
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

  // ── Asset account modal ───────────────────────────────────────────────────
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetForm,      setAssetForm]      = useState(emptyAssetForm);
  const [editingAsset,   setEditingAsset]   = useState(null);
  const [savingAsset,    setSavingAsset]    = useState(false);

  // ── Clarification modal (pre-import: smart account matching) ─────────────
  const [showClarifyModal, setShowClarifyModal] = useState(false);
  const [clarifyData,      setClarifyData]      = useState(null);  // { matches, questions, insights }
  const [clarifyAnswers,   setClarifyAnswers]   = useState({});    // { [extractedIndex]: 'yes'|'no' }

  // ── Plaid load ────────────────────────────────────────────────────────────
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
      } catch (err) { console.error('Plaid load error:', err); }
      finally { if (!cancelled) setLoadingPlaid(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [plaidItems.map(i => i.id).join(',')]); // eslint-disable-line

  const plaidCashFlow = calcCashFlow(transactions);

  // ── Effective cash flow (Plaid preferred, manual fallback) ────────────────
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
  }, [plaidCashFlow, manualCashFlow]); // eslint-disable-line

  // ── Financial health metrics ──────────────────────────────────────────────
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

  // ── Plaid connect ─────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    try {
      await openPlaidLink(user.uid, async (data) => {
        await savePlaidItem(user.uid, data.itemId, { accessToken: data.accessToken, itemId: data.itemId, institutionId: data.institutionId, institutionName: data.institutionName, accounts: data.accounts });
      });
    } catch (err) { console.error('Plaid connect error:', err); }
    finally { setConnecting(false); }
  };

  // ── Manual account modal ──────────────────────────────────────────────────
  const sorted         = [...debtAccounts].sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0));
  const highestBalance = Math.max(...debtAccounts.map(a => a.balance || 0), 1);

  const fetchAI = async () => {
    if (!debtAccounts.length) return;
    setAiLoading(true);
    const text = await getDebtAdvice(debtAccounts);
    setAiText(text || 'Focus on the highest-interest debt first. Every extra dollar there saves the most.');
    setAiLoading(false);
  };

  const openNew  = () => { setForm(emptyForm); setEditing(null); setShowModal(true); };
  const openEdit = (a) => {
    setForm({ name: a.name || '', balance: String(a.balance || ''), interestRate: String(a.interestRate || ''), type: a.type || 'personal', minimumPayment: String(a.minimumPayment || ''), notes: a.notes || '' });
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

  useEffect(() => { if (debtAccounts.length > 0 && !aiText) fetchAI(); }, []); // eslint-disable-line

  // ── File import (up to 10 files) ─────────────────────────────────────────
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
        console.error(`Error processing ${file.name}:`, err);
        skipped.push(file.name);
      }
    }

    if (allAccounts.length === 0 && allCashFlows.length === 0) {
      setImportError('No financial data found in the selected files. Check that the files contain account or transaction data.');
      setImportLoading(false); setImportProgress(null); e.target.value = ''; return;
    }

    // Merge accounts — deduplicate by normalized name (strips apostrophes/punctuation)
    const normName = n => (n || '').toLowerCase().replace(/[''`'\s\-.,]/g, '').trim();
    const accountMap = new Map();
    for (const a of allAccounts) {
      const key = normName(a.name);
      const prev = accountMap.get(key);
      if (!prev || (parseFloat(a.balance) || 0) > (parseFloat(prev.balance) || 0)) accountMap.set(key, a);
    }
    const mergedAccounts = Array.from(accountMap.values()).map(a => ({
      ...a,
      balance:        String(a.balance        || ''),
      interestRate:   String(a.interestRate   || ''),
      minimumPayment: String(a.minimumPayment || ''),
      existingId:     a.isDuplicate ? (debtAccounts.find(e => normName(e.name) === normName(a.name))?.id || null) : null,
    }));

    // Merge cash flow — average across files (handles multiple months of same bank without inflating)
    const mergedCF = allCashFlows.length > 0 ? (() => {
      const n    = allCashFlows.length;
      const inc  = Math.round(allCashFlows.reduce((s, cf) => s + (cf.monthlyIncome   || 0), 0) / n);
      const spen = Math.round(allCashFlows.reduce((s, cf) => s + (cf.monthlySpending || 0), 0) / n);
      return { monthlyIncome: inc, monthlySpending: spen, monthlySurplus: inc - spen,
        notes: n > 1 ? `Monthly average across ${n} statements` : (allCashFlows[0]?.notes || '') };
    })() : null;

    const processedCount = files.length - skipped.length;
    const combinedSummary = files.length > 1
      ? `Processed ${processedCount} of ${files.length} file${files.length !== 1 ? 's' : ''} — found ${mergedAccounts.length} account${mergedAccounts.length !== 1 ? 's' : ''}${allCashFlows.length > 0 ? ` and cash flow from ${allCashFlows.length} source${allCashFlows.length !== 1 ? 's' : ''}` : ''}${skipped.length > 0 ? `. Skipped: ${skipped.join(', ')}` : ''}.`
      : (summaries[0] || `Found ${mergedAccounts.length} accounts.`);

    const cfForState = mergedCF ? {
      monthlyIncome: String(mergedCF.monthlyIncome), monthlySpending: String(mergedCF.monthlySpending), monthlySurplus: String(mergedCF.monthlySurplus),
    } : { monthlyIncome: '', monthlySpending: '', monthlySurplus: '' };

    // ── Smart account matching (clarify API) ───────────────────────────────
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
        console.error('Clarify API error:', err);
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
      // Show clarification step first — stash clarify data for handleClarifyComplete
      setClarifyData(clarifyResult);
      setClarifyAnswers({});
      setShowClarifyModal(true);
    } else {
      // No questions — surface any insights inline then go straight to review
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
      return a; // user said "no" — treat as new account
    }));
    setShowClarifyModal(false);
    setClarifyData(null);
    setClarifyAnswers({});
    setShowImportModal(true);
  };

  // ── Asset account handlers ────────────────────────────────────────────────
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
    } catch (err) { console.error('Import save error:', err); }
    finally { setImportSaving(false); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Finance</div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Finance OS</h1>
          <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>Real accounts. Real numbers. No guessing.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
          <Button onClick={() => fileInputRef.current?.click()} loading={importLoading} variant="ghost" size="sm">
            {importLoading ? (importProgress ? `Reading ${importProgress.current}/${importProgress.total}...` : 'Reading...') : '↑ Import Files'}
          </Button>
          <Button onClick={openNew} variant="ghost" size="sm">+ Manual</Button>
        </div>
      </div>

      {/* Import error banner */}
      {importError && (
        <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'rgba(212,122,107,0.1)', border: '1px solid rgba(212,122,107,0.25)', borderRadius: '8px', fontSize: '13px', color: tokens.red, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {importError}
          <button onClick={() => setImportError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.red, fontSize: '16px', lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* ── Plaid: no accounts connected ── */}
      {plaidItems.length === 0 && (
        <div className="fade-up stagger-1" style={{ marginBottom: '16px' }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(91,143,212,0.08), rgba(91,143,212,0.03))', border: `1px dashed rgba(91,143,212,0.3)`, borderRadius: tokens.radiusLg, padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '4px' }}>Connect your bank accounts</div>
                <div style={{ fontSize: '12px', color: tokens.textMuted }}>See live balances and transactions — or use ↑ Import File to upload a statement manually.</div>
              </div>
              <Button loading={connecting} onClick={handleConnect}>Connect Bank</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Plaid: connected accounts ── */}
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
                      <div style={{ width: 34, height: 34, borderRadius: '8px', background: tokens.bgInput, border: `1px solid ${tokens.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🏦</div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>{item.institutionName}</div>
                        <div style={{ fontSize: '11px', color: tokens.green, marginTop: '1px' }}>● Connected</div>
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

      {/* ── Financial Health Dashboard ── */}
      {effectiveFlow && (
        <div className="fade-up stagger-2" style={{ marginBottom: '16px' }}>

          {/* Danger / warning alert */}
          {isDanger && (
            <div style={{ marginBottom: '10px', padding: '10px 14px', background: 'rgba(212,122,107,0.1)', border: '1px solid rgba(212,122,107,0.3)', borderRadius: '8px', fontSize: '13px', color: tokens.red, fontWeight: 600 }}>
              ⚠ Monthly spending exceeds income by ${Math.abs(surplus).toLocaleString()}. Address this before adding extra debt payments.
            </div>
          )}
          {isWarning && (
            <div style={{ marginBottom: '10px', padding: '10px 14px', background: 'rgba(200,169,110,0.1)', border: '1px solid rgba(200,169,110,0.3)', borderRadius: '8px', fontSize: '13px', color: tokens.amber, fontWeight: 600 }}>
              ⚠ Monthly surplus (${surplus.toLocaleString()}) is less than total minimums (${totalMinimums.toLocaleString()}). Review your budget.
            </div>
          )}

          {/* Cash flow row */}
          <Card style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <SectionLabel style={{ marginBottom: 0 }}>Monthly Cash Flow</SectionLabel>
              <span style={{ fontSize: '10px', color: tokens.textMuted }}>
                {effectiveFlow.source === 'plaid' ? 'Via Plaid · last 30 days' : `Via import · ${fmtImportDate(effectiveFlow.importedAt)}${effectiveFlow.importedFrom ? ' · ' + effectiveFlow.importedFrom : ''}`}
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
                      ? `Need $${goalPace.requiredPerMonth.toLocaleString()}/mo ✓`
                      : `Need $${goalPace.requiredPerMonth.toLocaleString()}/mo, have $${surplus.toLocaleString()}`}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Net Worth ── */}
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

      {/* ── Recent Transactions (Plaid only) ── */}
      {transactions.length > 0 && (
        <div className="fade-up stagger-3" style={{ marginBottom: '16px' }}>
          <Card>
            <SectionLabel>Recent Transactions</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {transactions.slice(0, showAllTx ? undefined : 12).map(tx => (
                <div key={tx.transaction_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${tokens.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: tokens.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.merchant_name || tx.name}</div>
                    <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '2px' }}>{formatTxDate(tx.date)} · {(tx.personal_finance_category?.primary || tx.category?.[0] || 'Uncategorized').replace(/_/g, ' ')}</div>
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

      {/* ── Debt Accounts ── */}
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

      <div className="fade-up stagger-5" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {debtAccounts.length === 0 ? (
          <EmptyState icon="◉" title="No debt accounts tracked" subtitle="Import a bank statement or add accounts manually to get started." action={
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button onClick={() => fileInputRef.current?.click()} variant="ghost">↑ Import File</Button>
              <Button onClick={openNew}>+ Add Manually</Button>
            </div>
          } />
        ) : (
          sorted.map((account, i) => {
            const tc  = typeColors[account.type] || typeColors.other;
            const pct = Math.max(0, Math.min(100, ((account.balance || 0) / highestBalance) * 100));
            return (
              <Card key={account.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {i === 0 && <span style={{ fontSize: '11px', color: tokens.accent, fontWeight: 700 }}>PRIORITY 1</span>}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: tokens.textPrimary }}>{account.name}</div>
                      <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>{account.interestRate || 0}% APR · Min ${(account.minimumPayment || 0).toLocaleString()}/mo</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.red }}>${(account.balance || 0).toLocaleString()}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: tc.bg, color: tc.text, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{account.type}</span>
                  </div>
                </div>
                <MomentumBar value={pct} color={tokens.red} height={4} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '10px' }}>
                  <Button onClick={() => openEdit(account)} variant="ghost" size="sm">Edit</Button>
                  <Button onClick={() => handleDelete(account.id)} variant="danger" size="sm">Remove</Button>
                </div>
                {account.notes && <div style={{ marginTop: '8px', fontSize: '12px', color: tokens.textMuted }}>{account.notes}</div>}
              </Card>
            );
          })
        )}
      </div>

      {/* ── Manual account modal ── */}
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
            <Button onClick={handleSave} loading={saving} disabled={!form.name.trim() || !form.balance}>{editing ? 'Save' : 'Add Account'}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Import Review Modal ── */}
      <Modal open={showImportModal} onClose={() => setShowImportModal(false)} title="Review Extracted Data">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Summary */}
          {importSummary && (
            <div style={{ padding: '10px 14px', background: tokens.accentDim, borderRadius: '8px', fontSize: '13px', color: tokens.textSecondary }}>
              ✦ {importSummary}
            </div>
          )}

          {/* Insights from clarify step (shown when questions were skipped) */}
          {(clarifyData?.insights || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {clarifyData.insights.map((insight, i) => (
                <div key={i} style={{ padding: '7px 12px', background: 'rgba(109,191,158,0.08)', border: '1px solid rgba(109,191,158,0.2)', borderRadius: '8px', fontSize: '12px', color: tokens.textSecondary }}>
                  💡 {insight}
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
                      {a.isDuplicate && <span style={{ fontSize: '10px', color: tokens.amber, background: 'rgba(200,169,110,0.12)', padding: '2px 7px', borderRadius: '4px', fontWeight: 700, flexShrink: 0 }}>exists · will update</span>}
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

      {/* ── Clarification Modal (pre-import: smart account matching) ── */}
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
                  💡 {insight}
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
              Continue to Review →
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Asset Account Modal ── */}
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

      {/* ── Asset Accounts Section ── */}
      <div className="fade-up stagger-6" style={{ marginTop: '32px', paddingTop: '24px', borderTop: `1px solid ${tokens.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div>
            <SectionLabel style={{ marginBottom: '2px' }}>Assets</SectionLabel>
            <p style={{ fontSize: '12px', color: tokens.textMuted, margin: 0 }}>Checking, savings, retirement, investments</p>
          </div>
          <Button onClick={openAssetNew} size="sm">+ Add Asset</Button>
        </div>

        {(assetAccounts || []).length === 0 ? (
          <EmptyState icon="◈" title="No asset accounts tracked" subtitle="Add checking, savings, retirement, and investment accounts for a complete net worth picture." action={
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

// ─── Weekly Review ─────────────────────────────────────────────────────────────
export function ReviewScreen() {
  const { user } = useAuth();
  const { tasks, projects } = useData();
  const [form,      setForm]      = useState({ wins: '', bottlenecks: '', energyScore: 65, executionScore: 70, notes: '' });
  const [aiText,    setAiText]    = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [saved,     setSaved]     = useState(false);
  const { getWeeklyReviewInsight } = require('../../lib/ai');
  const { saveWeeklyReview }       = require('../../lib/db');

  const weekKey = (() => {
    const d = new Date();
    const start = new Date(d.setDate(d.getDate() - d.getDay()));
    return start.toISOString().split('T')[0];
  })();

  const doneTasks   = tasks.filter(t => t.done);
  const stalledProj = projects.filter(p => p.status === 'stalled');

  const generateInsight = async () => {
    setAiLoading(true);
    const text = await getWeeklyReviewInsight({
      wins:           form.wins.split('\n').filter(Boolean),
      bottlenecks:    form.bottlenecks.split('\n').filter(Boolean),
      energyScore:    form.energyScore,
      executionScore: form.executionScore,
    });
    setAiText(text || 'A solid week of data collected. Reflect on what moved and what stalled.');
    setAiLoading(false);
  };

  const handleSave = async () => {
    await saveWeeklyReview(user.uid, weekKey, { ...form, aiInsight: aiText, weekKey });
    setSaved(true);
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="fade-up" style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Weekly Review Engine</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Weekly Review</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>
          Week of {new Date(weekKey).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} · {doneTasks.length} tasks completed
        </p>
      </div>

      {/* Auto data */}
      {(doneTasks.length > 0 || stalledProj.length > 0) && (
        <div className="fade-up stagger-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <Card>
            <SectionLabel>Completed Tasks</SectionLabel>
            {doneTasks.slice(0, 4).map(t => (
              <div key={t.id} style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '5px', display: 'flex', gap: '6px' }}>
                <span style={{ color: tokens.green }}>✓</span> {t.title}
              </div>
            ))}
            {doneTasks.length > 4 && <div style={{ fontSize: '11px', color: tokens.textMuted }}>+{doneTasks.length - 4} more</div>}
          </Card>
          <Card>
            <SectionLabel>Stalled Projects</SectionLabel>
            {stalledProj.length === 0 ? <div style={{ fontSize: '12px', color: tokens.green }}>✓ Nothing stalled</div> : stalledProj.map(p => (
              <div key={p.id} style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '5px', display: 'flex', gap: '6px' }}>
                <span style={{ color: tokens.red }}>⚑</span> {p.title}
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Scores */}
      <div className="fade-up stagger-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Energy Score', field: 'energyScore', color: tokens.green },
          { label: 'Execution Score', field: 'executionScore', color: tokens.blue },
        ].map(item => (
          <Card key={item.field}>
            <SectionLabel>{item.label}</SectionLabel>
            <div style={{ fontFamily: fonts.display, fontSize: '40px', fontWeight: 700, color: item.color, lineHeight: 1, marginBottom: '12px' }}>
              {form[item.field]}
            </div>
            <input type="range" min={0} max={100} value={form[item.field]} onChange={e => setForm(f => ({ ...f, [item.field]: Number(e.target.value) }))} style={{ width: '100%', accentColor: item.color }} />
          </Card>
        ))}
      </div>

      {/* Inputs */}
      <div className="fade-up stagger-3" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
        <Input label="Key Wins This Week (one per line)" value={form.wins} onChange={v => setForm(f => ({ ...f, wins: v }))} placeholder="Sent Meridian proposal&#10;Ran 4x this week&#10;Closed new client" multiline rows={4} />
        <Input label="Bottlenecks & Stalls (one per line)" value={form.bottlenecks} onChange={v => setForm(f => ({ ...f, bottlenecks: v }))} placeholder="Kitchen contractor still unresolved&#10;Content doc keeps getting deprioritized" multiline rows={3} />
        <Input label="Personal Notes / Reflections" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Anything else worth capturing from this week..." multiline rows={3} />
      </div>

      {/* AI Insight */}
      {aiText ? (
        <div className="fade-up" style={{ marginBottom: '16px' }}>
          <AICard text={aiText} loading={aiLoading} onRefresh={generateInsight} label="EXECUTIVE SUMMARY" />
        </div>
      ) : (
        <div className="fade-up" style={{ marginBottom: '16px' }}>
          <button
            onClick={generateInsight}
            disabled={aiLoading}
            style={{
              width: '100%', padding: '16px',
              background: 'transparent',
              border: `1px dashed rgba(200,169,110,0.3)`,
              borderRadius: '12px', cursor: 'pointer',
              color: tokens.accent, fontSize: '14px', fontWeight: 600,
              transition: 'all 0.15s',
              fontFamily: fonts.body,
            }}
            onMouseEnter={e => e.target.style.background = tokens.accentDim}
            onMouseLeave={e => e.target.style.background = 'transparent'}
          >
            {aiLoading ? 'Generating...' : '✦ Generate AI Executive Summary'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <Button onClick={handleSave} disabled={saved}>
          {saved ? '✓ Review Saved' : 'Save Review'}
        </Button>
      </div>
    </div>
  );
}

// ─── Decisions ─────────────────────────────────────────────────────────────────
export function DecisionsScreen() {
  const { user } = useAuth();
  const { decisions } = useData();
  const [selected,  setSelected]  = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const { addDecision } = require('../../lib/db');
  const emptyD = { title: '', options: '', decision: '', reasoning: '', emotionalState: 'neutral', confidence: 65, revisitDate: '', outcome: '' };
  const [form, setForm] = useState(emptyD);

  const confidenceColor = (c) => c >= 75 ? tokens.green : c >= 50 ? tokens.accent : tokens.red;

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    await addDecision(user.uid, form);
    setSaving(false);
    setShowModal(false);
    setForm(emptyD);
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Decision Journal</div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Decision Log</h1>
          <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>Track decisions. Revisit. Improve your pattern over time.</p>
        </div>
        <Button onClick={() => setShowModal(true)}>+ Log Decision</Button>
      </div>

      <div className="fade-up stagger-1" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {decisions.length === 0 ? (
          <EmptyState icon="⊡" title="No decisions logged" subtitle="Start logging major decisions to spot patterns over time." action={<Button onClick={() => setShowModal(true)}>+ Log First Decision</Button>} />
        ) : (
          decisions.map(d => (
            <div key={d.id} onClick={() => setSelected(selected?.id === d.id ? null : d)}
              style={{ background: selected?.id === d.id ? 'rgba(200,169,110,0.05)' : tokens.bgCard, border: `1px solid ${selected?.id === d.id ? 'rgba(200,169,110,0.2)' : tokens.border}`, borderRadius: '12px', padding: '16px 18px', cursor: 'pointer', transition: 'all 0.18s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: tokens.textPrimary, marginBottom: '3px' }}>{d.title}</div>
                  <div style={{ fontSize: '11px', color: tokens.textMuted }}>
                    {d.createdAt?.toDate?.().toLocaleDateString() || 'Recent'} · Revisit: {d.revisitDate || 'not set'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color: confidenceColor(d.confidence || 65) }}>{d.confidence || 65}%</div>
                  <div style={{ fontSize: '10px', color: tokens.textMuted }}>confidence</div>
                </div>
              </div>
              {selected?.id === d.id && (
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${tokens.border}`, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {d.options && <div style={{ fontSize: '12px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted, fontWeight: 600 }}>Options: </span>{d.options}</div>}
                  {d.decision && <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 600 }}>Decision: {d.decision}</div>}
                  {d.reasoning && <div style={{ fontSize: '12px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted }}>Reasoning: </span>{d.reasoning}</div>}
                  {d.emotionalState && <div style={{ fontSize: '12px', color: tokens.textMuted }}>Emotional state: {d.emotionalState}</div>}
                  {d.outcome && <div style={{ padding: '8px 12px', background: tokens.greenDim, borderRadius: '6px', fontSize: '12px', color: tokens.green }}>Outcome: {d.outcome}</div>}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Log a Decision">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Decision" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="Hire FT marketing lead vs agency" />
          <Input label="Options Considered" value={form.options} onChange={v => setForm(f => ({ ...f, options: v }))} placeholder="Option A, Option B..." multiline rows={2} />
          <Input label="Your Decision" value={form.decision} onChange={v => setForm(f => ({ ...f, decision: v }))} placeholder="What you chose" />
          <Input label="Reasoning" value={form.reasoning} onChange={v => setForm(f => ({ ...f, reasoning: v }))} placeholder="Why you chose it..." multiline rows={2} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Input label="Emotional State" value={form.emotionalState} onChange={v => setForm(f => ({ ...f, emotionalState: v }))} placeholder="cautious, confident, uncertain..." />
            <Input label="Revisit Date" value={form.revisitDate} onChange={v => setForm(f => ({ ...f, revisitDate: v }))} placeholder="Aug 1, 2025" />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, marginBottom: '8px' }}>Confidence: {form.confidence}%</div>
            <input type="range" min={0} max={100} value={form.confidence} onChange={e => setForm(f => ({ ...f, confidence: Number(e.target.value) }))} style={{ width: '100%', accentColor: tokens.accent }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button onClick={() => setShowModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>Save Decision</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Ideas ─────────────────────────────────────────────────────────────────────
export function IdeasScreen() {
  const { user } = useAuth();
  const { ideas } = useData();
  const [selected,  setSelected]  = useState(null);
  const [aiScores,  setAiScores]  = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const { evaluateIdea } = require('../../lib/ai');
  const { addIdea } = require('../../lib/db');
  const emptyI = { title: '', notes: '', tags: '', status: 'explore' };
  const [form, setForm] = useState(emptyI);

  const IDEA_STATUSES = [
    { value: 'explore', label: 'Explore' },
    { value: 'test',    label: 'Test'    },
    { value: 'active',  label: 'Active'  },
    { value: 'later',   label: 'Later'   },
    { value: 'no',      label: 'No'      },
  ];

  const handleEvaluate = async (idea) => {
    setLoadingId(idea.id);
    const result = await evaluateIdea({ ...idea, tags: idea.tags || [] });
    if (result) setAiScores(prev => ({ ...prev, [idea.id]: result }));
    setLoadingId(null);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    await addIdea(user.uid, { ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) });
    setSaving(false);
    setShowModal(false);
    setForm(emptyI);
  };

  const statusColor = (s) => ({ active: tokens.green, test: tokens.blue, explore: tokens.accent, later: tokens.textMuted, no: tokens.red })[s] || tokens.textMuted;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Idea Vault</div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Idea Vault</h1>
          <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>Capture, evaluate, and surface the right ideas at the right time.</p>
        </div>
        <Button onClick={() => setShowModal(true)}>+ New Idea</Button>
      </div>

      <div className="fade-up stagger-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
        {ideas.length === 0 ? (
          <EmptyState icon="◇" title="No ideas captured yet" subtitle="Add ideas to evaluate their fit, effort, and timing." action={<Button onClick={() => setShowModal(true)}>+ First Idea</Button>} />
        ) : (
          ideas.map(idea => {
            const isSelected = selected?.id === idea.id;
            const score      = aiScores[idea.id];
            return (
              <div key={idea.id} onClick={() => setSelected(isSelected ? null : idea)}
                style={{ background: isSelected ? 'rgba(200,169,110,0.05)' : tokens.bgCard, border: `1px solid ${isSelected ? 'rgba(200,169,110,0.2)' : tokens.border}`, borderRadius: '12px', padding: '16px 18px', cursor: 'pointer', transition: 'all 0.18s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: tokens.textPrimary, flex: 1, paddingRight: '8px' }}>{idea.title}</div>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: statusColor(idea.status), textTransform: 'uppercase', letterSpacing: '0.06em' }}>{idea.status}</span>
                </div>
                {idea.tags?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                    {idea.tags.map(t => <span key={t} style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, padding: '1px 7px', borderRadius: '4px', fontWeight: 600 }}>{t}</span>)}
                  </div>
                )}
                {idea.notes && <div style={{ fontSize: '12px', color: tokens.textMuted, lineHeight: 1.6, marginBottom: '10px' }}>{idea.notes}</div>}

                {isSelected && (
                  <div style={{ paddingTop: '12px', borderTop: `1px solid ${tokens.border}` }}>
                    {score ? (
                      <div style={{ background: tokens.accentDim, borderRadius: '8px', padding: '12px' }}>
                        <div style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, marginBottom: '8px' }}>✦ AI EVALUATION</div>
                        <div style={{ fontSize: '13px', color: tokens.textPrimary, marginBottom: '6px' }}>{score.verdict}</div>
                        <div style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '8px' }}>Test: {score.tinyTest}</div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <span style={{ fontSize: '10px', color: tokens.blue, background: tokens.blueDim, padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>Fit: {score.fitScore}%</span>
                          <span style={{ fontSize: '10px', color: statusColor(score.timing), background: tokens.accentDim, padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>{score.timing}</span>
                        </div>
                        {score.timingReason && <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '6px' }}>{score.timingReason}</div>}
                      </div>
                    ) : (
                      <Button onClick={(e) => { e.stopPropagation(); handleEvaluate(idea); }} loading={loadingId === idea.id} variant="accent" size="sm" style={{ width: '100%', justifyContent: 'center' }}>
                        ✦ AI Evaluate
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Capture an Idea">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Idea Title" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="AI-powered onboarding SaaS" />
          <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Context, market observation, rough economics..." multiline rows={3} />
          <Input label="Tags (comma separated)" value={form.tags} onChange={v => setForm(f => ({ ...f, tags: v }))} placeholder="SaaS, AI, passive income" />
          <Select label="Status" value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))} options={IDEA_STATUSES} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button onClick={() => setShowModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>Save Idea</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Life OS ──────────────────────────────────────────────────────────────────

function getCompletedDate(task) {
  if (!task.completedAt) return null;
  if (typeof task.completedAt === 'string') return task.completedAt.split('T')[0];
  if (task.completedAt?.toDate) return task.completedAt.toDate().toISOString().split('T')[0];
  return null;
}

export function LifeScreen() {
  const { projects, tasks, totalDebt, goals } = useData();
  const today = new Date().toISOString().split('T')[0];

  // Last 14 days array (YYYY-MM-DD)
  const last14Days = useMemo(() => {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    return days;
  }, []);

  // Tasks completed per day for last 14 days
  const completionsByDay = useMemo(() =>
    last14Days.map(day => tasks.filter(t => t.done && getCompletedDate(t) === day).length),
    [tasks, last14Days]
  );

  const maxDay = Math.max(...completionsByDay, 1);
  const totalCompletedLast14 = completionsByDay.reduce((a, b) => a + b, 0);

  // Completion streak (consecutive days going back from today)
  const streak = useMemo(() => {
    let count = 0;
    for (let i = 0; i <= 60; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = d.toISOString().split('T')[0];
      const hasDone = tasks.some(t => t.done && getCompletedDate(t) === day);
      if (!hasDone) {
        if (i === 0) continue; // today might not have completions yet
        break;
      }
      count++;
    }
    return count;
  }, [tasks]);

  const activeGoals    = (goals || []).filter(g => g.status === 'active').slice(0, 4);
  const activeCount    = projects.filter(p => p.status === 'active').length;
  const pendingCount   = tasks.filter(t => !t.done).length;
  const stalledProjs = projects.filter(p => p.status === 'stalled');
  const overdueTasks   = tasks.filter(t => !t.done && t.scheduledDate && t.scheduledDate < today);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="fade-up" style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Life Dashboard</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Life OS Overview</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>Real data. No fake scores.</p>
      </div>

      {/* Key metrics */}
      <div className="fade-up stagger-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Done (14d)', val: totalCompletedLast14, color: tokens.green },
          { label: 'Streak (days)', val: streak, color: tokens.accent },
          { label: 'Pending', val: pendingCount, color: tokens.amber },
          { label: 'Overdue', val: overdueTasks.length, color: overdueTasks.length > 0 ? tokens.red : tokens.textMuted },
        ].map(item => (
          <Card key={item.label} style={{ textAlign: 'center', padding: '14px' }}>
            <div style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: item.color }}>{item.val}</div>
            <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '4px', letterSpacing: '0.04em' }}>{item.label}</div>
          </Card>
        ))}
      </div>

      {/* Real execution chart */}
      <div className="fade-up stagger-2" style={{ marginBottom: '16px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>Tasks Completed — Last 14 Days</SectionLabel>
            <span style={{ fontSize: '11px', color: tokens.textMuted }}>{totalCompletedLast14} total</span>
          </div>
          <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '64px' }}>
            {completionsByDay.map((count, i) => (
              <div
                key={i}
                title={`${last14Days[i]}: ${count} completed`}
                style={{
                  flex: 1,
                  height: count > 0 ? `${Math.max(Math.round((count / maxDay) * 100), 10)}%` : '4px',
                  borderRadius: '3px 3px 0 0',
                  background: count >= 4 ? tokens.green : count >= 2 ? tokens.accent : count === 1 ? 'rgba(200,169,110,0.45)' : tokens.border,
                  transition: 'height 0.5s ease',
                  alignSelf: 'flex-end',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '10px', color: tokens.textMuted }}>
            <span>14 days ago</span><span>Today</span>
          </div>
        </Card>
      </div>

      {/* Active goal momentum */}
      {activeGoals.length > 0 && (
        <div className="fade-up stagger-3" style={{ marginBottom: '16px' }}>
          <Card>
            <SectionLabel>Goal Momentum</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {activeGoals.map(g => {
                const score = g.likelihoodScore ?? 50;
                const color = score >= 70 ? tokens.green : score >= 40 ? tokens.accent : tokens.red;
                return (
                  <div key={g.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500 }}>{g.title}</span>
                      <span style={{ fontFamily: fonts.display, fontSize: '14px', fontWeight: 700, color }}>{score}%</span>
                    </div>
                    <MomentumBar value={score} color={color} height={6} />
                    {g.targetDate && (
                      <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '4px' }}>Target: {g.targetDate}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Projects & Debt */}
      <div className="fade-up stagger-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        <Card>
          <SectionLabel>Projects</SectionLabel>
          <div style={{ fontFamily: fonts.display, fontSize: '36px', fontWeight: 700, color: tokens.blue, lineHeight: 1 }}>{activeCount}</div>
          <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '4px' }}>active</div>
          {stalledProjs.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: tokens.red, fontWeight: 600 }}>
              {stalledProjs.length} stalled
            </div>
          )}
        </Card>
        <Card>
          <SectionLabel>Debt Load</SectionLabel>
          <div style={{ fontFamily: fonts.display, fontSize: '36px', fontWeight: 700, color: totalDebt > 0 ? tokens.red : tokens.green, lineHeight: 1 }}>
            {totalDebt > 0 ? `$${(totalDebt / 1000).toFixed(0)}k` : '$0'}
          </div>
          <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '4px' }}>
            {totalDebt > 0 ? 'outstanding' : 'debt free'}
          </div>
        </Card>
      </div>

      {/* Needs attention */}
      {(stalledProjs.length > 0 || overdueTasks.length > 0) && (
        <div className="fade-up stagger-5">
          <Card style={{ borderColor: 'rgba(212,122,107,0.2)', background: 'rgba(212,122,107,0.02)' }}>
            <SectionLabel>⚑ Needs Attention</SectionLabel>
            {stalledProjs.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${tokens.border}` }}>
                <div>
                  <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500 }}>{p.title}</div>
                  <div style={{ fontSize: '11px', color: tokens.textMuted }}>project · stalled</div>
                </div>
                <span style={{ fontSize: '12px', color: tokens.red, fontWeight: 600 }}>stalled</span>
              </div>
            ))}
            {overdueTasks.slice(0, 5).map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${tokens.border}` }}>
                <div>
                  <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500 }}>{t.title}</div>
                  <div style={{ fontSize: '11px', color: tokens.textMuted }}>task · was due {t.scheduledDate}</div>
                </div>
                <span style={{ fontSize: '12px', color: tokens.amber, fontWeight: 600 }}>overdue</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 && projects.length === 0 && (
        <div className="fade-up stagger-3">
          <EmptyState icon="▦" title="No data yet" subtitle="Complete tasks, set goals, and add projects — your life OS will populate with real data." />
        </div>
      )}
    </div>
  );
}
