// src/components/screens/DebtScreen.js
import React, { useState } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getDebtAdvice } from '../../lib/ai';
import { addDebtAccount, updateDebtAccount, deleteDebtAccount } from '../../lib/db';
import { Card, Button, Input, Select, SectionLabel, MomentumBar, Modal, AICard, EmptyState } from '../ui';

const DEBT_TYPES = [
  { value: 'tax',      label: 'Tax Debt'      },
  { value: 'business', label: 'Business Debt' },
  { value: 'personal', label: 'Personal Debt' },
  { value: 'credit',   label: 'Credit Card'   },
  { value: 'auto',     label: 'Auto Loan'     },
  { value: 'student',  label: 'Student Loan'  },
  { value: 'other',    label: 'Other'         },
];

const emptyForm = { name: '', balance: '', interestRate: '', type: 'personal', minimumPayment: '', notes: '' };

const typeColors = {
  tax:      { bg: 'rgba(212,122,107,0.12)', text: '#D47A6B' },
  business: { bg: 'rgba(155,133,201,0.12)', text: '#9B85C9' },
  personal: { bg: 'rgba(91,143,212,0.12)',  text: '#5B8FD4' },
  credit:   { bg: 'rgba(200,169,110,0.12)', text: '#C8A96E' },
  auto:     { bg: 'rgba(109,191,158,0.12)', text: '#6DBF9E' },
  student:  { bg: 'rgba(200,169,110,0.12)', text: '#C8A96E' },
  other:    { bg: 'rgba(255,255,255,0.06)', text: 'rgba(237,232,224,0.4)' },
};

