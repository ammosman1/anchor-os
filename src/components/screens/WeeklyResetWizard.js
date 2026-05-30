// src/components/screens/WeeklyResetWizard.js
// Sunday Weekly Reset — 7-step guided wizard to plan the week ahead
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { updateGoal, updateProject, updateTask, saveWeeklyReset } from '../../lib/db';
import { generateWeeklySummary } from '../../lib/ai';
import { Card, Button, SectionLabel, EmptyState, Spinner } from '../ui';

const isDev = process.env.NODE_ENV !== 'production';

function getWeekKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Sunday of this week
  return d.toISOString().split('T')[0];
}

const ENERGY_OPTIONS = [
  { value: 1, emoji: '😴', label: 'Drained' },
  { value: 2, emoji: '😐', label: 'Low' },
  { value: 3, emoji: '😊', label: 'Okay' },
  { value: 4, emoji: '💪', label: 'Good' },
  { value: 5, emoji: '🔥', label: 'Energized' },
];

const STEP_TITLES = [
  'Check-in',
  'Goals Review',
  'Projects Review',
  'Task Triage',
  'Finance Check',
  'Week Preview',
  'Wrap Up',
];

export default function WeeklyResetWizard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tasks, goals, projects, debtAccounts, manualCashFlow, savingsAnalysis } = useData();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  const [energy, setEnergy] = useState(3);
  const [weeklyIntention, setWeeklyIntention] = useState('');
  const [goalStatuses, setGoalStatuses] = useState({});
  const [projectStatuses, setProjectStatuses] = useState({});
  const [taskActions, setTaskActions] = useState({});
  const [financeChecked, setFinanceChecked] = useState(false);

  const weekKey = getWeekKey();

  useEffect(() => {
    setAiSummaryLoading(true);
    const todayStr = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const lastWeekStart = sevenDaysAgo.toISOString().split('T')[0];

    const completedThisWeek = tasks.filter(t => {
      if (!t.done || !t.completedAt) return false;
      const d = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
      return d.toISOString().split('T')[0] >= lastWeekStart;
    });
    const missed = tasks.filter(t => !t.done && t.dueDate && t.dueDate >= lastWeekStart && t.dueDate < todayStr);
    const pushed = tasks.filter(t => !t.done && (t.pushCount || 0) >= 1);
    const byContext = {};
    completedThisWeek.forEach(t => { const c = t.context || 'untagged'; byContext[c] = (byContext[c] || 0) + 1; });
    const completedGoalIds = new Set(completedThisWeek.filter(t => t.goalId).map(t => t.goalId));
    const activeGoalTitles = (goals || []).filter(g => completedGoalIds.has(g.id)).map(g => g.title);
    const stalledProjects = (projects || []).filter(p => p.status === 'stalled').map(p => p.title || p.name);

    generateWeeklySummary({
      weekMetrics: { completed: completedThisWeek.length, missed: missed.length, pushed: pushed.length, byContext, activeGoalTitles, stalledProjects },
      goals,
    }).then(result => {
      if (result) setAiSummary(result);
    }).catch(() => {}).finally(() => setAiSummaryLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeGoals = useMemo(() => goals.filter(g => g.status === 'active'), [goals]);

  const activeProjects = useMemo(() =>
    projects.filter(p => p.status === 'active' || p.status === 'stalled'),
    [projects]
  );

  const triageTasks = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const today = new Date().toISOString().split('T')[0];
    const seen = new Set();
    const result = [];
    tasks.forEach(t => {
      if (t.done || t.status === 'dropped' || seen.has(t.id)) return;
      const isOverdue = t.dueDate && t.dueDate < today;
      const updMs = t.updatedAt?.toMillis?.() || (t.updatedAt ? new Date(t.updatedAt).getTime() : 0);
      const isStaleInbox = (!t.projectId || t.project === 'Inbox') && updMs > 0 && updMs < sevenDaysAgo;
      if (isOverdue || isStaleInbox) { seen.add(t.id); result.push(t); }
    });
    return result.slice(0, 15);
  }, [tasks]);

  const nextWeekTasks = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in7 = new Date(today);
    in7.setDate(in7.getDate() + 7);
    const todayStr = today.toISOString().split('T')[0];
    const in7Str = in7.toISOString().split('T')[0];
    return tasks.filter(t => {
      if (t.done) return false;
      const sched = t.scheduledDate;
      const due = t.dueDate;
      return (sched && sched >= todayStr && sched <= in7Str) ||
             (due && due >= todayStr && due <= in7Str);
    }).sort((a, b) =>
      (a.scheduledDate || a.dueDate || '').localeCompare(b.scheduledDate || b.dueDate || '')
    );
  }, [tasks]);

  const canProceed = () => {
    if (step === 0) return weeklyIntention.trim().length > 0;
    return true;
  };

  const handleNext = () => { if (canProceed() && step < 6) setStep(s => s + 1); };
  const handleBack = () => { if (step > 0) setStep(s => s - 1); else navigate('/'); };

  const handleFinish = async () => {
    setSaving(true);
    try {
      for (const [goalId, status] of Object.entries(goalStatuses)) {
        if (status === 'off-track') await updateGoal(user.uid, goalId, { weeklyStatus: 'off-track' });
        else if (status === 'on-track') await updateGoal(user.uid, goalId, { weeklyStatus: 'on-track' });
      }

      for (const [projectId, status] of Object.entries(projectStatuses)) {
        if (status === 'pause') await updateProject(user.uid, projectId, { status: 'paused' });
      }

      const nextMon = new Date();
      nextMon.setDate(nextMon.getDate() + ((8 - nextMon.getDay()) % 7 || 7));
      const nextMonStr = nextMon.toISOString().split('T')[0];

      for (const [taskId, action] of Object.entries(taskActions)) {
        if (action === 'drop') {
          await updateTask(user.uid, taskId, { status: 'dropped', done: true, completedAt: new Date().toISOString() });
        } else if (action === 'next-week') {
          await updateTask(user.uid, taskId, { scheduledDate: nextMonStr });
        }
      }

      await saveWeeklyReset(user.uid, weekKey, {
        weekKey,
        completedAt: new Date().toISOString(),
        energy,
        weeklyIntention,
        goalReviews: goalStatuses,
        projectReviews: projectStatuses,
        tasksTriaged: Object.values(taskActions).filter(a => a !== 'keep').length,
        financeChecked,
      });

      navigate('/');
    } catch (err) {
      if (isDev) console.error('Weekly reset save error:', err);
    } finally {
      setSaving(false);
    }
  };

  // ── Step 0: Check-in ──────────────────────────────────────────────────────
  const renderCheckIn = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* AI Week-in-Review */}
      {aiSummaryLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px' }}>
          <Spinner size={13} />
          <span style={{ fontSize: '12px', color: tokens.textMuted }}>Analyzing your week...</span>
        </div>
      )}
      {aiSummary && (
        <div style={{ padding: '14px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px' }}>✦ Your Week in Review</div>
          {aiSummary.narrative && (
            <div style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.55, marginBottom: '10px' }}>{aiSummary.narrative}</div>
          )}
          {aiSummary.wins?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: aiSummary.stalled?.length > 0 ? '8px' : 0 }}>
              {aiSummary.wins.map((w, i) => (
                <div key={i} style={{ fontSize: '12px', color: tokens.green }}>✓ {w}</div>
              ))}
            </div>
          )}
          {aiSummary.stalled?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {aiSummary.stalled.map((s, i) => (
                <div key={i} style={{ fontSize: '12px', color: tokens.amber }}>⚠ {s}</div>
              ))}
            </div>
          )}
          {aiSummary.goalAlignment && (
            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: `1px solid ${tokens.border}`, fontSize: '12px', color: tokens.textMuted, fontStyle: 'italic' }}>
              {aiSummary.goalAlignment}
            </div>
          )}
        </div>
      )}

      <div>
        <SectionLabel>Energy going into this week</SectionLabel>
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          {ENERGY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setEnergy(opt.value)}
              style={{
                flex: 1, padding: '12px 6px', borderRadius: '10px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                border: `1px solid ${energy === opt.value ? tokens.accent : tokens.border}`,
                background: energy === opt.value ? tokens.accentDim : tokens.bgCard,
                transition: 'all 0.15s',
                fontFamily: fonts.body,
              }}
            >
              <span style={{ fontSize: '20px' }}>{opt.emoji}</span>
              <span style={{ fontSize: '9px', color: energy === opt.value ? tokens.accent : tokens.textMuted }}>
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>What would make this week a success?</SectionLabel>
        <textarea
          value={weeklyIntention}
          onChange={e => setWeeklyIntention(e.target.value)}
          placeholder="One clear outcome that would make this week a win..."
          style={{
            width: '100%', minHeight: '100px', marginTop: '10px', boxSizing: 'border-box',
            background: tokens.bgInput, border: `1px solid ${weeklyIntention ? tokens.accent : tokens.border}`,
            borderRadius: '10px', padding: '12px 14px', fontSize: '14px', color: tokens.textPrimary,
            fontFamily: fonts.body, outline: 'none', resize: 'vertical', lineHeight: 1.5,
            transition: 'border-color 0.15s',
          }}
        />
        {weeklyIntention.trim().length === 0 && (
          <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '6px' }}>Required to continue</div>
        )}
      </div>
    </div>
  );

  // ── Step 1: Goals Review ──────────────────────────────────────────────────
  const renderGoalsReview = () => {
    if (activeGoals.length === 0) {
      return <EmptyState icon="◆" title="No active goals" subtitle="Add goals to track them here." />;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '12px', color: tokens.textMuted, marginBottom: '4px' }}>
          How did last week go for each goal?
        </div>
        {activeGoals.map(goal => {
          const status = goalStatuses[goal.id];
          return (
            <Card key={goal.id} style={{ padding: '14px 16px' }}>
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: tokens.textPrimary }}>{goal.title}</div>
                {goal.targetDate && (
                  <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>Target: {goal.targetDate}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[
                  { value: 'on-track', label: '✓ On Track', color: tokens.green },
                  { value: 'off-track', label: '⚠ Off Track', color: tokens.amber },
                ].map(opt => (
                  <button key={opt.value} onClick={() => setGoalStatuses(prev => ({ ...prev, [goal.id]: opt.value }))}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                      cursor: 'pointer', fontFamily: fonts.body, transition: 'all 0.15s',
                      border: `1px solid ${status === opt.value ? opt.color : tokens.border}`,
                      background: status === opt.value ? `${opt.color}22` : tokens.bgInput,
                      color: status === opt.value ? opt.color : tokens.textSecondary,
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    );
  };

  // ── Step 2: Projects Review ───────────────────────────────────────────────
  const renderProjectsReview = () => {
    if (activeProjects.length === 0) {
      return <EmptyState icon="◈" title="No active projects" subtitle="Add projects to review them here." />;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '12px', color: tokens.textMuted, marginBottom: '4px' }}>
          Should these projects continue next week?
        </div>
        {activeProjects.map(project => {
          const status = projectStatuses[project.id];
          const taskCount = tasks.filter(t => !t.done && t.projectId === project.id).length;
          return (
            <Card key={project.id} style={{ padding: '14px 16px' }}>
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: tokens.textPrimary }}>{project.title || project.name}</div>
                <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                  {taskCount} open task{taskCount !== 1 ? 's' : ''}
                  {project.status === 'stalled' && ' · Currently stalled'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[
                  { value: 'active', label: '▶ Keep Active' },
                  { value: 'pause', label: '⏸ Put on Pause' },
                ].map(opt => (
                  <button key={opt.value} onClick={() => setProjectStatuses(prev => ({ ...prev, [project.id]: opt.value }))}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                      cursor: 'pointer', fontFamily: fonts.body, transition: 'all 0.15s',
                      border: `1px solid ${status === opt.value ? tokens.accent : tokens.border}`,
                      background: status === opt.value ? tokens.accentDim : tokens.bgInput,
                      color: status === opt.value ? tokens.accent : tokens.textSecondary,
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    );
  };

  // ── Step 3: Task Triage ───────────────────────────────────────────────────
  const renderTaskTriage = () => {
    if (triageTasks.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>✓</div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '4px' }}>Clean inbox!</div>
          <div style={{ fontSize: '13px', color: tokens.textMuted }}>No stale or overdue tasks need your attention.</div>
        </div>
      );
    }
    const today = new Date().toISOString().split('T')[0];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '12px', color: tokens.textMuted, marginBottom: '4px' }}>
          {triageTasks.length} task{triageTasks.length !== 1 ? 's' : ''} need a decision
        </div>
        {triageTasks.map(task => {
          const action = taskActions[task.id] || 'keep';
          const isOverdue = task.dueDate && task.dueDate < today;
          return (
            <Card key={task.id} style={{ padding: '12px 14px' }}>
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: tokens.textPrimary }}>{task.title}</div>
                {isOverdue && (
                  <span style={{ fontSize: '10px', color: tokens.red, fontWeight: 700 }}>Overdue · {task.dueDate}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { value: 'keep',      label: 'Keep',       activeColor: tokens.textMuted },
                  { value: 'next-week', label: 'Next Week',  activeColor: tokens.accent },
                  { value: 'drop',      label: 'Drop',       activeColor: tokens.red },
                ].map(opt => (
                  <button key={opt.value} onClick={() => setTaskActions(prev => ({ ...prev, [task.id]: opt.value }))}
                    style={{
                      flex: 1, padding: '6px 8px', borderRadius: '7px', fontSize: '11px', fontWeight: 600,
                      cursor: 'pointer', fontFamily: fonts.body, transition: 'all 0.15s',
                      border: `1px solid ${action === opt.value ? opt.activeColor : tokens.border}`,
                      background: action === opt.value ? `${opt.activeColor}18` : tokens.bgInput,
                      color: action === opt.value ? opt.activeColor : tokens.textSecondary,
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    );
  };

  // ── Step 4: Finance Check ─────────────────────────────────────────────────
  const renderFinanceCheck = () => {
    const income   = manualCashFlow?.monthlyIncome   || 0;
    const spending = manualCashFlow?.monthlySpending  || 0;
    const surplus  = manualCashFlow?.monthlySurplus   || 0;
    const totalDebt = (debtAccounts || []).reduce((s, a) => s + (a.balance || 0), 0);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {manualCashFlow ? (
          <Card>
            <SectionLabel>Monthly Cash Flow</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', textAlign: 'center' }}>
              {[
                { label: 'Income',   val: income,            color: tokens.green,  prefix: '+$' },
                { label: 'Spending', val: spending,           color: tokens.red,    prefix: '-$' },
                { label: 'Surplus',  val: Math.abs(surplus),  color: surplus >= 0 ? tokens.accent : tokens.red, prefix: surplus >= 0 ? '+$' : '-$' },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{item.label}</div>
                  <div style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: item.color }}>
                    {item.prefix}{(item.val || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <div style={{ padding: '14px', background: tokens.accentDim, borderRadius: '10px', fontSize: '13px', color: tokens.textSecondary }}>
            No cash flow data yet. Import a bank statement in Finance OS to get started.
          </div>
        )}

        {totalDebt > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'rgba(212,122,107,0.08)', borderRadius: '10px', border: '1px solid rgba(212,122,107,0.2)' }}>
            <span style={{ fontSize: '13px', color: tokens.textSecondary }}>Total Debt</span>
            <span style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: tokens.red }}>
              ${totalDebt.toLocaleString()}
            </span>
          </div>
        )}

        {savingsAnalysis?.totalMonthlySavings > 0 && (
          <div style={{ padding: '12px 14px', background: 'rgba(109,191,158,0.08)', borderRadius: '10px', border: '1px solid rgba(109,191,158,0.2)' }}>
            <div style={{ fontSize: '12px', color: tokens.textMuted, marginBottom: '2px' }}>Savings Potential Identified</div>
            <div style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: tokens.green }}>
              +${savingsAnalysis.totalMonthlySavings.toLocaleString()}/mo
            </div>
            <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
              {savingsAnalysis.recommendations?.length || 0} opportunities — see Finance OS for details
            </div>
          </div>
        )}

        <label style={{
          display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '12px 14px',
          background: tokens.bgCardHover, borderRadius: '10px',
          border: `1px solid ${financeChecked ? tokens.accent : tokens.border}`,
          transition: 'border-color 0.15s',
        }}>
          <input type="checkbox" checked={financeChecked} onChange={e => setFinanceChecked(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: tokens.accent, cursor: 'pointer', flexShrink: 0 }} />
          <span style={{ fontSize: '13px', color: tokens.textSecondary }}>I've reviewed and updated my account balances</span>
        </label>

        <Button variant="ghost" size="sm" onClick={() => navigate('/debt')}>Open Finance OS →</Button>
      </div>
    );
  };

  // ── Step 5: Week Preview ──────────────────────────────────────────────────
  const renderWeekPreview = () => {
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return d.toISOString().split('T')[0];
    });
    const todayStr = today.toISOString().split('T')[0];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ fontSize: '12px', color: tokens.textMuted, marginBottom: '6px' }}>
          Tasks scheduled or due in the next 7 days
        </div>
        {days.map(date => {
          const dayTasks = nextWeekTasks.filter(t => (t.scheduledDate || t.dueDate) === date);
          const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          const isToday = date === todayStr;
          return (
            <div key={date} style={{
              border: `1px solid ${isToday ? tokens.accent : tokens.border}`,
              borderRadius: '10px', overflow: 'hidden',
              background: isToday ? tokens.accentDim : tokens.bgCard,
            }}>
              <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: isToday ? tokens.accent : tokens.textSecondary }}>
                  {label}
                </span>
                <span style={{ fontSize: '11px', color: tokens.textMuted }}>{dayTasks.length || '—'}</span>
              </div>
              {dayTasks.length > 0 && (
                <div style={{ borderTop: `1px solid ${tokens.border}` }}>
                  {dayTasks.map(task => (
                    <div key={task.id} style={{ padding: '7px 12px', fontSize: '12px', color: tokens.textPrimary, borderBottom: `1px solid ${tokens.border}` }}>
                      {task.title}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Step 6: Wrap Up ───────────────────────────────────────────────────────
  const renderWrapUp = () => {
    const goalsReviewed  = Object.keys(goalStatuses).length;
    const tasksDropped   = Object.values(taskActions).filter(a => a === 'drop').length;
    const tasksScheduled = Object.values(taskActions).filter(a => a === 'next-week').length;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚓</div>
          <div style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color: tokens.textPrimary, marginBottom: '6px' }}>
            You're set for the week
          </div>
          <div style={{ fontSize: '13px', color: tokens.textMuted }}>Your reset is complete. Go make it happen.</div>
        </div>

        {weeklyIntention && (
          <div style={{ padding: '16px 18px', background: tokens.accentDim, borderRadius: '12px', border: `1px solid ${tokens.accent}` }}>
            <div style={{ fontSize: '10px', color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>This Week's Intention</div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: tokens.textPrimary, lineHeight: 1.4 }}>
              "{weeklyIntention}"
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            goalsReviewed > 0 && { label: 'Goals reviewed', val: goalsReviewed },
            (tasksDropped + tasksScheduled) > 0 && { label: 'Tasks triaged', val: `${tasksDropped} dropped · ${tasksScheduled} scheduled` },
            financeChecked && { label: 'Finance review', val: '✓ Done', color: tokens.green },
          ].filter(Boolean).map(({ label, val, color }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: tokens.bgCardHover, borderRadius: '8px' }}>
              <span style={{ fontSize: '13px', color: tokens.textSecondary }}>{label}</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: color || tokens.textPrimary }}>{val}</span>
            </div>
          ))}
        </div>

        {aiSummary?.nextWeekFocus?.length > 0 && (
          <div style={{ padding: '14px 16px', background: tokens.accentDim, borderRadius: '12px', border: `1px solid ${tokens.accent}40` }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px' }}>✦ AI Recommended Focus</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {aiSummary.nextWeekFocus.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: tokens.accent, background: tokens.bgCard, borderRadius: '4px', padding: '2px 7px', flexShrink: 0, marginTop: '1px' }}>{i + 1}</span>
                  <span style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.45 }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderStep = () => {
    switch (step) {
      case 0: return renderCheckIn();
      case 1: return renderGoalsReview();
      case 2: return renderProjectsReview();
      case 3: return renderTaskTriage();
      case 4: return renderFinanceCheck();
      case 5: return renderWeekPreview();
      case 6: return renderWrapUp();
      default: return null;
    }
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '4px', textTransform: 'uppercase' }}>
            Step {step + 1} of 7 · Weekly Reset
          </div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '24px', fontWeight: 700, color: tokens.textPrimary, margin: 0, letterSpacing: '-0.02em' }}>
            {STEP_TITLES[step]}
          </h1>
        </div>
        <button
          onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.textMuted, fontSize: '18px', lineHeight: 1, padding: '6px' }}
          title="Exit wizard"
        >
          ✕
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '28px' }}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} style={{
            flex: 1, height: '3px', borderRadius: '2px',
            background: i <= step ? tokens.accent : tokens.border,
            transition: 'background 0.2s',
          }} />
        ))}
      </div>

      {/* Step content */}
      <div style={{ marginBottom: '32px' }}>
        {renderStep()}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        <Button onClick={handleBack} variant="ghost">
          {step === 0 ? 'Cancel' : '← Back'}
        </Button>
        {step < 6 ? (
          <Button onClick={handleNext} disabled={!canProceed()}>
            {step === 5 ? 'Review →' : 'Next →'}
          </Button>
        ) : (
          <Button onClick={handleFinish} loading={saving}>
            Start My Week ⚓
          </Button>
        )}
      </div>
    </div>
  );
}
