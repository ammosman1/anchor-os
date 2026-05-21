// src/components/screens/GoalDetailScreen.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { updateGoal, addTask, updateTask, getAICache, saveAICache, saveProfile } from '../../lib/db';
import { generateGoalInsights, generateGoalExecutionPlan, scoreGoals } from '../../lib/ai';
import { buildHolisticContext } from '../../lib/aiContext';
import { RECURRENCE_OPTIONS } from '../../lib/tasks';
import { fetchMonthlyCashFlow, fetchAccounts } from '../../lib/plaid';
import { Button, Modal, Input, MomentumBar, Spinner } from '../ui';
import { usePageContext } from '../../context/PageContext';

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

  const [addTaskOpen,    setAddTaskOpen]    = useState(false);
  const [addingTask,     setAddingTask]     = useState(false);
  const emptyTaskForm = {
    title: '', priority: 'high', focusType: 'deep', project: '',
    estimatedMinutes: '', dueDate: '', notes: '', tags: '', recurrence: 'none',
  };
  const [newTaskForm,    setNewTaskForm]    = useState(emptyTaskForm);

  // AI feedback
  const [feedbackOpen,   setFeedbackOpen]   = useState(false);
  const [feedbackText,   setFeedbackText]    = useState('');
  const [feedbackSaving, setFeedbackSaving]  = useState(false);

  // Action → Task
  const [actionModal,    setActionModal]    = useState(false);
  const [actionTaskForm, setActionTaskForm] = useState(emptyTaskForm);
  const [actionSaving,   setActionSaving]   = useState(false);
  const [addedActions,   setAddedActions]   = useState(new Set());
  const [skippedActions, setSkippedActions] = useState(new Set());
  const [wontDoModal,    setWontDoModal]    = useState({ open: false, action: '', reason: '' });
  const [bulkCreating,   setBulkCreating]   = useState(false);

  // Task editing
  const [editTaskOpen,   setEditTaskOpen]   = useState(false);
  const [editingTask,    setEditingTask]    = useState(null);
  const [editTaskForm,   setEditTaskForm]   = useState(emptyTaskForm);
  const [editTaskSaving, setEditTaskSaving] = useState(false);

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
      const result = await generateGoalExecutionPlan({
        goal,
        existingTasks: linkedTasks,
        projects,
        daysAvailablePerWeek: 3,
      });
      if (result?.tasks?.length > 0 || result?.milestones?.length > 0) {
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
    setEditingTask(task);
    setEditTaskForm({
      title:            task.title || '',
      priority:         task.priority || 'high',
      focusType:        task.focusType || 'deep',
      project:          task.project || '',
      estimatedMinutes: task.estimatedMinutes ? String(task.estimatedMinutes) : '',
      dueDate:          task.dueDate || '',
      notes:            task.notes || '',
      tags:             (task.tags || []).join(', '),
      recurrence:       task.recurrence || 'none',
    });
    setEditTaskOpen(true);
  };

  const handleEditTaskSave = async () => {
    if (!editingTask || !editTaskForm.title.trim() || editTaskSaving) return;
    setEditTaskSaving(true);
    try {
      const tagsArr = editTaskForm.tags
        ? editTaskForm.tags.split(',').map(t => t.trim()).filter(Boolean)
        : [];
      await updateTask(user.uid, editingTask.id, {
        title:            editTaskForm.title.trim(),
        priority:         editTaskForm.priority,
        focusType:        editTaskForm.focusType || null,
        project:          editTaskForm.project || editingTask.project || goal.title || 'Inbox',
        estimatedMinutes: editTaskForm.estimatedMinutes ? Number(editTaskForm.estimatedMinutes) : null,
        dueDate:          editTaskForm.dueDate || null,
        notes:            editTaskForm.notes || '',
        tags:             tagsArr.length ? tagsArr : null,
        recurrence:       editTaskForm.recurrence !== 'none' ? editTaskForm.recurrence : null,
      });
      setEditTaskOpen(false);
      setEditingTask(null);
    } finally {
      setEditTaskSaving(false);
    }
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
    setActionTaskForm({ ...emptyTaskForm, title: action, project: goal.title || '' });
    setActionModal(true);
  };

  const handleActionTaskSave = async () => {
    if (!actionTaskForm.title.trim() || actionSaving) return;
    setActionSaving(true);
    try {
      const tagsArr = actionTaskForm.tags
        ? actionTaskForm.tags.split(',').map(t => t.trim()).filter(Boolean)
        : [];
      await addTask(user.uid, {
        title:            actionTaskForm.title.trim(),
        priority:         actionTaskForm.priority,
        focusType:        actionTaskForm.focusType || null,
        project:          actionTaskForm.project || goal.title || 'Inbox',
        estimatedMinutes: actionTaskForm.estimatedMinutes ? Number(actionTaskForm.estimatedMinutes) : null,
        dueDate:          actionTaskForm.dueDate || null,
        notes:            actionTaskForm.notes || '',
        tags:             tagsArr.length ? tagsArr : null,
        recurrence:       actionTaskForm.recurrence !== 'none' ? actionTaskForm.recurrence : null,
        goalId,
        source: 'goal-action',
        status: 'pending',
      });
      setAddedActions(prev => new Set([...prev, actionTaskForm.title]));
      setActionModal(false);
      setActionTaskForm(emptyTaskForm);
    } finally {
      setActionSaving(false);
    }
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

      {/* Action → Task Modal */}
      <Modal open={actionModal} onClose={() => { setActionModal(false); setActionTaskForm(emptyTaskForm); }} title="Create Task from Action">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input label="Title" value={actionTaskForm.title} onChange={v => setActionTaskForm(f => ({ ...f, title: v }))} placeholder="What needs to happen?" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Priority</label>
              <select value={actionTaskForm.priority} onChange={e => setActionTaskForm(f => ({ ...f, priority: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Focus Type</label>
              <select value={actionTaskForm.focusType} onChange={e => setActionTaskForm(f => ({ ...f, focusType: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {FOCUS_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Due Date</label>
              <input type="date" value={actionTaskForm.dueDate} onChange={e => setActionTaskForm(f => ({ ...f, dueDate: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, colorScheme: 'light', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Est. Minutes</label>
              <input type="number" min="5" max="480" value={actionTaskForm.estimatedMinutes} onChange={e => setActionTaskForm(f => ({ ...f, estimatedMinutes: e.target.value }))} placeholder="45"
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
            </div>
          </div>
          <Input label="Notes" value={actionTaskForm.notes} onChange={v => setActionTaskForm(f => ({ ...f, notes: v }))} placeholder="Context..." multiline rows={2} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => { setActionModal(false); setActionTaskForm(emptyTaskForm); }}>Cancel</Button>
            <Button onClick={handleActionTaskSave} loading={actionSaving} disabled={!actionTaskForm.title.trim()}>Create Task</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Task Modal */}
      <Modal open={editTaskOpen} onClose={() => { setEditTaskOpen(false); setEditingTask(null); }} title="Edit Task">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input label="Title" value={editTaskForm.title} onChange={v => setEditTaskForm(f => ({ ...f, title: v }))} placeholder="What needs to happen?" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Priority</label>
              <select value={editTaskForm.priority} onChange={e => setEditTaskForm(f => ({ ...f, priority: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Focus Type</label>
              <select value={editTaskForm.focusType} onChange={e => setEditTaskForm(f => ({ ...f, focusType: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {FOCUS_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Due Date</label>
              <input type="date" value={editTaskForm.dueDate} onChange={e => setEditTaskForm(f => ({ ...f, dueDate: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, colorScheme: 'light', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Est. Minutes</label>
              <input type="number" min="5" max="480" value={editTaskForm.estimatedMinutes} onChange={e => setEditTaskForm(f => ({ ...f, estimatedMinutes: e.target.value }))} placeholder="45"
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Recurrence</label>
              <select value={editTaskForm.recurrence} onChange={e => setEditTaskForm(f => ({ ...f, recurrence: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {RECURRENCE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Tags (comma separated)</label>
              <input value={editTaskForm.tags} onChange={e => setEditTaskForm(f => ({ ...f, tags: e.target.value }))} placeholder="e.g. design, research"
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
            </div>
          </div>

          <Input label="Notes" value={editTaskForm.notes} onChange={v => setEditTaskForm(f => ({ ...f, notes: v }))} placeholder="Context, links, details..." multiline rows={2} />

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <Button variant="ghost" size="sm" onClick={async () => { await handleToggleTask(editingTask); setEditTaskOpen(false); setEditingTask(null); }}>
              ✓ Mark Complete
            </Button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="ghost" onClick={() => { setEditTaskOpen(false); setEditingTask(null); }}>Cancel</Button>
              <Button onClick={handleEditTaskSave} loading={editTaskSaving} disabled={!editTaskForm.title.trim()}>Save Changes</Button>
            </div>
          </div>
        </div>
      </Modal>

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
