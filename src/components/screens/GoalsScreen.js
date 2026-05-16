// src/components/screens/GoalsScreen.js
import React, { useState, useEffect, useRef } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addGoal, updateGoal, deleteGoal, getAICache, saveAICache } from '../../lib/db';
import { scoreGoals } from '../../lib/ai';
import { Button, Input, Select, Modal, EmptyState, MomentumBar, Tag } from '../ui';

const STATUS_OPTIONS = [
  { value: 'active',   label: 'Active'   },
  { value: 'achieved', label: 'Achieved' },
  { value: 'paused',   label: 'Paused'   },
];

const statusConfig = {
  active:   { label: 'Active',   bg: 'rgba(109,191,158,0.12)', text: '#6DBF9E'                   },
  achieved: { label: 'Achieved', bg: 'rgba(200,169,110,0.12)', text: '#C8A96E'                   },
  paused:   { label: 'Paused',   bg: 'rgba(255,255,255,0.06)', text: 'rgba(237,232,224,0.28)'    },
};

const emptyForm = {
  title: '', description: '', why: '',
  targetDate: '', targetAmount: '', currentAmount: '',
  status: 'active', dependencies: [],
};

function formatTargetDate(yyyyMM) {
  if (!yyyyMM) return null;
  const [y, m] = yyyyMM.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function monthsFrom(yyyyMM) {
  if (!yyyyMM) return null;
  const [y, m] = yyyyMM.split('-').map(Number);
  const now = new Date();
  return (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1));
}

function formatDollars(n) {
  if (n == null) return '';
  return '$' + Number(n).toLocaleString();
}

