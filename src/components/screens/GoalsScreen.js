// src/components/screens/GoalsScreen.js
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addGoal, updateGoal, deleteGoal, addTask, getAICache, saveAICache } from '../../lib/db';
import { scoreGoals, generateGoalScenarios } from '../../lib/ai';
import { fetchMonthlyCashFlow } from '../../lib/plaid';
import { Button, Input, Select, Modal, EmptyState, MomentumBar, Tag } from '../ui';

const STATUS_OPTIONS = [
  { value: 'active',   label: 'Active'   },
  { value: 'achieved', label: 'Achieved' },
  { value: 'paused',   label: 'Paused'   },
];

const CONTEXT_OPTIONS = [
  { value: '',               label: 'No context'         },
  { value: 'wells-fargo',    label: 'Wells Fargo'        },
  { value: 'personal',       label: 'Personal'           },
  { value: 'side-business',  label: 'Side Business'      },
  { value: 'home-family',    label: 'Home/Family'        },
  { value: 'financial',      label: 'Financial Recovery' },
];

const GOAL_TYPE_OPTIONS = [
  { value: 'financial',   label: 'Financial — debt payoff, savings, income targets' },
  { value: 'project',     label: 'Project — home, build, launch something'          },
  { value: 'income',      label: 'Income — new revenue stream'                      },
  { value: 'qualitative', label: 'Life — health, relationships, personal'           },
];

const GOAL_TYPE_CONFIG = {
  financial:   { label: 'Financial', color: '#6DBF9E' },
  project:     { label: 'Project',   color: '#5B8FD4' },
  income:      { label: 'Income',    color: '#C8A96E' },
  qualitative: { label: 'Life',      color: '#9B85C9' },
};

const statusConfig = {
  active:   { label: 'Active',   bg: 'rgba(109,191,158,0.12)', text: '#6DBF9E'                   },
  achieved: { label: 'Achieved', bg: 'rgba(200,169,110,0.12)', text: '#C8A96E'                   },
  paused:   { label: 'Paused',   bg: 'rgba(28,24,20,0.07)',    text: 'rgba(28,24,20,0.40)'      },
};