export function DebtScreen() {
  const { user } = useAuth();
  const { debtAccounts, totalDebt } = useData();
  const [showModal,  setShowModal]  = useState(false);
  const [form,       setForm]       = useState(emptyForm);
  const [editing,    setEditing]    = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [aiText,     setAiText]     = useState('');
  const [aiLoading,  setAiLoading]  = useState(false);

  const sorted = [...debtAccounts].sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0));
  const highestBalance = Math.max(...debtAccounts.map(a => a.balance || 0), 1);

  const fetchAI = async () => {
    if (debtAccounts.length === 0) return;
    setAiLoading(true);
    const text = await getDebtAdvice(debtAccounts);
    setAiText(text || 'Focus on the highest-interest debt first. Every extra dollar there saves the most.');
    setAiLoading(false);
  };

  const openNew = () => { setForm(emptyForm); setEditing(null); setShowModal(true); };
  const openEdit = (a) => {
    setForm({ name: a.name || '', balance: String(a.balance || ''), interestRate: String(a.interestRate || ''), type: a.type || 'personal', minimumPayment: String(a.minimumPayment || ''), notes: a.notes || '' });
    setEditing(a.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.balance) return;
    setSaving(true);
    const data = {
      name: form.name.trim(),
      balance: parseFloat(form.balance) || 0,
      interestRate: parseFloat(form.interestRate) || 0,
      type: form.type,
      minimumPayment: parseFloat(form.minimumPayment) || 0,
      notes: form.notes,
    };
    if (editing) {
      await updateDebtAccount(user.uid, editing, data);
    } else {
      await addDebtAccount(user.uid, data);
    }
    setSaving(false);
    setShowModal(false);
    setAiText('');
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this account?')) return;
    await deleteDebtAccount(user.uid, id);
    setAiText('');
  };

  React.useEffect(() => {
    if (debtAccounts.length > 0 && !aiText) fetchAI();
  }, [debtAccounts.length]);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Finance Tracker</div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Debt Payoff OS</h1>
          <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>
            Track, prioritize, and eliminate systematically.
          </p>
        </div>
        <Button onClick={openNew}>+ Add Account</Button>
      </div>

      {/* Total */}
      {debtAccounts.length > 0 && (
        <div className="fade-up stagger-1" style={{ marginBottom: '16px' }}>
          <Card accent>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <SectionLabel>Total Debt Load</SectionLabel>
                <div style={{ fontFamily: fonts.display, fontSize: '38px', fontWeight: 700, color: tokens.red, lineHeight: 1 }}>
                  ${totalDebt.toLocaleString()}
                </div>
                <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '4px' }}>
                  {debtAccounts.length} account{debtAccounts.length > 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '12px', color: tokens.textMuted, marginBottom: '4px' }}>Monthly Minimums</div>
                <div style={{ fontFamily: fonts.display, fontSize: '22px', color: tokens.amber }}>
                  ${debtAccounts.reduce((s, a) => s + (a.minimumPayment || 0), 0).toLocaleString()}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* AI Advice */}
      {debtAccounts.length > 0 && (
        <div className="fade-up stagger-2" style={{ marginBottom: '16px' }}>
          <AICard text={aiText} loading={aiLoading} onRefresh={fetchAI} label="PAYOFF STRATEGY" />
        </div>
      )}

      {/* Accounts */}
      <div className="fade-up stagger-3" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {debtAccounts.length === 0 ? (
          <EmptyState
            icon="◉"
            title="No debt accounts tracked"
            subtitle="Add your accounts to get an AI-optimized payoff strategy."
            action={<Button onClick={openNew}>+ Add First Account</Button>}
          />
        ) : (
          sorted.map((account, i) => {
            const tc = typeColors[account.type] || typeColors.other;
            const pct = Math.max(0, Math.min(100, ((account.balance || 0) / highestBalance) * 100));
            return (
              <Card key={account.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {i === 0 && <span style={{ fontSize: '11px', color: tokens.accent, fontWeight: 700 }}>PRIORITY 1</span>}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: tokens.textPrimary }}>{account.name}</div>
                      <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                        {account.interestRate || 0}% APR · Min ${(account.minimumPayment || 0).toLocaleString()}/mo
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.red }}>
                      ${(account.balance || 0).toLocaleString()}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: tc.bg, color: tc.text, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {account.type}
                    </span>
                  </div>
                </div>
                <MomentumBar value={pct} color={tokens.red} height={4} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '10px' }}>
                  <Button onClick={() => openEdit(account)} variant="ghost" size="sm">Edit</Button>
                  <Button onClick={() => handleDelete(account.id)} variant="danger" size="sm">Remove</Button>
                </div>
                {account.notes && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: tokens.textMuted }}>{account.notes}</div>
                )}
              </Card>
            );
          })
        )}
      </div>

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
            <Button onClick={handleSave} loading={saving} disabled={!form.name.trim() || !form.balance}>
              {editing ? 'Save' : 'Add Account'}
            </Button>
          </div>
        </div>
      </Modal>
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
  const { addDecision, updateDecision } = require('../../lib/db');
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
export function LifeScreen() {
  const { projects, tasks, totalDebt } = useData();

  const activeCount   = projects.filter(p => p.status === 'active').length;
  const doneCount     = tasks.filter(t => t.done).length;
  const pendingCount  = tasks.filter(t => !t.done).length;
  const stalledProjs  = projects.filter(p => p.status === 'stalled');

  const lifeAreas = [
    { area: 'Work',     score: Math.min(100, activeCount * 20 + 40), color: tokens.blue,   icon: '◈' },
    { area: 'Finance',  score: totalDebt > 0 ? 35 : 70,              color: tokens.amber,  icon: '◉' },
    { area: 'Health',   score: 65,                                    color: tokens.green,  icon: '◎' },
    { area: 'Home',     score: stalledProjs.some(p => p.category === 'home') ? 30 : 60, color: tokens.accent, icon: '⌂' },
    { area: 'Family',   score: 70,                                    color: tokens.purple, icon: '♡' },
    { area: 'Creative', score: 50,                                    color: tokens.blue,   icon: '✦' },
  ];

  const executionData = Array.from({ length: 14 }, (_, i) => Math.floor(40 + Math.random() * 50));

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="fade-up" style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Life Dashboard</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Life OS Overview</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>High-level view. Where is your energy and execution going?</p>
      </div>

      {/* Life area scores */}
      <div className="fade-up stagger-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
        {lifeAreas.map(item => (
          <Card key={item.area} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '6px', color: item.color }}>{item.icon}</div>
            <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '6px' }}>{item.area}</div>
            <div style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: item.color, marginBottom: '10px' }}>{item.score}</div>
            <MomentumBar value={item.score} color={item.color} />
          </Card>
        ))}
      </div>

      {/* Stats row */}
      <div className="fade-up stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Projects Active', val: activeCount, color: tokens.blue },
          { label: 'Tasks Done',      val: doneCount,   color: tokens.green },
          { label: 'Tasks Pending',   val: pendingCount, color: tokens.amber },
          { label: 'Debt Load',       val: `$${(totalDebt/1000).toFixed(0)}k`, color: tokens.red },
        ].map(item => (
          <Card key={item.label} style={{ textAlign: 'center', padding: '14px' }}>
            <div style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: item.color }}>{item.val}</div>
            <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '4px', letterSpacing: '0.04em' }}>{item.label}</div>
          </Card>
        ))}
      </div>

      {/* Execution chart */}
      <div className="fade-up stagger-3" style={{ marginBottom: '14px' }}>
        <Card>
          <SectionLabel>Execution Consistency — Last 14 Days</SectionLabel>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '64px' }}>
            {executionData.map((v, i) => (
              <div key={i} style={{ flex: 1, height: `${v}%`, borderRadius: '3px 3px 0 0', background: v > 70 ? tokens.green : v > 50 ? tokens.accent : tokens.red, opacity: 0.75, transition: 'height 0.5s ease' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '10px', color: tokens.textMuted }}>
            <span>14 days ago</span><span>Today</span>
          </div>
        </Card>
      </div>

      {/* Neglected */}
      {stalledProjs.length > 0 && (
        <div className="fade-up stagger-4">
          <Card style={{ borderColor: 'rgba(212,122,107,0.2)', background: 'rgba(212,122,107,0.02)' }}>
            <SectionLabel>⚑ Needs Attention</SectionLabel>
            {stalledProjs.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${tokens.border}` }}>
                <div>
                  <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500 }}>{p.title}</div>
                  <div style={{ fontSize: '11px', color: tokens.textMuted }}>{p.category} · stalled</div>
                </div>
                <div style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: tokens.red }}>{p.momentum || 0}%</div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