export default function GoalsScreen() {
  const { user }                          = useAuth();
  const { goals, tasks, brainDumps }      = useData();
  const [showModal, setShowModal]         = useState(false);
  const [form,      setForm]              = useState(emptyForm);
  const [editing,   setEditing]           = useState(null);
  const [saving,    setSaving]            = useState(false);
  const [scoring,   setScoring]           = useState(false);
  const hasScoredRef                      = useRef(false);

  const runScoring = async (force = false) => {
    if (scoring) return;
    const activeGoals = goals.filter(g => g.status === 'active');
    if (!activeGoals.length) return;

    if (!force) {
      const hasUnscored = activeGoals.some(g => g.likelihoodScore == null);
      if (!hasUnscored) {
        const cached = await getAICache(user.uid, 'goals-likelihood', 24);
        if (cached) return;
      }
    }

    setScoring(true);
    try {
      const scores = await scoreGoals({ goals: activeGoals, tasks, brainDumps });
      await Promise.all(
        scores.map(s => updateGoal(user.uid, s.goalId, {
          likelihoodScore: s.score,
          likelihoodTrend: s.trend,
        }))
      );
      await saveAICache(user.uid, 'goals-likelihood', 'scored');
    } catch (err) {
      console.error('Scoring error:', err);
    } finally {
      setScoring(false);
    }
  };

  // Auto-score once when goals first load
  useEffect(() => {
    if (!user || !goals.length || hasScoredRef.current) return;
    hasScoredRef.current = true;
    runScoring();
  }, [user, goals.length]); // eslint-disable-line

  const activeCount   = goals.filter(g => g.status === 'active').length;
  const achievedCount = goals.filter(g => g.status === 'achieved').length;
  const pausedCount   = goals.filter(g => g.status === 'paused').length;

  const openNew = () => { setForm(emptyForm); setEditing(null); setShowModal(true); };

  const openEdit = (goal) => {
    setForm({
      title:         goal.title         || '',
      description:   goal.description   || '',
      why:           goal.why           || '',
      targetDate:    goal.targetDate    || '',
      targetAmount:  goal.targetAmount  != null ? String(goal.targetAmount)  : '',
      currentAmount: goal.currentAmount != null ? String(goal.currentAmount) : '',
      status:        goal.status        || 'active',
      dependencies:  goal.dependencies  || [],
    });
    setEditing(goal.id);
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditing(null); };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const data = {
      title:         form.title.trim(),
      description:   form.description.trim(),
      why:           form.why.trim(),
      targetDate:    form.targetDate    || null,
      targetAmount:  form.targetAmount  !== '' ? parseFloat(form.targetAmount)  : null,
      currentAmount: form.currentAmount !== '' ? parseFloat(form.currentAmount) : null,
      status:        form.status,
      dependencies:  form.dependencies,
    };
    if (editing) {
      await updateGoal(user.uid, editing, data);
    } else {
      await addGoal(user.uid, data);
    }
    setSaving(false);
    closeModal();
  };

  const handleDelete = async (id) => { await deleteGoal(user.uid, id); };

  const toggleDep = (id) => {
    setForm(f => ({
      ...f,
      dependencies: f.dependencies.includes(id)
        ? f.dependencies.filter(d => d !== id)
        : [...f.dependencies, id],
    }));
  };

  const monthInputStyle = {
    background: tokens.bgInput,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    padding: '10px 14px',
    color: tokens.textPrimary,
    fontSize: '13px',
    outline: 'none',
    fontFamily: fonts.body,
    colorScheme: 'dark',
    width: '100%',
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* Header */}
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Life Trajectory</div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Goals</h1>
          <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>
            {activeCount} active · {achievedCount} achieved · {pausedCount} paused
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button onClick={() => runScoring(true)} variant="ghost" loading={scoring} disabled={scoring}>
            {scoring ? 'Scoring…' : '↻ Scores'}
          </Button>
          <Button onClick={openNew}>+ New Goal</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="fade-up stagger-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '20px' }}>
        {[
          { label: 'Active',   val: activeCount,   color: tokens.green      },
          { label: 'Achieved', val: achievedCount, color: tokens.accent     },
          { label: 'Paused',   val: pausedCount,   color: tokens.textMuted  },
        ].map(item => (
          <div key={item.label} style={{ padding: '12px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ fontFamily: fonts.display, fontSize: '24px', fontWeight: 700, color: item.color }}>{item.val}</div>
            <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '2px' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Goal list */}
      <div className="fade-up stagger-2" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {goals.length === 0 ? (
          <EmptyState
            icon="◆"
            title="No goals yet"
            subtitle="Add your first long-term goal. This is the foundation everything else builds on."
            action={<Button onClick={openNew} size="sm">+ Add Goal</Button>}
          />
        ) : (
          goals.map(goal => {
            const sc       = statusConfig[goal.status] || statusConfig.active;
            const months   = monthsFrom(goal.targetDate);
            const hasMoney = goal.targetAmount != null;
            const progress = hasMoney && goal.currentAmount != null
              ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100))
              : 0;
            const depNames = (goal.dependencies || [])
              .map(id => goals.find(g => g.id === id)?.title)
              .filter(Boolean);

            return (
              <div key={goal.id}
                style={{ display: 'flex', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg, overflow: 'hidden', transition: 'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = tokens.borderHover}
                onMouseLeave={e => e.currentTarget.style.borderColor = tokens.border}
              >
                {/* Left status stripe */}
                <div style={{ width: 3, background: sc.text, flexShrink: 0 }} />

                <div style={{ flex: 1, padding: '18px 20px' }}>
                  {/* Title + status */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '6px' }}>
                    <div style={{ fontFamily: fonts.display, fontSize: '17px', fontWeight: 700, color: tokens.textPrimary, lineHeight: 1.3 }}>{goal.title}</div>
                    <Tag label={sc.label} color={sc.bg} textColor={sc.text} />
                  </div>

                  {/* Why */}
                  {goal.why && (
                    <div style={{ fontSize: '13px', color: tokens.textSecondary, fontStyle: 'italic', marginBottom: '10px', lineHeight: 1.55 }}>"{goal.why}"</div>
                  )}

                  {/* Description */}
                  {goal.description && (
                    <div style={{ fontSize: '12px', color: tokens.textMuted, marginBottom: '10px', lineHeight: 1.5 }}>{goal.description}</div>
                  )}

                  {/* Target date row */}
                  {goal.targetDate && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: tokens.textMuted, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Target</span>
                      <span style={{ fontSize: '13px', color: tokens.textPrimary }}>{formatTargetDate(goal.targetDate)}</span>
                      {months != null && (
                        <span style={{ fontSize: '11px', color: months <= 0 ? tokens.red : months <= 6 ? tokens.amber : tokens.textMuted }}>
                          {months <= 0 ? 'Past due' : `in ${months} month${months === 1 ? '' : 's'}`}
                        </span>
                      )}
                      {hasMoney && (
                        <span style={{ fontSize: '12px', color: tokens.accent, marginLeft: 'auto', fontWeight: 600 }}>
                          {formatDollars(goal.currentAmount ?? 0)} / {formatDollars(goal.targetAmount)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Dollar progress bar */}
                  {hasMoney && (
                    <div style={{ marginBottom: '10px' }}>
                      <MomentumBar value={progress} color={sc.text} height={4} />
                      <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '4px' }}>{progress}% of target</div>
                    </div>
                  )}

                  {/* Likelihood row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '10px', borderTop: `1px solid ${tokens.border}` }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0 }}>Likelihood</span>
                    {goal.likelihoodScore != null ? (
                      <>
                        <div style={{ flex: 1 }}>
                          <MomentumBar
                            value={goal.likelihoodScore}
                            color={goal.likelihoodScore >= 70 ? tokens.green : goal.likelihoodScore >= 40 ? tokens.amber : tokens.red}
                            height={3}
                          />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, whiteSpace: 'nowrap' }}>{goal.likelihoodScore} / 100</span>
                        {goal.likelihoodTrend === 'up'   && <span style={{ fontSize: '12px', color: tokens.green }}>↑</span>}
                        {goal.likelihoodTrend === 'down' && <span style={{ fontSize: '12px', color: tokens.red   }}>↓</span>}
                        {goal.likelihoodTrend === 'flat' && <span style={{ fontSize: '12px', color: tokens.textMuted }}>→</span>}
                      </>
                    ) : (
                      <>
                        <div style={{ flex: 1 }}><MomentumBar value={0} color={tokens.textMuted} height={3} /></div>
                        <span style={{ fontSize: '11px', color: tokens.textMuted, whiteSpace: 'nowrap' }}>— / 100</span>
                      </>
                    )}
                  </div>

                  {/* Dependencies */}
                  {depNames.length > 0 && (
                    <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Depends on</span>
                      {depNames.map(name => (
                        <span key={name} style={{ fontSize: '11px', color: tokens.blue, background: tokens.blueDim, borderRadius: '4px', padding: '2px 8px', fontWeight: 600 }}>{name}</span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px', marginTop: '12px' }}>
                    <button onClick={() => openEdit(goal)} style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', padding: '2px 8px', fontFamily: fonts.body }}>Edit</button>
                    <button onClick={() => handleDelete(goal.id)} style={{ background: 'none', border: 'none', color: tokens.red, fontSize: '11px', cursor: 'pointer', padding: '2px 8px', opacity: 0.6, fontFamily: fonts.body }}>✕</button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal */}
      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit Goal' : 'New Goal'} width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input
            label="Goal"
            value={form.title}
            onChange={v => setForm(f => ({ ...f, title: v }))}
            placeholder="What do you want to achieve?"
          />
          <Input
            label="Why it matters"
            value={form.why}
            onChange={v => setForm(f => ({ ...f, why: v }))}
            placeholder="What changes when you hit this?"
            multiline rows={2}
          />
          <Input
            label="Description"
            value={form.description}
            onChange={v => setForm(f => ({ ...f, description: v }))}
            placeholder="Any additional context..."
            multiline rows={2}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted }}>Target Date</label>
              <input
                type="month"
                value={form.targetDate}
                onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))}
                style={monthInputStyle}
                onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                onBlur={e => e.target.style.borderColor = tokens.border}
              />
            </div>
            <Select
              label="Status"
              value={form.status}
              onChange={v => setForm(f => ({ ...f, status: v }))}
              options={STATUS_OPTIONS}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Input
              label="Target Amount ($)"
              type="number"
              value={form.targetAmount}
              onChange={v => setForm(f => ({ ...f, targetAmount: v }))}
              placeholder="Optional"
            />
            <Input
              label="Current Amount ($)"
              type="number"
              value={form.currentAmount}
              onChange={v => setForm(f => ({ ...f, currentAmount: v }))}
              placeholder="Optional"
            />
          </div>

          {/* Dependencies */}
          {goals.filter(g => g.id !== editing).length > 0 && (
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '8px' }}>
                Depends On (optional)
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {goals.filter(g => g.id !== editing).map(g => (
                  <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '8px 12px', borderRadius: tokens.radiusMd, background: form.dependencies.includes(g.id) ? tokens.blueDim : 'transparent', border: `1px solid ${form.dependencies.includes(g.id) ? 'rgba(91,143,212,0.3)' : tokens.border}`, transition: 'all 0.15s' }}>
                    <input
                      type="checkbox"
                      checked={form.dependencies.includes(g.id)}
                      onChange={() => toggleDep(g.id)}
                      style={{ accentColor: tokens.accent, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: '13px', color: tokens.textSecondary }}>{g.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button onClick={closeModal} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>
              {editing ? 'Save' : 'Add Goal'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
