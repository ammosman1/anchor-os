// src/components/screens/GoalDetailScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { updateGoal, addTask, updateTask, getAICache, saveAICache } from '../../lib/db';
import { generateGoalInsights, generateGoalExecutionPlan } from '../../lib/ai';
import { RECURRENCE_OPTIONS } from '../../lib/tasks';
import { fetchMonthlyCashFlow, fetchAccounts } from '../../lib/plaid';
import { Button, Modal, Input, MomentumBar, Spinner } from '../ui';

const GOAL_TYPE_CONFIG = {
  financial:   { label: 'Financial',   color: '#6DBF9E' },
  project:     { label: 'Project',     color: '#5B8FD4' },
  income:      { label: 'Income',      color: '#C8A96E' },
  qualitative: { label: 'Life',        color: '#9B85C9' },
};

const PRIORITIES = ['critical', 'high', 'medium', 'low'];

const FOCUS_TYPES = [
  { value: 'deep',    label: '🧠 Deep Work' },
  { value: 'shallow', label: '💬 Shallow'   },
  { value: 'admin',   label: '📋 Admin'     },
];

function monthsFrom(yyyyMM) {
  if (!yyyyMM) return null;
  const [y, m] = yyyyMM.split('-').map(Number);
  const now = new Date();
  return (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1));
}

function formatTargetDate(yyyyMM) {
  if (!yyyyMM) return null;
  const [y, m] = yyyyMM.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.textMuted, marginBottom: '14px' }}>
      {children}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg, padding: '20px', marginBottom: '12px', ...style }}>
      {children}
    </div>
  );
}

