// src/components/screens/GoalDetailScreen.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { updateGoal, addTask, updateTask, getAICache, saveAICache, saveProfile } from '../../lib/db';
import { generateGoalInsights, generateRollingPlan, scoreGoals } from '../../lib/ai';
import { buildHolisticContext } from '../../lib/aiContext';
import { fetchMonthlyCashFlow, fetchAccounts } from '../../lib/teller';
import { Button, Modal, MomentumBar, Spinner } from '../ui';
import TaskModal from '../TaskModal';
import { usePageContext } from '../../context/PageContext';

const GOAL_TYPE_CONFIG = {
  financial:   { label: 'Financial',   color: '#6DBF9E' },
  project:     { label: 'Project',     color: '#5B8FD4' },
  income:      { label: 'Income',      color: '#C8A96E' },
  qualitative: { label: 'Life',        color: '#9B85C9' },
};

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

function ScoreSparkline({ history, color }) {
  if (!history || history.length < 2) return null;
  const W = 160, H = 36, pad = 4;
  const scores = history.map(h => h.score);
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 100);
  const range = max - min || 1;
  const points = scores.map((s, i) => {
    const x = pad + (i / (scores.length - 1)) * (W - pad * 2);
    const y = H - pad - ((s - min) / range) * (H - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const latest = scores[scores.length - 1];
  const first  = scores[0];
  const trend  = latest - first;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
        {scores.map((s, i) => {
          const x = pad + (i / (scores.length - 1)) * (W - pad * 2);
          const y = H - pad - ((s - min) / range) * (H - pad * 2);
          return i === scores.length - 1
            ? <circle key={i} cx={x} cy={y} r="3" fill={color} />
            : null;
        })}
      </svg>
      <span style={{ fontSize: '11px', color: trend > 0 ? tokens.green : trend < 0 ? tokens.red : tokens.textMuted, fontWeight: 700 }}>
        {trend > 0 ? `+${trend}` : trend < 0 ? `${trend}` : '—'}
      </span>
      <span style={{ fontSize: '10px', color: tokens.textMuted }}>{history.length} scores</span>
    </div>
  );
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
  const { goals, tasks, weeklyReviews, projects, plaidItems, brainDumps, brainDumpDigests, notes, userProfile, manualCashFlow, debtAccounts, assetAccounts, totalDebt, totalAssets, savingsAnalysis, savingsHistory, habits, habitLogs, dailyReviews, actedOnRecommendations } = useData();
  const { setPageContext } = usePageContext();

  const goal            = goals.find(g => g.id === goalId);

  useEffect(() => {
    if (!goal) return;
    setPageContext({ type: 'goal', id: goalId, title: goal.title, data: goal });
    return () => setPageContext(null);
  }, [goalId, goal?.title]); // eslint-disable-line react-hooks/exhaustive-deps -- setPageContext is stable
  const linkedTasks     = tasks.filter(t => t.goalId === goalId);
  const completedTasks  = linkedTasks.filter(t => t.done);
  const activeTasks     = linkedTasks.filter(t => !t.done);

  const [insights,       setInsights]       = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [rescoring,      setRescoring]      = useState(false);

  const [showPlan,       setShowPlan]       = useState(false);
  const [plan,           setPlan]           = useState(null);
  const [planLoading,    setPlanLoading]    = useState(false);
  const [planApproving,  setPlanApproving]  = useState(false);
  const [approvedTasks,  setApprovedTasks]  = useState(new Set());

  // AI feedback
  const [feedbackOpen,   setFeedbackOpen]   = useState(false);
  const [feedbackText,   setFeedbackText]    = useState('');
  const [feedbackSaving, setFeedbackSaving]  = useState(false);

  // Unified task modal state
  const [taskModalOpen,    setTaskModalOpen]    = useState(false);
  const [taskModalTask,    setTaskModalTask]    = useState(null);   // null = create, object = edit
  const [taskModalDefaults, setTaskModalDefaults] = useState({});
  const [taskModalTitle,   setTaskModalTitle]   = useState('Add Task');
  const [taskSaving,       setTaskSaving]       = useState(false);

  const [addedActions,   setAddedActions]   = useState(new Set());
  const [skippedActions, setSkippedActions] = useState(new Set());
  const [wontDoModal,    setWontDoModal]    = useState({ open: false, action: '', reason: '' });
  const [bulkCreating,   setBulkCreating]   = useState(false);

  const [balanceOpen,     setBalanceOpen]     = useState(false);
  const [newBalance,      setNewBalance]      = useState('');
  const [plaidAccounts,   setPlaidAccounts]   = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [sourceForm,       setSourceForm]       = useState({ type: 'manual', rateThreshold: '10', accountIds: [] });
  const [savingSource,     setSavingSource]     = useState(false);

  const [completionNote, setCompletionNote] = useState({ open: false, task: null, text: '' });

  // All active tasks for this goal — direct link OR via a linked project
  const allActiveGoalTasks = useMemo(() => {
    const linkedProjectIds = projects.filter(p => p.goalId === goalId).map(p => p.id);
    return tasks.filter(t => !t.done && (t.goalId === goalId || linkedProjectIds.includes(t.projectId)));
  }, [tasks, projects, goalId]);

  // Tracking source — compute live value from Finance data
  const computeTrackedValueForSource = useCallback((src) => {
    if (!src || src.type === 'manual') return null;
    switch (src.type) {
      case 'debt_total':
        return Math.round(debtAccounts.reduce((s, a) => s + (a.balance || 0), 0));
      case 'debt_highinterest': {
        const t = src.rateThreshold ?? 10;
        return Math.round(debtAccounts.filter(a => (a.interestRate || 0) > t).reduce((s, a) => s + (a.balance || 0), 0));
      }
      case 'debt_accounts': {
        const ids = new Set(src.accountIds || []);
        return Math.round(debtAccounts.filter(a => ids.has(a.id)).reduce((s, a) => s + (a.balance || 0), 0));
      }
      case 'asset_total':
        return Math.round(assetAccounts.reduce((s, a) => s + (a.balance || 0), 0));
      case 'net_worth':
        return Math.round(assetAccounts.reduce((s, a) => s + (a.balance || 0), 0) - debtAccounts.reduce((s, a) => s + (a.balance || 0), 0));
      default: return null;
    }
  }, [debtAccounts, assetAccounts]);

  const trackedValue = useMemo(() =>
    computeTrackedValueForSource(goal?.trackingSource),
  [goal?.trackingSource, computeTrackedValueForSource]); // eslint-disable-line react-hooks/exhaustive-deps -- computeTrackedValueForSource already captures debtAccounts/assetAccounts; listing them here would be redundant

  const sourceLabel = useMemo(() => {
    const src = goal?.trackingSource;
    if (!src || src.type === 'manual') return 'Manual tracking';
    switch (src.type) {
      case 'debt_total':        return 'All debt';
      case 'debt_highinterest': return `High-interest debt (>${src.rateThreshold ?? 10}% APR)`;
      case 'debt_accounts':     return `${(src.accountIds || []).length} selected account(s)`;
      case 'asset_total':       return 'Total assets';
      case 'net_worth':         return 'Net worth';
      default:                  return 'Manual tracking';
    }
  }, [goal?.trackingSource]);

  // Auto-persist tracked value to Firestore so AI context stays current
  useEffect(() => {
    if (!goal || trackedValue == null) return;
    if (goal.currentAmount === trackedValue) return;
    updateGoal(user.uid, goalId, { currentAmount: trackedValue });
  }, [trackedValue]); // eslint-disable-line react-hooks/exhaustive-deps -- only trackedValue changing should trigger a Firestore write; including goal/user would re-run on every context refresh

  const openSourcePicker = () => {
    const src = goal?.trackingSource || { type: 'manual' };
    setSourceForm({ type: src.type || 'manual', rateThreshold: String(src.rateThreshold ?? 10), accountIds: src.accountIds || [] });
    setShowSourcePicker(true);
  };

  const handleSaveSource = async () => {
    setSavingSource(true);
    try {
      const source = {
        type: sourceForm.type,
        ...(sourceForm.type === 'debt_highinterest' && { rateThreshold: parseFloat(sourceForm.rateThreshold) || 10 }),
        ...(sourceForm.type === 'debt_accounts'     && { accountIds: sourceForm.accountIds }),
      };
      const updates = { trackingSource: source };
      const computed = computeTrackedValueForSource(source);
      if (computed != null) updates.currentAmount = computed;
      await updateGoal(user.uid, goalId, updates);
      setShowSourcePicker(false);
    } finally {
      setSavingSource(false);
    }
  };

  // Filter out AI-suggested actions that duplicate existing OR recently-completed tasks.
  // completedTasks are excluded from allActiveGoalTasks, so without this check a task
  // completed after the 6-hour cache was written would reappear as a suggestion.
  const recentlyCompletedGoalTasks = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const linkedProjectIds = projects.filter(p => p.goalId === goalId).map(p => p.id);
    return tasks.filter(t => {
      if (!t.done) return false;
      if (t.goalId !== goalId && !linkedProjectIds.includes(t.projectId)) return false;
      try {
        const ms = t.completedAt ? new Date(t.completedAt).getTime() : 0;
        return ms > cutoff;
      } catch { return false; }
    });
  }, [tasks, projects, goalId]);

  const dedupedActions = useMemo(() => {
    if (!insights?.thisWeekActions) return [];
    const dismissed = new Set([
      ...(goal?.dismissedActions || []).map(d => d.action),
      ...skippedActions,
    ]);
    const allCheck = [...allActiveGoalTasks, ...recentlyCompletedGoalTasks];
    return insights.thisWeekActions.filter(action => {
      if (dismissed.has(action)) return false;
      const actionLower = action.toLowerCase();
      return !allCheck.some(t => {
        const tLower = t.title.toLowerCase();
        return tLower.includes(actionLower) || actionLower.includes(tLower);
      });
    });
  }, [insights, allActiveGoalTasks, recentlyCompletedGoalTasks, goal?.dismissedActions, skippedActions]);

  // Throttle Required Actions: suppress if there are already 5+ open tasks or any task > 2h estimated
  const shouldThrottleActions = allActiveGoalTasks.length >= 5 ||
    allActiveGoalTasks.some(t => (t.estimatedMinutes || 0) > 120);

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
      const holisticContext = buildHolisticContext({
        goals,
        tasks,
        projects,
        brainDumps:              brainDumps || [],
        brainDumpDigests:        brainDumpDigests || [],
        weeklyReviews:           weeklyReviews || [],
        userProfile,
        plaidData,
        manualCashFlow,
        debtAccounts:            debtAccounts || [],
        assetAccounts:           assetAccounts || [],
        notes:                   notes || [],
        savingsAnalysis,
        savingsHistory,
        habits:                  habits || [],
        habitLogs:               habitLogs || [],
        dailyReviews:            dailyReviews || [],
        actedOnRecommendations:  actedOnRecommendations || [],
      });
      const result = await generateGoalInsights({
        goal,
        linkedTasks,
        completedTasks,
        weeklyReviews: weeklyReviews || [],
        plaidData,
        holisticContext,
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
  }, [goal, goalId, user, linkedTasks, completedTasks, weeklyReviews, brainDumps, goals, tasks, projects, userProfile]); // eslint-disable-line react-hooks/exhaustive-deps -- AI helper functions (getGoalInsights) are stable imports, not reactive values

  useEffect(() => {
    if (goal) loadInsights();
  }, [goalId]); // eslint-disable-line react-hooks/exhaustive-deps -- loadInsights is a useCallback; adding it as a dep would cause infinite re-renders as its reference changes on each insights load

  const handleRescore = async () => {
    if (rescoring) return;
    setRescoring(true);
    try {
      const scorePlaidData = await fetchMonthlyCashFlow(plaidItems).catch(() => null);
      const scores = await scoreGoals({
        goals: [goal],
        tasks,
        brainDumps:     brainDumps || [],
        reviewHistory:  weeklyReviews || [],
        plaidData:      scorePlaidData,
        manualCashFlow: manualCashFlow || null,
      });
      const s = (scores || []).find(s => s.goalId === goalId);
      if (s) {
        const today = new Date().toISOString().split('T')[0];
        const existing = Array.isArray(goal.scoreHistory) ? goal.scoreHistory : [];
        const scoreHistory = [...existing.filter(e => e.date !== today), { date: today, score: s.score }]
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-90);
        await updateGoal(user.uid, goalId, { likelihoodScore: s.score, likelihoodTrend: s.trend, scoreHistory });
      }
    } catch (err) {
      console.error('Rescore error:', err);
    } finally {
      setRescoring(false);
    }
  };

  const handleGeneratePlan = async () => {
    setPlanLoading(true);
    setShowPlan(true);
    setPlan(null);
    try {
      const result = await generateRollingPlan({
        goal,
        existingTasks: linkedTasks,
        completedTasks,
      });
      if (result?.tasks?.length > 0) {
        setPlan(result);
        setApprovedTasks(new Set(result.tasks.map((_, i) => i)));
      }
    } catch (err) {
      console.error('Rolling plan generation error:', err);
    } finally {
      setPlanLoading(false);
    }
  };

  const handleApprovePlan = async () => {
    if (!plan || planApproving) return;
    setPlanApproving(true);
    try {
      const batchId = `${goalId}_${Date.now()}`;
      const toCreate = plan.tasks.filter((_, i) => approvedTasks.has(i));
      await Promise.all(toCreate.map(t =>
        addTask(user.uid, {
          title:            t.title,
          priority:         t.priority || 'high',
          estimatedMinutes: t.estimatedMinutes || null,
          notes:            t.notes || '',
          project:          t.project || goal.title || 'Inbox',
          goalId,
          sprintBatch:      batchId,
          status:           'pending',
        })
      ));
      await updateGoal(user.uid, goalId, {
        lastSprintBatch: batchId,
        lastSprintAt:    new Date().toISOString(),
      });
      setShowPlan(false);
      setPlan(null);
    } catch (err) {
      console.error('Task creation error:', err);
    } finally {
      setPlanApproving(false);
    }
  };

  const openAddTask = () => {
    setTaskModalTask(null);
    setTaskModalDefaults({ goalId });
    setTaskModalTitle('Add Task to Goal');
    setTaskModalOpen(true);
  };

  const handleTaskModalSave = async (formData) => {
    setTaskSaving(true);
    try {
      if (taskModalTask) {
        await updateTask(user.uid, taskModalTask.id, {
          title:            formData.title,
          priority:         formData.priority,
          focusType:        formData.focusType || null,
          context:          formData.context || null,
          projectId:        formData.projectId || null,
          goalId:           formData.goalId || goalId,
          estimatedMinutes: formData.estimatedMinutes ? Number(formData.estimatedMinutes) : null,
          startDate:        formData.startDate || null,
          dueDate:          formData.dueDate || null,
          notes:            formData.notes || '',
          tags:             formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : null,
          recurrence:       formData.recurrence !== 'none' ? formData.recurrence : null,
          blockedBy:        formData.blockedBy || [],
        });
      } else {
        await addTask(user.uid, {
          title:            formData.title,
          priority:         formData.priority,
          focusType:        formData.focusType || null,
          context:          formData.context || null,
          projectId:        formData.projectId || null,
          goalId:           formData.goalId || goalId,
          estimatedMinutes: formData.estimatedMinutes ? Number(formData.estimatedMinutes) : null,
          startDate:        formData.startDate || null,
          dueDate:          formData.dueDate || null,
          notes:            formData.notes || '',
          tags:             formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : null,
          recurrence:       formData.recurrence !== 'none' ? formData.recurrence : null,
          blockedBy:        formData.blockedBy || [],
          source:           formData._source || null,
          status:           'pending',
        });
        if (formData._source === 'goal-action') {
          setAddedActions(prev => new Set([...prev, formData.title]));
        }
      }
      setTaskModalOpen(false);
      setTaskModalTask(null);
    } finally {
      setTaskSaving(false);
    }
  };

  const handleToggleTask = async (task) => {
    const nowDone = !task.done;
    await updateTask(user.uid, task.id, {
      done:        nowDone,
      status:      nowDone ? 'completed' : 'pending',
      completedAt: nowDone ? new Date().toISOString() : null,
      ...(nowDone ? {} : { completionNote: null }),
    });
    if (nowDone) setCompletionNote({ open: true, task, text: '' });
  };

  const handleSaveCompletionNote = async () => {
    if (!completionNote.task) return;
    if (completionNote.text.trim()) {
      await updateTask(user.uid, completionNote.task.id, { completionNote: completionNote.text.trim() });
    }
    setCompletionNote({ open: false, task: null, text: '' });
  };

  const openEditTask = (task) => {
    setTaskModalTask(task);
    setTaskModalDefaults({});
    setTaskModalTitle('Edit Task');
    setTaskModalOpen(true);
  };

  const handleTaskAutoSave = async (formData) => {
    if (!taskModalTask) return;
    await updateTask(user.uid, taskModalTask.id, formData);
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim()) return;
    setFeedbackSaving(true);
    try {
      const existing    = userProfile?.aiFeedback || {};
      const newFeedback = { ...existing, [`goalInsight_${goalId}`]: feedbackText.trim() };
      await saveProfile(user.uid, { aiFeedback: newFeedback });
      setFeedbackOpen(false);
      setFeedbackText('');
      await loadInsights(true);
    } catch (err) {
      console.error('Feedback save error:', err);
    } finally {
      setFeedbackSaving(false);
    }
  };

  const openActionModal = (action) => {
    setTaskModalTask(null);
    setTaskModalDefaults({ goalId, title: action, _source: 'goal-action' });
    setTaskModalTitle('Create Task from Action');
    setTaskModalOpen(true);
  };

  const handleBulkCreate = async () => {
    if (!dedupedActions.length || bulkCreating) return;
    setBulkCreating(true);
    try {
      const remaining = dedupedActions.filter(a => !addedActions.has(a));
      await Promise.all(remaining.map(action =>
        addTask(user.uid, {
          title:   action,
          priority: 'high',
          project: goal.title || 'Inbox',
          goalId,
          source:  'goal-action',
          status:  'pending',
        })
      ));
      setAddedActions(new Set(dedupedActions));
    } finally {
      setBulkCreating(false);
    }
  };

  const handleWontDo = async () => {
    const { action, reason } = wontDoModal;
    if (!action) return;
    const existing = goal.dismissedActions || [];
    const newDismissed = [...existing, { action, reason: reason.trim(), date: new Date().toISOString().slice(0, 10) }];
    setSkippedActions(prev => new Set([...prev, action]));
    setWontDoModal({ open: false, action: '', reason: '' });
    await updateGoal(user.uid, goalId, { dismissedActions: newDismissed });
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
  }, [balanceOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- fetch should only trigger when the dialog opens, not on every plaidItems change

  // Auto-sync balance from Plaid on load if account is linked
  useEffect(() => {
    if (!goal || goal.goalType !== 'financial' || !goal.tellerAccountId || !plaidItems?.length) return;
    const autoSync = async () => {
      try {
        const all = await Promise.all(plaidItems.map(item => fetchAccounts(item.accessToken)));
        const accounts = all.flat();
        const acct = accounts.find(a => a.accountId === goal.tellerAccountId);
        if (acct?.balances?.current != null) {
          await updateGoal(user.uid, goalId, { currentAmount: acct.balances.current });
        }
      } catch {}
    };
    autoSync();
  }, [goalId]); // eslint-disable-line react-hooks/exhaustive-deps -- sync runs once per goal load; including plaidItems would re-run the sync on every transaction refresh

  const handleUpdateBalance = async () => {
    const amount = parseFloat(newBalance);
    if (isNaN(amount)) return;
    await updateGoal(user.uid, goalId, { currentAmount: amount });
    setBalanceOpen(false);
    setNewBalance('');
  };

  const handleSyncFromPlaid = async (account) => {
    setNewBalance(String(account.balances.current));
    await updateGoal(user.uid, goalId, { tellerAccountId: account.accountId });
  };

  if (!goal) {
    return (
      <div style={{ maxWidth: 720, margin: '60px auto', textAlign: 'center', padding: '0 20px' }}>
        <div style={{ fontSize: '13px', color: tokens.textMuted, marginBottom: '16px' }}>Goal not found.</div>
        <Button onClick={() => navigate('/goals')} variant="ghost">← Back to Goals</Button>
      </div>
    );
  }

  const typeConfig    = GOAL_TYPE_CONFIG[goal.goalType] || GOAL_TYPE_CONFIG.project;
  const months        = monthsFrom(goal.targetDate);
  const taskProgress  = linkedTasks.length > 0
    ? Math.round((completedTasks.length / linkedTasks.length) * 100) : 0;
  const displayAmount = trackedValue ?? goal.currentAmount;
  const hasMoney      = goal.targetAmount != null && displayAmount != null;
  const moneyProgress = hasMoney
    ? Math.min(100, Math.round((displayAmount / goal.targetAmount) * 100)) : 0;
  const isAutoTracked = goal.trackingSource?.type && goal.trackingSource.type !== 'manual';
  const netWorth      = totalAssets - totalDebt;
  const netWorthFmt   = `${netWorth >= 0 ? '+' : ''}$${Math.abs(Math.round(netWorth)).toLocaleString()}`;
  const score        = goal.likelihoodScore;
  const scoreColor   = score >= 70 ? tokens.green : score >= 40 ? tokens.amber : score != null ? tokens.red : tokens.textMuted;

  // ── Live Pace ──────────────────────────────────────────────────────────────
  const paceInfo = (() => {
    if (!goal.targetDate || months == null || months <= 0) return null;
    if ((goal.goalType === 'financial' || goal.goalType === 'income') && goal.targetAmount != null && displayAmount != null) {
      const remaining = goal.targetAmount - displayAmount;
      if (remaining <= 0) return { type: 'done' };
      const perMonth = Math.ceil(remaining / months);
      return { type: 'financial', perMonth, remaining, months };
    }
    if (goal.goalType === 'project' || goal.goalType === 'qualitative') {
      const weeksLeft = Math.round(months * 4.33);
      if (weeksLeft <= 0) return null;
      const pendingCount = activeTasks.length;
      const requiredPerWeek = pendingCount > 0 ? parseFloat((pendingCount / weeksLeft).toFixed(1)) : null;
      return { type: 'tasks', pendingCount, weeksLeft, requiredPerWeek, backlogSparse: pendingCount < 5 };
    }
    return null;
  })();

  // ── Sprint State ────────────────────────────────────────────────────────────
  const sprintState = (() => {
    if (!goal.lastSprintBatch) return null;
    const sprintTasks = linkedTasks.filter(t => t.sprintBatch === goal.lastSprintBatch);
    if (sprintTasks.length === 0) return null;
    const doneCount = sprintTasks.filter(t => t.done).length;
    const pct = Math.round((doneCount / sprintTasks.length) * 100);
    return { total: sprintTasks.length, done: doneCount, pct, ready: pct >= 80 };
  })();

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <SectionLabel style={{ marginBottom: 0 }}>Trajectory</SectionLabel>
          <button
            onClick={handleRescore}
            disabled={rescoring}
            title="Rescore this goal"
            style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '3px 10px', fontSize: '11px', color: rescoring ? tokens.textMuted : tokens.textSecondary, cursor: rescoring ? 'default' : 'pointer', fontFamily: fonts.body, display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.15s' }}
            onMouseEnter={e => { if (!rescoring) { e.currentTarget.style.borderColor = tokens.accent; e.currentTarget.style.color = tokens.accent; } }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = rescoring ? tokens.textMuted : tokens.textSecondary; }}
          >
            <span style={{ display: 'inline-block', animation: rescoring ? 'spin 1s linear infinite' : 'none' }}>↻</span>
            {rescoring ? 'Scoring…' : 'Rescore'}
          </button>
        </div>

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
            {goal.scoreHistory?.length >= 2 && (
              <div style={{ marginTop: '8px' }}>
                <ScoreSparkline history={goal.scoreHistory} color={scoreColor} />
              </div>
            )}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: hasMoney ? '12px' : '0' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted }}>Current Balance</div>
                  {isAutoTracked && (
                    <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(109,191,158,0.15)', color: tokens.green, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Auto-tracked
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: tokens.accent }}>
                  {displayAmount != null ? `$${displayAmount.toLocaleString()}` : '—'}
                </div>
                {goal.targetAmount != null && (
                  <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                    of ${goal.targetAmount.toLocaleString()} target
                  </div>
                )}
                <button
                  onClick={openSourcePicker}
                  style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.textMuted, cursor: 'pointer', padding: '3px 0 0', fontFamily: fonts.body, display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <span style={{ opacity: 0.7 }}>⚙</span>
                  <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>{sourceLabel}</span>
                </button>
              </div>
              {!isAutoTracked && (
                <Button size="sm" variant="ghost" onClick={() => { setNewBalance(goal.currentAmount != null ? String(goal.currentAmount) : ''); setBalanceOpen(true); }}>
                  Update
                </Button>
              )}
            </div>
            {hasMoney && (
              <>
                <MomentumBar value={moneyProgress} color={tokens.accent} height={5} />
                <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '4px' }}>{moneyProgress}% of target</div>
              </>
            )}
          </div>
        )}

        {/* Live Pace Widget */}
        {paceInfo && (
          <div style={{ marginBottom: '16px', padding: '12px 14px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted, marginBottom: '6px' }}>Live Pace</div>
            {paceInfo.type === 'done' && (
              <div style={{ fontSize: '14px', fontWeight: 700, color: tokens.green }}>Target reached!</div>
            )}
            {paceInfo.type === 'financial' && (
              <>
                <div style={{ fontSize: '18px', fontWeight: 700, color: tokens.accent }}>${paceInfo.perMonth.toLocaleString()}<span style={{ fontSize: '13px', fontWeight: 500, color: tokens.textMuted }}>/month needed</span></div>
                <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                  ${paceInfo.remaining.toLocaleString()} remaining · {paceInfo.months} month{paceInfo.months !== 1 ? 's' : ''} left
                </div>
              </>
            )}
            {paceInfo.type === 'tasks' && (
              <>
                {paceInfo.requiredPerWeek != null ? (
                  <div style={{ fontSize: '16px', fontWeight: 700, color: tokens.textPrimary }}>
                    ~{paceInfo.requiredPerWeek} task{paceInfo.requiredPerWeek !== 1 ? 's' : ''}<span style={{ fontSize: '13px', fontWeight: 500, color: tokens.textMuted }}>/week needed</span>
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: tokens.textMuted }}>No open tasks — generate a sprint to get started</div>
                )}
                <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                  {paceInfo.pendingCount} task{paceInfo.pendingCount !== 1 ? 's' : ''} open · {paceInfo.weeksLeft} weeks left
                </div>
                {paceInfo.backlogSparse && (
                  <div style={{ fontSize: '11px', color: tokens.amber, marginTop: '5px' }}>
                    ⚑ Backlog may be incomplete — pace improves as more tasks are added via Rolling Plan
                  </div>
                )}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>This Week</SectionLabel>
            {insights && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button title="Accurate" style={{ background: 'transparent', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '3px 9px', fontSize: '12px', cursor: 'pointer', color: tokens.textMuted, fontFamily: fonts.body }}>👍</button>
                <button title="Give feedback" onClick={() => setFeedbackOpen(true)} style={{ background: 'transparent', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '3px 9px', fontSize: '12px', cursor: 'pointer', color: tokens.textMuted, fontFamily: fonts.body }}>👎</button>
              </div>
            )}
          </div>

          {insightsLoading && !insights && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: tokens.textMuted, fontSize: '13px' }}>
              <Spinner size={14} /> Analyzing trajectory…
            </div>
          )}

          {insights && (
            <>
              {dedupedActions.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '10px' }}>Required Actions</div>
                  {shouldThrottleActions ? (
                    <div style={{ fontSize: '12px', color: tokens.textMuted, padding: '8px 12px', background: tokens.bgCardHover, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                      {allActiveGoalTasks.length} open tasks — clear some before adding more.
                    </div>
                  ) : (
                    <>
                      {dedupedActions.filter(a => !addedActions.has(a)).length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                          <Button size="sm" variant="ghost" onClick={handleBulkCreate} loading={bulkCreating}>
                            + Create All ({dedupedActions.filter(a => !addedActions.has(a)).length})
                          </Button>
                        </div>
                      )}
                      {dedupedActions.map((action, i) => {
                        const added = addedActions.has(action);
                        return (
                          <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: i < dedupedActions.length - 1 ? `1px solid ${tokens.border}` : 'none', alignItems: 'center' }}>
                            <span style={{ color: added ? tokens.green : tokens.accent, fontWeight: 700, fontSize: '12px', flexShrink: 0, minWidth: '16px' }}>
                              {added ? '✓' : `${i + 1}.`}
                            </span>
                            <span style={{ fontSize: '13px', color: added ? tokens.textMuted : tokens.textSecondary, lineHeight: 1.5, flex: 1, textDecoration: added ? 'line-through' : 'none' }}>{action}</span>
                            {!added && (
                              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                <button
                                  onClick={() => openActionModal(action)}
                                  style={{ background: tokens.accentDim, border: `1px solid rgba(200,169,110,0.2)`, borderRadius: '5px', padding: '3px 10px', fontSize: '11px', fontWeight: 600, color: tokens.accent, cursor: 'pointer', fontFamily: fonts.body }}>
                                  + Task
                                </button>
                                <button
                                  onClick={() => setWontDoModal({ open: true, action, reason: '' })}
                                  style={{ background: 'transparent', border: `1px solid ${tokens.border}`, borderRadius: '5px', padding: '3px 8px', fontSize: '11px', fontWeight: 500, color: tokens.textMuted, cursor: 'pointer', fontFamily: fonts.body }}>
                                  Won't Do
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
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
          <Button size="sm" variant="ghost" onClick={openAddTask}>+ Add Task</Button>
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
            <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => openEditTask(task)}>
              <div style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.4 }}>{task.title}</div>
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ textTransform: 'capitalize' }}>{task.priority}</span>
                {task.estimatedMinutes && <span>⏱ {task.estimatedMinutes}m</span>}
                {task.dueDate && <span>📅 {task.dueDate}</span>}
                {task.scheduledDate && !task.dueDate && <span>📅 {task.scheduledDate}</span>}
                {task.notes && <span style={{ color: tokens.textMuted, fontStyle: 'italic' }}>has notes</span>}
                <span style={{ color: tokens.accent, opacity: 0.6 }}>Edit →</span>
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

      {/* ── Rolling Plan Card ── */}
      <Card>
        <SectionLabel>Rolling Plan</SectionLabel>
        {sprintState?.ready && (
          <div style={{ marginBottom: '14px', padding: '10px 14px', background: 'rgba(109,191,158,0.1)', borderRadius: '8px', border: '1px solid rgba(109,191,158,0.3)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: tokens.green, marginBottom: '3px' }}>Sprint {sprintState.pct}% complete</div>
            <div style={{ fontSize: '12px', color: tokens.textSecondary }}>
              {sprintState.done}/{sprintState.total} tasks done — ready for your next batch.
            </div>
          </div>
        )}
        {sprintState && !sprintState.ready && (
          <div style={{ marginBottom: '14px', fontSize: '12px', color: tokens.textMuted }}>
            Sprint in progress · {sprintState.done}/{sprintState.total} done ({sprintState.pct}%)
          </div>
        )}
        <div style={{ fontSize: '13px', color: tokens.textSecondary, marginBottom: '16px', lineHeight: 1.6 }}>
          {!sprintState
            ? 'Generate your first sprint — 3–5 focused tasks for the next 1–2 weeks.'
            : sprintState.ready
              ? 'Current sprint is nearly done. Generate the next batch to keep momentum.'
              : 'AI generates 3–5 tasks at a time, building on what you\'ve already completed.'}
        </div>
        <Button onClick={handleGeneratePlan} variant="accent">
          ✦ {!sprintState ? 'Start First Sprint' : sprintState.ready ? 'Generate Next Sprint' : 'Generate New Sprint'}
        </Button>
      </Card>

      {/* ── Rolling Plan Modal ── */}
      <Modal open={showPlan} onClose={() => { setShowPlan(false); setPlan(null); }} title="Rolling Plan — Next Sprint" width={580}>
        {planLoading && (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <Spinner size={22} />
            <div style={{ fontSize: '13px', color: tokens.textMuted, marginTop: '14px' }}>Building your next sprint…</div>
          </div>
        )}

        {!planLoading && !plan && (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: '13px', color: tokens.textMuted }}>
            Could not generate sprint. Try again.
          </div>
        )}

        {!planLoading && plan && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Phase + Summary */}
            <div style={{ padding: '12px 14px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
              {plan.phase && (
                <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.accent, marginBottom: '5px' }}>{plan.phase}</div>
              )}
              <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.65 }}>{plan.summary}</div>
              {plan.rationale && (
                <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '6px', fontStyle: 'italic' }}>{plan.rationale}</div>
              )}
            </div>

            {/* Tasks approval */}
            {plan.tasks?.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted }}>
                    Sprint Tasks
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
                        {task.priority} · {task.estimatedMinutes}m{task.notes ? ` · ${task.notes}` : ''}
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
                Sync from Teller
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
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', borderRadius: '7px', border: `1px solid ${goal.tellerAccountId === acct.accountId ? tokens.accent : tokens.border}`, background: goal.tellerAccountId === acct.accountId ? tokens.accentDim : 'transparent', cursor: 'pointer', marginBottom: '4px', transition: 'all 0.12s' }}
                  onMouseEnter={e => { if (goal.tellerAccountId !== acct.accountId) e.currentTarget.style.background = tokens.bgCardHover; }}
                  onMouseLeave={e => { if (goal.tellerAccountId !== acct.accountId) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div>
                    <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500 }}>{acct.name}</div>
                    <div style={{ fontSize: '11px', color: tokens.textMuted, textTransform: 'capitalize' }}>{acct.type} · {acct.subtype}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: tokens.accent }}>${acct.balances.current?.toLocaleString()}</div>
                    {goal.tellerAccountId === acct.accountId && <div style={{ fontSize: '10px', color: tokens.green }}>linked</div>}
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

      {/* Unified Task Modal (add / action→task / edit) */}
      <TaskModal
        open={taskModalOpen}
        onClose={() => { setTaskModalOpen(false); setTaskModalTask(null); }}
        onSave={handleTaskModalSave}
        onAutoSave={handleTaskAutoSave}
        task={taskModalTask}
        defaultValues={taskModalDefaults}
        modalTitle={taskModalTitle}
        saving={taskSaving}
        extraActions={taskModalTask ? (
          <Button variant="ghost" size="sm" onClick={async () => { await handleToggleTask(taskModalTask); setTaskModalOpen(false); setTaskModalTask(null); }}>
            ✓ Mark Complete
          </Button>
        ) : null}
      />

      {/* Won't Do Modal */}
      <Modal open={wontDoModal.open} onClose={() => setWontDoModal({ open: false, action: '', reason: '' })} title="Won't Do">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.5, padding: '10px 12px', background: tokens.bgGlass, borderRadius: '7px', border: `1px solid ${tokens.border}` }}>
            "{wontDoModal.action}"
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Why not? <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <textarea
              value={wontDoModal.reason}
              onChange={e => setWontDoModal(m => ({ ...m, reason: e.target.value }))}
              placeholder="e.g. Not relevant right now, already handled another way..."
              autoFocus
              rows={2}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleWontDo(); }}
            />
          </div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, lineHeight: 1.5 }}>
            This action will be removed from your list and the AI won't resurface it.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => setWontDoModal({ open: false, action: '', reason: '' })}>Cancel</Button>
            <Button onClick={handleWontDo}>Dismiss Action</Button>
          </div>
        </div>
      </Modal>

      {/* Completion Note Modal */}
      <Modal open={completionNote.open} onClose={handleSaveCompletionNote} title="Task Done ✓">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>{completionNote.task?.title}</div>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.5 }}>
            What did you find, learn, or decide? <span style={{ color: tokens.textMuted }}>(optional — feeds your AI advisor)</span>
          </div>
          <textarea
            value={completionNote.text}
            onChange={e => setCompletionNote(n => ({ ...n, text: e.target.value }))}
            placeholder="e.g. CPA confirmed filing, found discrepancy in section 4.2, rate was lower than expected..."
            autoFocus
            rows={3}
            style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveCompletionNote(); }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => setCompletionNote({ open: false, task: null, text: '' })}>Skip</Button>
            <Button onClick={handleSaveCompletionNote}>Save Note</Button>
          </div>
        </div>
      </Modal>

      {/* AI Feedback Modal */}
      <Modal open={feedbackOpen} onClose={() => { setFeedbackOpen(false); setFeedbackText(''); }} title="Give AI Feedback">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>
            What's wrong with this analysis? Be specific — this correction will be saved and the analysis will regenerate.
          </div>
          <textarea
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            placeholder="e.g. I can't file the 1040s until all 1120s are done, so that can't be the required action..."
            autoFocus
            rows={4}
            style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => { setFeedbackOpen(false); setFeedbackText(''); }}>Cancel</Button>
            <Button onClick={handleFeedbackSubmit} loading={feedbackSaving} disabled={!feedbackText.trim()}>Save & Regenerate</Button>
          </div>
        </div>
      </Modal>

      {/* Tracking Source Picker Modal */}
      <Modal open={showSourcePicker} onClose={() => setShowSourcePicker(false)} title="Tracking Source" width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>
            Connect this goal's balance to live Finance data, or track it manually.
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '8px' }}>Source</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {[
                { value: 'manual',           label: 'Manual',              desc: 'Update the balance yourself' },
                { value: 'debt_total',        label: 'All Debt',            desc: `Sum of all debt accounts · $${totalDebt.toLocaleString()}` },
                { value: 'debt_highinterest', label: 'High-Interest Debt',  desc: 'Debt accounts above an APR threshold' },
                { value: 'debt_accounts',     label: 'Specific Accounts',   desc: 'Choose which debt accounts to sum' },
                { value: 'asset_total',       label: 'Total Assets',        desc: `Sum of all asset accounts · $${totalAssets.toLocaleString()}` },
                { value: 'net_worth',         label: 'Net Worth',           desc: `Assets minus debts · ${netWorthFmt}` },
              ].map(opt => (
                <div
                  key={opt.value}
                  onClick={() => setSourceForm(f => ({ ...f, type: opt.value }))}
                  style={{ display: 'flex', gap: '10px', padding: '9px 12px', borderRadius: '8px', border: `1px solid ${sourceForm.type === opt.value ? tokens.accent : tokens.border}`, background: sourceForm.type === opt.value ? tokens.accentDim : 'transparent', cursor: 'pointer', transition: 'all 0.12s', alignItems: 'center' }}
                >
                  <div style={{ width: 14, height: 14, borderRadius: '50%', border: `1.5px solid ${sourceForm.type === opt.value ? tokens.accent : tokens.border}`, background: sourceForm.type === opt.value ? tokens.accent : 'transparent', flexShrink: 0, marginTop: '1px' }} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>{opt.label}</div>
                    <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '1px' }}>{opt.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {sourceForm.type === 'debt_highinterest' && (
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>APR Threshold (%)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={sourceForm.rateThreshold}
                  onChange={e => setSourceForm(f => ({ ...f, rateThreshold: e.target.value }))}
                  style={{ width: '90px', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}
                  onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                  onBlur={e => e.target.style.borderColor = tokens.border}
                />
                <span style={{ fontSize: '12px', color: tokens.textMuted }}>
                  {(() => {
                    const t = parseFloat(sourceForm.rateThreshold) || 10;
                    const matches = debtAccounts.filter(a => (a.interestRate || 0) > t);
                    const total = Math.round(matches.reduce((s, a) => s + (a.balance || 0), 0));
                    return `${matches.length} account${matches.length !== 1 ? 's' : ''} qualify · $${total.toLocaleString()} total`;
                  })()}
                </span>
              </div>
            </div>
          )}

          {sourceForm.type === 'debt_accounts' && (
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>
                Select Accounts
                {sourceForm.accountIds.length > 0 && (
                  <span style={{ fontWeight: 400, marginLeft: '6px', textTransform: 'none', letterSpacing: 0 }}>
                    · ${Math.round(debtAccounts.filter(a => sourceForm.accountIds.includes(a.id)).reduce((s, a) => s + (a.balance || 0), 0)).toLocaleString()} selected
                  </span>
                )}
              </label>
              {debtAccounts.length === 0 ? (
                <div style={{ fontSize: '12px', color: tokens.textMuted }}>No debt accounts on file. Import them from Finance.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
                  {debtAccounts.map(acct => {
                    const sel = sourceForm.accountIds.includes(acct.id);
                    return (
                      <div
                        key={acct.id}
                        onClick={() => setSourceForm(f => ({ ...f, accountIds: sel ? f.accountIds.filter(id => id !== acct.id) : [...f.accountIds, acct.id] }))}
                        style={{ display: 'flex', gap: '10px', padding: '8px 10px', borderRadius: '7px', border: `1px solid ${sel ? tokens.accent : tokens.border}`, background: sel ? tokens.accentDim : 'transparent', cursor: 'pointer', transition: 'all 0.12s', alignItems: 'center' }}
                      >
                        <div style={{ width: 14, height: 14, borderRadius: '3px', border: `1.5px solid ${sel ? tokens.accent : tokens.border}`, background: sel ? tokens.accent : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#fff' }}>
                          {sel ? '✓' : ''}
                        </div>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: '13px', color: tokens.textPrimary }}>{acct.name}</span>
                          {acct.interestRate > 0 && <span style={{ fontSize: '11px', color: tokens.textMuted, marginLeft: '6px' }}>{acct.interestRate}% APR</span>}
                        </div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>${(acct.balance || 0).toLocaleString()}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {sourceForm.type !== 'manual' && (
            <div style={{ padding: '10px 14px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted, marginBottom: '3px' }}>Preview</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: tokens.accent }}>
                ${(computeTrackedValueForSource({ type: sourceForm.type, rateThreshold: parseFloat(sourceForm.rateThreshold) || 10, accountIds: sourceForm.accountIds }) || 0).toLocaleString()}
              </div>
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>will be set as current balance</div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px', borderTop: `1px solid ${tokens.border}` }}>
            <Button variant="ghost" onClick={() => setShowSourcePicker(false)}>Cancel</Button>
            <Button onClick={handleSaveSource} loading={savingSource}>Save Source</Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