const emptyForm = {
  title: '', description: '', why: '',
  targetDate: '', targetAmount: '', currentAmount: '',
  status: 'active', dependencies: [], goalType: 'project', context: '',
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
  const navigate                          = useNavigate();
  const { user }                          = useAuth();
  const { goals, tasks, brainDumps, plaidItems, weeklyReviews } = useData();
  const [showModal,      setShowModal]      = useState(false);
  const [form,           setForm]           = useState(emptyForm);
  const [editing,        setEditing]        = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [scoring,        setScoring]        = useState(false);
  const [filterContext,  setFilterContext]  = useState('');
  const hasScoredRef                        = useRef(false);

  // Scenario modeling state
  const [scenarioGoalId,  setScenarioGoalId]  = useState(null);
  const [scenarios,       setScenarios]       = useState([]);
  const [loadingScenario, setLoadingScenario] = useState(false);
  const [pickedScenario,  setPickedScenario]  = useState(null);
  const [creatingTasks,   setCreatingTasks]   = useState(false);

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
      // Fetch real financial data to ground scores in actual numbers
      const plaidData = await fetchMonthlyCashFlow(plaidItems).catch(() => null);
      const scores = await scoreGoals({
        goals:         activeGoals,
        tasks,
        brainDumps,
        plaidData,
        reviewHistory: weeklyReviews || [],
      });
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
  }, [user, goals.length]); // eslint-disable-line react-hooks/exhaustive-deps -- runScoring lacks useCallback; goals.length (not goals) intentionally fires once when goals first populate, not on every goal edit

  const activeCount   = goals.filter(g => g.status === 'active').length;
  const achievedCount = goals.filter(g => g.status === 'achieved').length;
  const pausedCount   = goals.filter(g => g.status === 'paused').length;

  const openNew = () => { setForm(emptyForm); setEditing(null); setShowModal(true); };

  const openEdit = (goal, e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    setForm({
      title:         goal.title         || '',
      description:   goal.description   || '',
      why:           goal.why           || '',
      targetDate:    goal.targetDate    || '',
      targetAmount:  goal.targetAmount  != null ? String(goal.targetAmount)  : '',
      currentAmount: goal.currentAmount != null ? String(goal.currentAmount) : '',
      status:        goal.status        || 'active',
      dependencies:  goal.dependencies  || [],
      goalType:      goal.goalType      || 'project',
      context:       goal.context       || '',
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
      goalType:      form.goalType      || 'project',
      context:       form.context       || null,
    };
    if (editing) {
      const existingGoal = goals.find(g => g.id === editing);
      if (existingGoal && form.targetDate && existingGoal.targetDate && form.targetDate > existingGoal.targetDate) {
        data.targetDateChanges = (existingGoal.targetDateChanges || 0) + 1;
      }
      await updateGoal(user.uid, editing, data);
    } else {
      await addGoal(user.uid, data);
    }
    setSaving(false);
    closeModal();
  };

  const handleDelete = async (id) => { await deleteGoal(user.uid, id); };

  const openScenarios = async (goal) => {
    setScenarioGoalId(goal.id);
    setScenarios([]);
    setPickedScenario(null);
    setLoadingScenario(true);
    try {
      const result = await generateGoalScenarios({ goal, tasks, brainDumps });
      setScenarios(result.scenarios || []);
    } catch {
      setScenarios([]);
    } finally {
      setLoadingScenario(false);
    }
  };

  const closeScenarios = () => {
    setScenarioGoalId(null);
    setScenarios([]);
    setPickedScenario(null);
  };

  const adoptScenario = async (scenario) => {
    if (creatingTasks) return;
    setCreatingTasks(true);
    const goal = goals.find(g => g.id === scenarioGoalId);
    try {
      await Promise.all(
        scenario.steps.map(step =>
          addTask(user.uid, {
            title:    step,
            project:  goal?.title || '',
            goalId:   scenarioGoalId,
            priority: 'high',
            status:   'pending',
            tags:     ['recovery'],
          })
        )
      );
      await updateGoal(user.uid, scenarioGoalId, { recoveryScenario: scenario.title });
    } catch (err) {
      console.error('adoptScenario error:', err);
    } finally {
      setCreatingTasks(false);
      closeScenarios();
    }
  };

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
    colorScheme: 'light',
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

      {/* Context filter pills */}
      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {CONTEXT_OPTIONS.map(opt => (
          <button key={opt.value} onClick={() => setFilterContext(filterContext === opt.value ? '' : opt.value)}
            style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: '99px', background: filterContext === opt.value ? tokens.accentDim : 'transparent', color: filterContext === opt.value ? tokens.accent : tokens.textMuted, border: `1px solid ${filterContext === opt.value ? 'rgba(200,169,110,0.2)' : tokens.border}`, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
            {opt.value === '' ? 'All' : opt.label}
          </button>
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
          goals.filter(goal => !filterContext || goal.context === filterContext).map(goal => {
            const sc       = statusConfig[goal.status] || statusConfig.active;
            const months   = monthsFrom(goal.targetDate);
            const hasMoney = goal.targetAmount != null;
            const progress = hasMoney && goal.currentAmount != null
              ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100))
              : 0;
            const depNames = (goal.dependencies || [])
              .map(id => goals.find(g => g.id === id)?.title)
              .filter(Boolean);

            const typeConfig = GOAL_TYPE_CONFIG[goal.goalType] || GOAL_TYPE_CONFIG.project;

            return (
              <div key={goal.id}
                onClick={() => navigate(`/goals/${goal.id}`)}
                style={{ display: 'flex', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg, overflow: 'hidden', transition: 'border-color 0.15s', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = tokens.borderHover}
                onMouseLeave={e => e.currentTarget.style.borderColor = tokens.border}
              >
                {/* Left status stripe */}
                <div style={{ width: 3, background: sc.text, flexShrink: 0 }} />

                <div style={{ flex: 1, padding: '18px 20px' }}>
                  {/* Title + status */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '6px' }}>
                    <div>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: typeConfig.color + '22', color: typeConfig.color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                          {typeConfig.label}
                        </span>
                        <Tag label={sc.label} color={sc.bg} textColor={sc.text} />
                        {goal.context && (
                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', background: 'rgba(91,143,212,0.12)', color: '#5B8FD4', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                            {CONTEXT_OPTIONS.find(c => c.value === goal.context)?.label || goal.context}
                          </span>
                        )}
                        {goal.targetDateChanges > 0 && (
                          <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: 'rgba(212,122,107,0.12)', color: tokens.red }}>
                            ↻{goal.targetDateChanges}
                          </span>
                        )}
                      </div>
                      <div style={{ fontFamily: fonts.display, fontSize: '17px', fontWeight: 700, color: tokens.textPrimary, lineHeight: 1.3 }}>{goal.title}</div>
                    </div>
                    <div style={{ fontSize: '11px', color: tokens.textMuted, flexShrink: 0, marginTop: '2px' }}>View →</div>
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

                  {/* Off-track recovery prompt */}
                  {goal.status === 'active' && goal.likelihoodScore != null && goal.likelihoodScore < 50 && scenarioGoalId !== goal.id && (
                    <div style={{ marginTop: '12px', padding: '10px 14px', background: `${tokens.red}14`, border: `1px solid ${tokens.red}30`, borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.red }}>⚑ Off track</div>
                        <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>Score is {goal.likelihoodScore}/100 — generate recovery scenarios</div>
                      </div>
                      <Button size="sm" onClick={() => openScenarios(goal)}>Get Back on Track</Button>
                    </div>
                  )}

                  {/* Scenario panel */}
                  {scenarioGoalId === goal.id && (
                    <div style={{ marginTop: '12px', padding: '14px', background: tokens.bgCardHover, border: `1px solid ${tokens.border}`, borderRadius: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: tokens.textPrimary }}>Recovery Scenarios</div>
                        <button onClick={closeScenarios} style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '2px' }}>✕</button>
                      </div>

                      {loadingScenario && (
                        <div style={{ fontSize: '12px', color: tokens.textMuted, textAlign: 'center', padding: '12px 0' }}>
                          Generating recovery options…
                        </div>
                      )}

                      {!loadingScenario && scenarios.length === 0 && (
                        <div style={{ fontSize: '12px', color: tokens.textMuted }}>Could not generate scenarios. Try again.</div>
                      )}

                      {!loadingScenario && scenarios.map(s => (
                        <div key={s.id}
                          onClick={() => setPickedScenario(pickedScenario?.id === s.id ? null : s)}
                          style={{
                            marginBottom: '8px',
                            padding: '12px 14px',
                            background: pickedScenario?.id === s.id ? tokens.accentDim : tokens.bgCard,
                            border: `1px solid ${pickedScenario?.id === s.id ? tokens.accent : tokens.border}`,
                            borderRadius: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>{s.title}</div>
                            <span style={{ fontSize: '11px', color: tokens.green, background: tokens.greenDim, borderRadius: '4px', padding: '2px 7px', fontWeight: 600 }}>+{s.likelihoodBoost}%</span>
                          </div>
                          <div style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '8px' }}>{s.description}</div>
                          {pickedScenario?.id === s.id && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {s.steps.map((step, i) => (
                                <div key={i} style={{ fontSize: '11px', color: tokens.textMuted, display: 'flex', gap: '6px' }}>
                                  <span style={{ color: tokens.accent, fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                                  {step}
                                </div>
                              ))}
                              <Button
                                size="sm"
                                loading={creatingTasks}
                                onClick={(e) => { e.stopPropagation(); adoptScenario(s); }}
                                style={{ marginTop: '8px', alignSelf: 'flex-end' }}
                              >
                                Adopt — Create Tasks
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px', marginTop: '12px' }}>
                    <button onClick={e => openEdit(goal, e)} style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', padding: '2px 8px', fontFamily: fonts.body }}>Edit</button>
                    <button onClick={e => { e.stopPropagation(); handleDelete(goal.id); }} style={{ background: 'none', border: 'none', color: tokens.red, fontSize: '11px', cursor: 'pointer', padding: '2px 8px', opacity: 0.6, fontFamily: fonts.body }}>✕</button>
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

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '8px' }}>Goal Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {GOAL_TYPE_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setForm(f => ({ ...f, goalType: opt.value }))}
                  style={{ padding: '8px 12px', borderRadius: '8px', border: `1px solid ${form.goalType === opt.value ? (GOAL_TYPE_CONFIG[opt.value]?.color || tokens.accent) : tokens.border}`, background: form.goalType === opt.value ? (GOAL_TYPE_CONFIG[opt.value]?.color || tokens.accent) + '18' : 'transparent', color: form.goalType === opt.value ? (GOAL_TYPE_CONFIG[opt.value]?.color || tokens.accent) : tokens.textMuted, cursor: 'pointer', fontSize: '12px', fontFamily: fonts.body, textAlign: 'left', fontWeight: form.goalType === opt.value ? 600 : 400, transition: 'all 0.12s' }}>
                  {opt.label.split(' — ')[0]}
                </button>
              ))}
            </div>
          </div>

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

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Context</label>
            <select value={form.context} onChange={e => setForm(f => ({ ...f, context: e.target.value }))}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
              {CONTEXT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
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