export default function GoalDetailScreen() {
  const { goalId }   = useParams();
  const navigate     = useNavigate();
  const { user }     = useAuth();
  const { goals, tasks, weeklyReviews, projects, plaidItems } = useData();

  const goal            = goals.find(g => g.id === goalId);
  const linkedTasks     = tasks.filter(t => t.goalId === goalId);
  const completedTasks  = linkedTasks.filter(t => t.done);
  const activeTasks     = linkedTasks.filter(t => !t.done);

  const [insights,       setInsights]       = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const [showPlan,       setShowPlan]       = useState(false);
  const [plan,           setPlan]           = useState(null);
  const [planLoading,    setPlanLoading]    = useState(false);
  const [planApproving,  setPlanApproving]  = useState(false);
  const [approvedTasks,  setApprovedTasks]  = useState(new Set());

  const [addTaskOpen,    setAddTaskOpen]    = useState(false);
  const [addingTask,     setAddingTask]     = useState(false);
  const emptyTaskForm = {
    title: '', priority: 'high', focusType: 'deep', project: '',
    estimatedMinutes: '', dueDate: '', notes: '', tags: '', recurrence: 'none',
  };
  const [newTaskForm,    setNewTaskForm]    = useState(emptyTaskForm);

  const [balanceOpen,     setBalanceOpen]     = useState(false);
  const [newBalance,      setNewBalance]      = useState('');
  const [plaidAccounts,   setPlaidAccounts]   = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const loadInsights = useCallback(async (force = false) => {
    if (!goal || insightsLoading) return;
    if (!force) {
      const cached = await getAICache(user.uid, `goal-insight-${goalId}`, 6);
      if (cached) {
        try { setInsights(JSON.parse(cached)); return; } catch {}
      }
    }
    setInsightsLoading(true);
    try {
      const plaidData = await fetchMonthlyCashFlow(plaidItems).catch(() => null);
      const result = await generateGoalInsights({
        goal,
        linkedTasks,
        completedTasks,
        weeklyReviews: weeklyReviews || [],
        plaidData,
      });
      if (result) {
        setInsights(result);
        await saveAICache(user.uid, `goal-insight-${goalId}`, JSON.stringify(result));
      }
    } catch (err) {
      console.error('Goal insights error:', err);
    } finally {
      setInsightsLoading(false);
    }
  }, [goal, goalId, user, linkedTasks, completedTasks, weeklyReviews]); // eslint-disable-line

  useEffect(() => {
    if (goal) loadInsights();
  }, [goalId]); // eslint-disable-line

  const handleGeneratePlan = async () => {
    setPlanLoading(true);
    setShowPlan(true);
    setPlan(null);
    try {
      const result = await generateGoalExecutionPlan({
        goal,
        existingTasks: linkedTasks,
        projects,
        daysAvailablePerWeek: 3,
      });
      if (result) {
        setPlan(result);
        setApprovedTasks(new Set(result.tasks?.map((_, i) => i) || []));
      }
    } catch (err) {
      console.error('Plan generation error:', err);
    } finally {
      setPlanLoading(false);
    }
  };

  const handleApprovePlan = async () => {
    if (!plan || planApproving) return;
    setPlanApproving(true);
    try {
      const toCreate = plan.tasks.filter((_, i) => approvedTasks.has(i));
      await Promise.all(toCreate.map(t =>
        addTask(user.uid, {
          title:            t.title,
          priority:         t.priority || 'high',
          estimatedMinutes: t.estimatedMinutes || null,
          notes:            t.notes || '',
          project:          t.project || goal.title || 'Inbox',
          goalId,
          status:           'pending',
        })
      ));
      setShowPlan(false);
      setPlan(null);
    } catch (err) {
      console.error('Task creation error:', err);
    } finally {
      setPlanApproving(false);
    }
  };

  const handleAddTask = async () => {
    if (!newTaskForm.title.trim() || addingTask) return;
    setAddingTask(true);
    try {
      const tagsArr = newTaskForm.tags
        ? newTaskForm.tags.split(',').map(t => t.trim()).filter(Boolean)
        : [];
      await addTask(user.uid, {
        title:            newTaskForm.title.trim(),
        priority:         newTaskForm.priority,
        focusType:        newTaskForm.focusType || null,
        project:          newTaskForm.project || goal.title || 'Inbox',
        estimatedMinutes: newTaskForm.estimatedMinutes ? Number(newTaskForm.estimatedMinutes) : null,
        dueDate:          newTaskForm.dueDate || null,
        notes:            newTaskForm.notes || '',
        tags:             tagsArr.length ? tagsArr : null,
        recurrence:       newTaskForm.recurrence !== 'none' ? newTaskForm.recurrence : null,
        goalId,
        status:           'pending',
      });
      setNewTaskForm(emptyTaskForm);
      setAddTaskOpen(false);
    } finally {
      setAddingTask(false);
    }
  };

  const handleToggleTask = async (task) => {
    await updateTask(user.uid, task.id, {
      done:        !task.done,
      status:      !task.done ? 'completed' : 'pending',
      completedAt: !task.done ? new Date().toISOString() : null,
    });
  };

  const loadPlaidAccounts = useCallback(async () => {
    if (!plaidItems?.length) return;
    setLoadingAccounts(true);
    try {
      const all = await Promise.all(plaidItems.map(item => fetchAccounts(item.accessToken)));
      setPlaidAccounts(all.flat().filter(a => a.balances?.current != null));
    } catch (err) {
      console.error('Failed to load Plaid accounts:', err);
    } finally {
      setLoadingAccounts(false);
    }
  }, [plaidItems]);

  useEffect(() => {
    if (balanceOpen && plaidItems?.length > 0 && plaidAccounts.length === 0) {
      loadPlaidAccounts();
    }
  }, [balanceOpen]); // eslint-disable-line

  // Auto-sync balance from Plaid on load if account is linked
  useEffect(() => {
    if (!goal || goal.goalType !== 'financial' || !goal.plaidAccountId || !plaidItems?.length) return;
    const autoSync = async () => {
      try {
        const all = await Promise.all(plaidItems.map(item => fetchAccounts(item.accessToken)));
        const accounts = all.flat();
        const acct = accounts.find(a => a.accountId === goal.plaidAccountId);
        if (acct?.balances?.current != null) {
          await updateGoal(user.uid, goalId, { currentAmount: acct.balances.current });
        }
      } catch {}
    };
    autoSync();
  }, [goalId]); // eslint-disable-line

  const handleUpdateBalance = async () => {
    const amount = parseFloat(newBalance);
    if (isNaN(amount)) return;
    await updateGoal(user.uid, goalId, { currentAmount: amount });
    setBalanceOpen(false);
    setNewBalance('');
  };

  const handleSyncFromPlaid = async (account) => {
    setNewBalance(String(account.balances.current));
    await updateGoal(user.uid, goalId, { plaidAccountId: account.accountId });
  };

  if (!goal) {
    return (
      <div style={{ maxWidth: 720, margin: '60px auto', textAlign: 'center', padding: '0 20px' }}>
        <div style={{ fontSize: '13px', color: tokens.textMuted, marginBottom: '16px' }}>Goal not found.</div>
        <Button onClick={() => navigate('/goals')} variant="ghost">← Back to Goals</Button>
      </div>
    );
  }

  const typeConfig   = GOAL_TYPE_CONFIG[goal.goalType] || GOAL_TYPE_CONFIG.project;
  const months       = monthsFrom(goal.targetDate);
  const taskProgress = linkedTasks.length > 0
    ? Math.round((completedTasks.length / linkedTasks.length) * 100) : 0;
  const hasMoney     = goal.targetAmount != null && goal.currentAmount != null;
  const moneyProgress = hasMoney
    ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)) : 0;
  const score        = goal.likelihoodScore;
  const scoreColor   = score >= 70 ? tokens.green : score >= 40 ? tokens.amber : score != null ? tokens.red : tokens.textMuted;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: '40px' }}>

      {/* Back */}
      <button onClick={() => navigate('/goals')}
        style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: '13px', fontFamily: fonts.body, padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: '5px' }}>
        ← Goals
      </button>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '5px', background: typeConfig.color + '22', color: typeConfig.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {typeConfig.label}
          </span>
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '5px', background: goal.status === 'active' ? 'rgba(109,191,158,0.12)' : tokens.accentDim, color: goal.status === 'active' ? tokens.green : tokens.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {goal.status}
          </span>
          {goal.targetDate && (
            <span style={{ fontSize: '11px', color: months != null && months <= 0 ? tokens.red : months != null && months <= 3 ? tokens.amber : tokens.textMuted }}>
              {months != null && months <= 0 ? '⚑ Past due · ' : ''}{formatTargetDate(goal.targetDate)}
            </span>
          )}
        </div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
          {goal.title}
        </h1>
        {goal.why && (
          <div style={{ fontSize: '14px', color: tokens.textSecondary, fontStyle: 'italic', lineHeight: 1.55 }}>
            "{goal.why}"
          </div>
        )}
      </div>

      {/* ── Trajectory Card ── */}
      <Card>
        <SectionLabel>Trajectory</SectionLabel>

        {/* Score + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '18px' }}>
          <div style={{ fontFamily: fonts.display, fontSize: '48px', fontWeight: 700, color: scoreColor, lineHeight: 1, minWidth: '70px' }}>
            {score ?? '—'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '15px', fontWeight: 600, color: tokens.textPrimary }}>
                {score == null ? 'Not scored yet' : score >= 70 ? 'On track' : score >= 40 ? 'Needs attention' : 'At risk'}
              </span>
              {goal.likelihoodTrend === 'up'   && <span style={{ fontSize: '12px', color: tokens.green  }}>↑ improving</span>}
              {goal.likelihoodTrend === 'down' && <span style={{ fontSize: '12px', color: tokens.red    }}>↓ declining</span>}
              {goal.likelihoodTrend === 'flat' && <span style={{ fontSize: '12px', color: tokens.textMuted }}>→ stable</span>}
            </div>
            <MomentumBar value={score || 0} color={scoreColor} height={5} />
          </div>
        </div>

        {/* Target vs Projected */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
          <div style={{ padding: '12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
            <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px' }}>Target Date</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary }}>{formatTargetDate(goal.targetDate) || 'Not set'}</div>
            {months != null && (
              <div style={{ fontSize: '11px', color: months <= 0 ? tokens.red : months <= 6 ? tokens.amber : tokens.textMuted, marginTop: '3px' }}>
                {months <= 0 ? 'Past due' : `${months}mo away`}
              </div>
            )}
          </div>
          <div style={{ padding: '12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
            <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px' }}>Projected Date</div>
            {insightsLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Spinner size={13} /><span style={{ fontSize: '12px', color: tokens.textMuted }}>Analyzing…</span></div>
            ) : insights?.projectedDate ? (
              <>
                <div style={{ fontSize: '14px', fontWeight: 600, color: insights.projectedDate > (goal.targetDate || '') ? tokens.red : tokens.green }}>
                  {formatTargetDate(insights.projectedDate)}
                </div>
                {insights.projectedDate > (goal.targetDate || '') && (
                  <div style={{ fontSize: '11px', color: tokens.red, marginTop: '3px' }}>Behind target</div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '12px', color: tokens.textMuted }}>Run analysis</div>
            )}
          </div>
        </div>

        {/* Financial balance */}
        {goal.goalType === 'financial' && (
          <div style={{ marginBottom: '16px', padding: '12px 14px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: hasMoney ? '12px' : '0' }}>
              <div>
                <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted, marginBottom: '3px' }}>Current Balance</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: tokens.accent }}>
                  {goal.currentAmount != null ? `$${goal.currentAmount.toLocaleString()}` : '—'}
                </div>
                {goal.targetAmount != null && (
                  <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                    of ${goal.targetAmount.toLocaleString()} target
                    {goal.plaidAccountId && <span style={{ marginLeft: 6, color: tokens.green }}>· Plaid linked</span>}
                  </div>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => { setNewBalance(goal.currentAmount != null ? String(goal.currentAmount) : ''); setBalanceOpen(true); }}>
                Update
              </Button>
            </div>
            {hasMoney && (
              <>
                <MomentumBar value={moneyProgress} color={tokens.accent} height={5} />
                <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '4px' }}>{moneyProgress}% of target</div>
              </>
            )}
          </div>
        )}

        {/* AI insight statements */}
        {insights && (
          <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: '14px' }}>
            {insights.onTrackStatement && (
              <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.65, marginBottom: '8px' }}>
                {insights.onTrackStatement}
              </div>
            )}
            {insights.gapStatement && (
              <div style={{ fontSize: '12px', color: tokens.textMuted, lineHeight: 1.55, marginBottom: '8px' }}>
                {insights.gapStatement}
              </div>
            )}
            {(insights.requiredPaceStatement || insights.currentPaceStatement) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px' }}>
                {insights.requiredPaceStatement && (
                  <div style={{ padding: '8px 10px', background: tokens.bgGlass, borderRadius: '6px', border: `1px solid ${tokens.border}` }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted, marginBottom: '3px' }}>Required Pace</div>
                    <div style={{ fontSize: '11px', color: tokens.textSecondary }}>{insights.requiredPaceStatement}</div>
                  </div>
                )}
                {insights.currentPaceStatement && (
                  <div style={{ padding: '8px 10px', background: tokens.bgGlass, borderRadius: '6px', border: `1px solid ${tokens.border}` }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted, marginBottom: '3px' }}>Current Pace</div>
                    <div style={{ fontSize: '11px', color: tokens.textSecondary }}>{insights.currentPaceStatement}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={() => loadInsights(true)} loading={insightsLoading}>
            {insights ? '↻ Refresh Analysis' : '✦ Run Analysis'}
          </Button>
        </div>
      </Card>

      {/* ── This Week Card ── */}
      {(insightsLoading || insights) && (
        <Card>
          <SectionLabel>This Week</SectionLabel>

          {insightsLoading && !insights && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: tokens.textMuted, fontSize: '13px' }}>
              <Spinner size={14} /> Analyzing trajectory…
            </div>
          )}

          {insights && (
            <>
              {insights.thisWeekActions?.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '10px' }}>Required Actions</div>
                  {insights.thisWeekActions.map((action, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: i < insights.thisWeekActions.length - 1 ? `1px solid ${tokens.border}` : 'none' }}>
                      <span style={{ color: tokens.accent, fontWeight: 700, fontSize: '12px', flexShrink: 0, minWidth: '16px' }}>{i + 1}.</span>
                      <span style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.5 }}>{action}</span>
                    </div>
                  ))}
                </div>
              )}

              {insights.whatToIgnore && (
                <div style={{ padding: '10px 14px', background: 'rgba(200,169,110,0.08)', borderRadius: '8px', border: `1px solid rgba(200,169,110,0.2)`, marginBottom: '14px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.amber, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Ignore This Week</div>
                  <div style={{ fontSize: '12px', color: tokens.textSecondary }}>{insights.whatToIgnore}</div>
                </div>
              )}

              {insights.topRisks?.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '8px' }}>Top Risks</div>
                  {insights.topRisks.map((risk, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: tokens.textMuted, padding: '4px 0', lineHeight: 1.45 }}>
                      <span style={{ color: tokens.red, flexShrink: 0 }}>⚑</span> {risk}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* ── Task Progress Card ── */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <SectionLabel style={{ marginBottom: 0 }}>Tasks · {completedTasks.length}/{linkedTasks.length} done</SectionLabel>
          <Button size="sm" variant="ghost" onClick={() => setAddTaskOpen(true)}>+ Add Task</Button>
        </div>

        {linkedTasks.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <MomentumBar value={taskProgress} color={tokens.green} height={5} />
            <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '4px' }}>{taskProgress}% complete</div>
          </div>
        )}

        {linkedTasks.length === 0 && (
          <div style={{ fontSize: '13px', color: tokens.textMuted, textAlign: 'center', padding: '20px 0' }}>
            No tasks linked to this goal yet.<br />
            <span style={{ fontSize: '12px' }}>Generate a plan below or add tasks manually.</span>
          </div>
        )}

        {/* Active tasks */}
        {activeTasks.map((task, i) => (
          <div key={task.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '9px 0', borderBottom: i < activeTasks.length - 1 || completedTasks.length > 0 ? `1px solid ${tokens.border}` : 'none' }}>
            <div
              onClick={() => handleToggleTask(task)}
              style={{ width: 18, height: 18, borderRadius: '4px', flexShrink: 0, marginTop: '2px', border: `1.5px solid ${tokens.border}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.green; e.currentTarget.style.background = 'rgba(109,191,158,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.background = 'transparent'; }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.4 }}>{task.title}</div>
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px', display: 'flex', gap: '8px' }}>
                <span style={{ textTransform: 'capitalize' }}>{task.priority}</span>
                {task.estimatedMinutes && <span>⏱ {task.estimatedMinutes}m</span>}
                {task.scheduledDate && <span>📅 {task.scheduledDate}</span>}
              </div>
            </div>
          </div>
        ))}

        {/* Completed tasks */}
        {completedTasks.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '6px', paddingTop: '4px' }}>
              {completedTasks.length} completed
            </div>
            {completedTasks.slice(0, 4).map(task => (
              <div key={task.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '6px 0', opacity: 0.5 }}>
                <div style={{ width: 18, height: 18, borderRadius: '4px', flexShrink: 0, border: `1.5px solid ${tokens.green}`, background: 'rgba(109,191,158,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: tokens.green }}>✓</div>
                <div style={{ fontSize: '13px', color: tokens.textPrimary, textDecoration: 'line-through' }}>{task.title}</div>
              </div>
            ))}
            {completedTasks.length > 4 && (
              <div style={{ fontSize: '11px', color: tokens.textMuted, paddingLeft: '28px' }}>+{completedTasks.length - 4} more</div>
            )}
          </div>
        )}
      </Card>

      {/* ── Execution Plan Card ── */}
      <Card>
        <SectionLabel>Execution Plan</SectionLabel>
        <div style={{ fontSize: '13px', color: tokens.textSecondary, marginBottom: '16px', lineHeight: 1.6 }}>
          AI breaks this goal into milestones and specific tasks. Review and approve before anything is created.
        </div>
        <Button onClick={handleGeneratePlan} variant="accent">✦ Generate Execution Plan</Button>
      </Card>

      {/* ── Execution Plan Modal ── */}
      <Modal open={showPlan} onClose={() => { setShowPlan(false); setPlan(null); }} title="Execution Plan" width={580}>
        {planLoading && (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <Spinner size={22} />
            <div style={{ fontSize: '13px', color: tokens.textMuted, marginTop: '14px' }}>Building your execution plan…</div>
          </div>
        )}

        {!planLoading && !plan && (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: '13px', color: tokens.textMuted }}>
            Could not generate plan. Try again.
          </div>
        )}

        {!planLoading && plan && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.65, padding: '12px 14px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
              {plan.summary}
            </div>

            {/* Milestones */}
            {plan.milestones?.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted, marginBottom: '8px' }}>Milestones</div>
                {plan.milestones.map((m, i) => (
                  <div key={i} style={{ display: 'flex', gap: '12px', padding: '10px 0', borderBottom: i < plan.milestones.length - 1 ? `1px solid ${tokens.border}` : 'none' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: tokens.accent, flexShrink: 0, minWidth: '24px' }}>M{i + 1}</span>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>{m.title}</div>
                      <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                        {m.targetMonth && `${formatTargetDate(m.targetMonth)} · `}{m.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tasks approval */}
            {plan.tasks?.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted }}>
                    Tasks to Create
                  </div>
                  <div style={{ fontSize: '11px', color: tokens.accent, fontWeight: 600 }}>{approvedTasks.size} selected</div>
                </div>
                {plan.tasks.map((task, i) => (
                  <div key={i}
                    onClick={() => setApprovedTasks(prev => {
                      const n = new Set(prev);
                      n.has(i) ? n.delete(i) : n.add(i);
                      return n;
                    })}
                    style={{ display: 'flex', gap: '10px', padding: '9px', borderRadius: '7px', marginBottom: '4px', background: approvedTasks.has(i) ? tokens.accentDim : 'transparent', border: `1px solid ${approvedTasks.has(i) ? 'rgba(200,169,110,0.35)' : tokens.border}`, cursor: 'pointer', transition: 'all 0.12s' }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: '3px', flexShrink: 0, marginTop: '2px', border: `1.5px solid ${approvedTasks.has(i) ? tokens.accent : tokens.border}`, background: approvedTasks.has(i) ? tokens.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#fff' }}>
                      {approvedTasks.has(i) ? '✓' : ''}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.35 }}>{task.title}</div>
                      <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                        {task.priority} · {task.estimatedMinutes}m{task.project && task.project !== 'Inbox' ? ` · ${task.project}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {plan.warnings?.length > 0 && (
              <div style={{ padding: '10px 14px', background: 'rgba(200,169,110,0.08)', borderRadius: '8px', border: `1px solid rgba(200,169,110,0.2)` }}>
                {plan.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: '12px', color: tokens.amber, lineHeight: 1.5 }}>⚑ {w}</div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', paddingTop: '4px', borderTop: `1px solid ${tokens.border}` }}>
              <Button variant="ghost" onClick={() => { setShowPlan(false); setPlan(null); }}>Cancel</Button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="ghost" size="sm" onClick={handleGeneratePlan} loading={planLoading}>Regenerate</Button>
                <Button onClick={handleApprovePlan} loading={planApproving} disabled={approvedTasks.size === 0}>
                  Create {approvedTasks.size} Task{approvedTasks.size !== 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Balance Update Modal */}
      <Modal open={balanceOpen} onClose={() => setBalanceOpen(false)} title="Update Balance">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Current Balance ($)</label>
            <input
              type="number"
              value={newBalance}
              onChange={e => setNewBalance(e.target.value)}
              placeholder="e.g. 12500"
              autoFocus
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
            />
          </div>

          {plaidItems?.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted, marginBottom: '8px' }}>
                Sync from Plaid
              </div>
              {loadingAccounts && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: tokens.textMuted }}>
                  <Spinner size={12} /> Loading accounts…
                </div>
              )}
              {!loadingAccounts && plaidAccounts.length === 0 && (
                <Button size="sm" variant="ghost" onClick={loadPlaidAccounts}>Load Accounts</Button>
              )}
              {plaidAccounts.map(acct => (
                <div key={acct.accountId}
                  onClick={() => handleSyncFromPlaid(acct)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', borderRadius: '7px', border: `1px solid ${goal.plaidAccountId === acct.accountId ? tokens.accent : tokens.border}`, background: goal.plaidAccountId === acct.accountId ? tokens.accentDim : 'transparent', cursor: 'pointer', marginBottom: '4px', transition: 'all 0.12s' }}
                  onMouseEnter={e => { if (goal.plaidAccountId !== acct.accountId) e.currentTarget.style.background = tokens.bgCardHover; }}
                  onMouseLeave={e => { if (goal.plaidAccountId !== acct.accountId) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div>
                    <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500 }}>{acct.name}</div>
                    <div style={{ fontSize: '11px', color: tokens.textMuted, textTransform: 'capitalize' }}>{acct.type} · {acct.subtype}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: tokens.accent }}>${acct.balances.current?.toLocaleString()}</div>
                    {goal.plaidAccountId === acct.accountId && <div style={{ fontSize: '10px', color: tokens.green }}>linked</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => setBalanceOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateBalance} disabled={!newBalance || isNaN(parseFloat(newBalance))}>Save Balance</Button>
          </div>
        </div>
      </Modal>

      {/* Add Task Modal */}
      <Modal open={addTaskOpen} onClose={() => { setAddTaskOpen(false); setNewTaskForm(emptyTaskForm); }} title="Add Task to Goal">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input label="Title" value={newTaskForm.title} onChange={v => setNewTaskForm(f => ({ ...f, title: v }))} placeholder="What needs to happen?" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Priority</label>
              <select value={newTaskForm.priority} onChange={e => setNewTaskForm(f => ({ ...f, priority: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Focus Type</label>
              <select value={newTaskForm.focusType} onChange={e => setNewTaskForm(f => ({ ...f, focusType: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {FOCUS_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Project</label>
              <select value={newTaskForm.project} onChange={e => setNewTaskForm(f => ({ ...f, project: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                <option value="">Use Goal Name</option>
                <option value="Inbox">Inbox</option>
                {(projects || []).filter(p => p.status === 'active').map(p => <option key={p.id} value={p.title}>{p.title}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Recurrence</label>
              <select value={newTaskForm.recurrence} onChange={e => setNewTaskForm(f => ({ ...f, recurrence: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {RECURRENCE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Due Date</label>
              <input type="date" value={newTaskForm.dueDate}
                onChange={e => setNewTaskForm(f => ({ ...f, dueDate: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, colorScheme: 'light', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Est. Minutes</label>
              <input type="number" min="5" max="480" value={newTaskForm.estimatedMinutes}
                onChange={e => setNewTaskForm(f => ({ ...f, estimatedMinutes: e.target.value }))}
                placeholder="45"
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Tags (comma separated)</label>
            <input value={newTaskForm.tags} onChange={e => setNewTaskForm(f => ({ ...f, tags: e.target.value }))}
              placeholder="e.g. design, research"
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
          </div>

          <Input label="Notes" value={newTaskForm.notes} onChange={v => setNewTaskForm(f => ({ ...f, notes: v }))} placeholder="Context, links, details..." multiline rows={2} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => { setAddTaskOpen(false); setNewTaskForm(emptyTaskForm); }}>Cancel</Button>
            <Button onClick={handleAddTask} loading={addingTask} disabled={!newTaskForm.title.trim()}>Add Task</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
