// src/components/screens/HomeScreenV3.js
// Mission-control aesthetic — light mode, data-dense, techy feel.
// Accessible via /home-v3. All functionality identical to V1; visual layer only.

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getAIFocusRecommendation, getWeeklyFocusStatement, getTodaysPulse } from '../../lib/ai';
import { buildHolisticContext } from '../../lib/aiContext';
import { updateTask, addTask, saveProfile, getPulseCache, savePulseCache } from '../../lib/db';
import { getValidAccessToken, getEvents } from '../../lib/calendar';
import { calculateMomentum } from '../../lib/momentum';
import { calculateUrgency, isTaskBlocked, isDeferred } from '../../lib/tasks';
import { fetchMonthlyCashFlow } from '../../lib/plaid';
import { fetchWeeklyWeather, isOutdoorTask, weatherCodeToEmoji, DEFAULT_ZIP } from '../../lib/weather';
import { Modal, Input, Spinner, priorityColors } from '../ui';
import PlanScheduleFlow from './PlanScheduleFlow';

const isDev = process.env.NODE_ENV !== 'production';

// ─── V3 visual constants ─────────────────────────────────────────────────────
const MONO = "'JetBrains Mono','Fira Code','Cascadia Code','Courier New',monospace";

const PRIORITY_COLOR = {
  critical: tokens.red,
  high:     tokens.amber,
  medium:   tokens.accent,
  low:      tokens.textMuted,
};

const PRIORITY_LABEL = {
  critical: 'CRIT',
  high:     'HIGH',
  medium:   'MED',
  low:      'LOW',
};

// ─── Micro helpers ────────────────────────────────────────────────────────────
function todayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function weekStartDate(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// Section header: ▸ LABEL ─────────────────  [action]
function SysHeader({ label, live = false, actionLabel, onAction, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '9px 14px', borderBottom: `1px solid ${tokens.border}`,
      background: tokens.bgInput,
    }}>
      {live && (
        <span className="pulsing" style={{
          width: 5, height: 5, borderRadius: '50%',
          background: tokens.green, flexShrink: 0, display: 'inline-block',
        }} />
      )}
      <span style={{
        fontSize: '9px', fontWeight: 700, letterSpacing: '0.13em',
        textTransform: 'uppercase', color: tokens.textMuted,
        fontFamily: MONO,
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: '1px', background: tokens.border }} />
      {children}
      {actionLabel && (
        <button onClick={onAction} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
          fontSize: '10px', color: tokens.accent, fontFamily: MONO,
          letterSpacing: '0.06em', fontWeight: 600,
        }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// Big metric readout card
function MetricBlock({ value, label, color, sub }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${tokens.border}` }}>
      <div style={{
        fontSize: '30px', fontWeight: 800, lineHeight: 1,
        fontFamily: MONO, color: color || tokens.textPrimary,
        letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '4px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

// Priority badge pill
function PriBadge({ priority }) {
  const c = PRIORITY_COLOR[priority] || tokens.textMuted;
  return (
    <span style={{
      fontSize: '8px', fontWeight: 700, fontFamily: MONO,
      letterSpacing: '0.08em', color: c,
      border: `1px solid ${c}`, borderRadius: '3px',
      padding: '1px 4px', lineHeight: 1.4, flexShrink: 0,
      opacity: 0.9,
    }}>
      {PRIORITY_LABEL[priority] || 'MED'}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function HomeScreenV3() {
  const { user, profile, updateProfile } = useAuth();
  const {
    tasks, totalDebt, goals, calendarIntegration, projects,
    weeklyReviews, brainDumps, brainDumpDigests, userProfile,
    plaidItems, dailyReviews, manualCashFlow, debtAccounts,
    assetAccounts, notes, lastWeeklyReset, savingsAnalysis,
    savingsHistory, actedOnRecommendations, habits, habitLogs,
  } = useData();
  const navigate = useNavigate();

  const [energy,           setEnergy]           = useState(profile?.energyToday || 7);
  const [aiBriefing,       setAiBriefing]       = useState(null);
  const [aiLoading,        setAiLoading]        = useState(false);
  const [planOpen,         setPlanOpen]         = useState(false);
  const [weekFocus,        setWeekFocus]        = useState(null);
  const [weekFocusLoading, setWeekFocusLoading] = useState(false);
  const [pulseData,        setPulseData]        = useState(null);
  const [pulseLoading,     setPulseLoading]     = useState(false);
  const [pulseCachedAt,    setPulseCachedAt]    = useState(null);
  const [calendarEvents,   setCalendarEvents]   = useState([]);
  const [calendarDensity,  setCalendarDensity]  = useState(null);
  const [plaidData,        setPlaidData]        = useState(null);
  const [weatherForecast,  setWeatherForecast]  = useState(null);
  const [editingTask,      setEditingTask]      = useState(null);
  const [editForm,         setEditForm]         = useState({});
  const [editSaving,       setEditSaving]       = useState(false);
  const [feedback,         setFeedback]         = useState({ open: false, key: '', text: '', saving: false });
  const [completionNote,   setCompletionNote]   = useState({ open: false, task: null, text: '' });

  const isAfter5pm = new Date().getHours() >= 17;
  const todayStr   = todayYMD();

  // ─── Computed data (same logic as V1) ──────────────────────────────────────
  const scheduledToday = tasks.filter(t => {
    if (t.done || isDeferred(t)) return false;
    if (t.scheduledDate === todayStr) return true;
    if (t.scheduledStart) {
      const d = new Date(t.scheduledStart);
      const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (ymd === todayStr) return true;
    }
    return false;
  }).sort((a, b) => (a.scheduledStart || '').localeCompare(b.scheduledStart || ''));

  const todayTasks = [...tasks]
    .filter(t => !t.done && !isTaskBlocked(t, tasks) && !isDeferred(t) &&
      (t.priority === 'critical' || t.priority === 'high' || t.source === 'brain-dump' || !t.projectId))
    .sort((a, b) => calculateUrgency(b) - calculateUrgency(a));

  const top3    = todayTasks.slice(0, 3);

  const doneTodayCount = tasks.filter(t => {
    if (!t.done) return false;
    const updated = t.updatedAt?.toDate?.() || new Date(0);
    return updated.toDateString() === new Date().toDateString();
  }).length;

  const openTaskCount = tasks.filter(t => !t.done && !isDeferred(t)).length;

  const deadlineRiskTasks = useMemo(() => {
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return tasks.filter(t => {
      if (t.done || !t.dueDate || isDeferred(t)) return false;
      const due = new Date(t.dueDate + 'T23:59:59');
      return due >= now && due <= in7 && !t.scheduledStart && !t.scheduledDate;
    }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }, [tasks]);

  const atRiskThisWeek = useMemo(() => {
    const now = Date.now();
    const in5 = now + 5 * 24 * 60 * 60 * 1000;
    return tasks.filter(t => {
      if (t.done || !t.dueDate) return false;
      const dueMs = new Date(t.dueDate + 'T23:59:59').getTime();
      if (dueMs < now || dueMs > in5) return false;
      return (t.priority === 'critical' || t.priority === 'high') && (t.pushCount || 0) >= 2;
    });
  }, [tasks]);

  const staleInboxTasks = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return tasks.filter(t => {
      if (t.done) return false;
      if (t.projectId && t.project !== 'Inbox') return false;
      const updMs = t.updatedAt?.toMillis?.() || (t.updatedAt ? new Date(t.updatedAt).getTime() : 0);
      return updMs > 0 && updMs < cutoff;
    });
  }, [tasks]);

  const driftingGoals = useMemo(() => {
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return (goals || []).filter(g => {
      if (g.status !== 'active') return false;
      const lowScore = g.likelihoodScore != null && g.likelihoodScore < 40;
      const approachingDeadline = g.targetDate && (() => {
        const [y, m] = g.targetDate.split('-').map(Number);
        return new Date(y, m - 1, 1) <= in60;
      })();
      if (!lowScore && !approachingDeadline) return false;
      const linkedProjectIds = (projects || []).filter(p => p.goalId === g.id).map(p => p.id);
      return !tasks.some(t => {
        if (t.done) return false;
        const linked = t.goalId === g.id || linkedProjectIds.includes(t.projectId);
        if (!linked) return false;
        const upd = t.updatedAt?.toDate?.() || (t.updatedAt ? new Date(t.updatedAt) : new Date(0));
        return upd >= weekAgo;
      });
    });
  }, [goals, tasks, projects]);

  const reviewReminderDue = useMemo(() => {
    if (!weeklyReviews || weeklyReviews.length === 0) return true;
    const lastMs = weeklyReviews[0].savedAt?.toMillis?.() ||
      (weeklyReviews[0].savedAt ? new Date(weeklyReviews[0].savedAt).getTime() : 0);
    return (Date.now() - lastMs) > 7 * 24 * 60 * 60 * 1000;
  }, [weeklyReviews]);

  const eodDoneToday = useMemo(() => {
    const s = new Date().toDateString();
    return (dailyReviews || []).some(r => r.type === 'eod' && r.date === s);
  }, [dailyReviews]);

  const morningDoneToday = useMemo(() => {
    const s = new Date().toDateString();
    return (dailyReviews || []).some(r => r.type === 'morning' && r.date === s);
  }, [dailyReviews]);

  const displayActiveProjects = useMemo(() => {
    return (projects || [])
      .map(p => {
        const pts = tasks.filter(t => t.projectId === p.id);
        return { ...p, _mScore: calculateMomentum(p, pts).score };
      })
      .filter(p => {
        if (p.status === 'complete' || p.status === 'paused' || p.status === 'planning') return false;
        return p.status === 'active' || (p.status === 'stalled' && p._mScore > 50);
      })
      .sort((a, b) => b._mScore - a._mScore)
      .slice(0, 5);
  }, [projects, tasks]);

  const activeGoals = (goals || []).filter(g => g.status === 'active');
  const avgGoalScore = useMemo(() => {
    const scored = activeGoals.filter(g => g.likelihoodScore != null);
    if (!scored.length) return null;
    return Math.round(scored.reduce((s, g) => s + g.likelihoodScore, 0) / scored.length);
  }, [activeGoals]);

  const goalTrajectoryItems = useMemo(() => {
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
    return activeGoals.map(goal => {
      const goalTasks = (tasks || []).filter(t => t.goalId === goal.id);
      const openCount = goalTasks.filter(t => !t.done).length;
      const score = goal.likelihoodScore;
      const trend = goal.scoreTrend || null;
      return { goal, openCount, score, trend };
    }).sort((a, b) => {
      if (a.score != null && b.score != null) return a.score - b.score;
      if (a.score != null) return -1;
      return 1;
    });
  }, [activeGoals, tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Habits done today
  const habitsDoneToday = useMemo(() => {
    const activeHabits = (habits || []).filter(h => h.active !== false);
    return activeHabits.filter(h =>
      (habitLogs || []).some(l => l.habitId === h.id && l.date === todayStr && l.done)
    ).length;
  }, [habits, habitLogs, todayStr]);

  // Action items — same logic as V1
  const actionItems = useMemo(() => {
    const items = [];
    const carryFwd = tasks.filter(t => {
      if (t.done || t.status === 'dropped') return false;
      if (t.scheduledDate && t.scheduledDate < todayStr) return true;
      if (t.scheduledStart) {
        const d = new Date(t.scheduledStart);
        const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (ymd < todayStr) return true;
      }
      if (t.dueDate && t.dueDate < todayStr) return true;
      return false;
    });
    if (carryFwd.length > 0) items.push({ id: 'carry', icon: '⚑', urgency: 'high', label: `${carryFwd.length} task${carryFwd.length > 1 ? 's' : ''} carried forward`, action: () => navigate('/calendar') });
    if (atRiskThisWeek.length > 0) items.push({ id: 'atrisk', icon: '⚑', urgency: 'high', label: `${atRiskThisWeek.length} at-risk · due soon, pushed repeatedly`, action: () => navigate('/calendar') });
    if (deadlineRiskTasks.length > 0) items.push({ id: 'deadline', icon: '⏱', urgency: 'high', label: `${deadlineRiskTasks.length} unscheduled due within 7 days`, action: () => navigate('/calendar') });
    if (driftingGoals.length > 0) items.push({ id: 'goals', icon: '⚠', urgency: 'medium', label: `${driftingGoals.length} goal${driftingGoals.length > 1 ? 's' : ''} drifting`, action: () => navigate('/goals') });
    if (reviewReminderDue) items.push({ id: 'review', icon: '▤', urgency: 'medium', label: 'Weekly review overdue', action: () => navigate('/review') });
    if (!isAfter5pm && !morningDoneToday) items.push({ id: 'morning', icon: '☀', urgency: 'medium', label: 'Morning review not done', action: () => navigate('/review') });
    if (staleInboxTasks.length >= 3) items.push({ id: 'stale', icon: '◫', urgency: 'low', label: `${staleInboxTasks.length} inbox tasks stale 14+ days`, action: () => navigate('/tasks') });
    if (isAfter5pm && !eodDoneToday) items.push({ id: 'eod', icon: '🌙', urgency: 'low', label: 'EOD check-in pending', action: () => navigate('/review?tab=eod') });
    return items;
  }, [tasks, todayStr, atRiskThisWeek, deadlineRiskTasks, driftingGoals, reviewReminderDue, morningDoneToday, staleInboxTasks, isAfter5pm, eodDoneToday, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── AI context builder ────────────────────────────────────────────────────
  const getHolisticContext = () => buildHolisticContext({
    goals: goals || [], tasks, projects: projects || [],
    brainDumps: brainDumps || [], brainDumpDigests: brainDumpDigests || [],
    weeklyReviews: weeklyReviews || [], userProfile: userProfile || profile,
    calendarDensity, calendarEvents, plaidData, manualCashFlow,
    debtAccounts: debtAccounts || [], assetAccounts: assetAccounts || [],
    weatherForecast, notes: notes || [], savingsAnalysis, savingsHistory,
    habits: habits || [], habitLogs: habitLogs || [],
    dailyReviews: dailyReviews || [], actedOnRecommendations: actedOnRecommendations || [],
  });

  // ─── AI fetch handlers ─────────────────────────────────────────────────────
  const fetchAI = async () => {
    setAiLoading(true);
    const result = await getAIFocusRecommendation({ energy, topTasks: top3, projects: displayActiveProjects, holisticContext: getHolisticContext() });
    setAiBriefing(result || { headline: 'Focus on your highest-leverage task today.', actions: [], driftFlag: null });
    setAiLoading(false);
  };

  const fetchWeekFocus = async () => {
    const cacheKey = 'weeklyFocusCache';
    const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey)); } catch { return null; } })();
    if (cached?.data && Date.now() - cached.ts < 24 * 60 * 60 * 1000) { setWeekFocus(cached.data); return; }
    setWeekFocusLoading(true);
    const data = await getWeeklyFocusStatement({ goals: goals || [], tasks, weeklyReviews: weeklyReviews || [], holisticContext: getHolisticContext() });
    if (data) { setWeekFocus(data); localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() })); }
    setWeekFocusLoading(false);
  };

  const fetchPulse = async (force = false) => {
    if (pulseLoading) return;
    if (!force) {
      try {
        const cached = await getPulseCache(user.uid);
        if (cached) { setPulseData(cached.data); setPulseCachedAt(cached.cachedAtMs); return; }
      } catch {}
    }
    setPulseLoading(true);
    try {
      const result = await getTodaysPulse({ holisticContext: getHolisticContext(), tasks, goals: goals || [], habits: habits || [], dailyReviews: dailyReviews || [] });
      if (result) { setPulseData(result); setPulseCachedAt(Date.now()); savePulseCache(user.uid, result).catch(() => {}); }
    } catch {}
    finally { setPulseLoading(false); }
  };

  const handleFeedbackSubmit = async () => {
    if (!feedback.text.trim()) return;
    setFeedback(f => ({ ...f, saving: true }));
    try {
      const existing = userProfile?.aiFeedback || profile?.aiFeedback || {};
      const newFeedback = { ...existing, [feedback.key]: feedback.text.trim() };
      await saveProfile(user.uid, { aiFeedback: newFeedback });
      await updateProfile({ aiFeedback: newFeedback });
      setFeedback({ open: false, key: '', text: '', saving: false });
      if (feedback.key === 'briefing') { setAiBriefing(null); fetchAI(); }
      else if (feedback.key === 'weekFocus') { localStorage.removeItem('weeklyFocusCache'); setWeekFocus(null); fetchWeekFocus(); }
    } catch (err) {
      if (isDev) console.error('Feedback save error:', err);
    } finally {
      setFeedback(f => ({ ...f, saving: false }));
    }
  };

  useEffect(() => {
    fetchAI(); fetchWeekFocus(); fetchPulse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function fetchDensity() {
      if (!calendarIntegration?.connected) return;
      try {
        const token = await getValidAccessToken(user.uid, calendarIntegration);
        if (!token) return;
        const ws = weekStartDate(new Date());
        const we = new Date(ws); we.setDate(we.getDate() + 7);
        const evs = await getEvents(token, ws.toISOString(), we.toISOString());
        const evList = evs || [];
        const density = {};
        evList.forEach(ev => {
          const date = ev.start?.dateTime?.split('T')[0] || ev.start?.date;
          if (date) density[date] = (density[date] || 0) + 1;
        });
        setCalendarDensity(density);
        setCalendarEvents(evList.filter(ev => {
          const d = ev.start?.dateTime?.split('T')[0] || ev.start?.date;
          return d === todayStr || d === (() => { const x = new Date(); x.setDate(x.getDate()+1); return x.toISOString().split('T')[0]; })();
        }).slice(0, 6));
      } catch {}
    }
    fetchDensity();
  }, [calendarIntegration]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function fetchPlaid() {
      if (!plaidItems?.length) return;
      try {
        const data = await fetchMonthlyCashFlow(user.uid, plaidItems);
        setPlaidData(data);
      } catch {}
    }
    fetchPlaid();
  }, [plaidItems]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function fetchWeather() {
      const zip = userProfile?.zip || profile?.zip || DEFAULT_ZIP;
      try { setWeatherForecast(await fetchWeeklyWeather(zip)); } catch {}
    }
    fetchWeather();
  }, [userProfile?.zip]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Task actions ──────────────────────────────────────────────────────────
  const handleTaskDone = async (task) => {
    if (task.completionNotePrompt || task.goalId) {
      setCompletionNote({ open: true, task, text: '' });
      return;
    }
    try {
      await updateTask(user.uid, task.id, { done: true, status: 'completed', completedAt: new Date().toISOString() });
    } catch (err) {
      if (isDev) console.error(err);
    }
  };

  const handleCompletionNoteSubmit = async () => {
    const { task, text } = completionNote;
    try {
      const updates = { done: true, status: 'completed', completedAt: new Date().toISOString() };
      if (text.trim()) updates.completionNote = text.trim();
      await updateTask(user.uid, task.id, updates);
      setCompletionNote({ open: false, task: null, text: '' });
    } catch (err) {
      if (isDev) console.error(err);
    }
  };

  const openEdit = (task) => {
    setEditingTask(task);
    setEditForm({ title: task.title || '', priority: task.priority || 'medium', dueDate: task.dueDate || '', estimatedMinutes: task.estimatedMinutes || '', notes: task.notes || '', project: task.project || 'Inbox' });
  };

  const handleEditSave = async () => {
    if (!editingTask || !editForm.title.trim()) return;
    setEditSaving(true);
    const linked = (projects || []).find(p => p.title === editForm.project);
    try {
      await updateTask(user.uid, editingTask.id, {
        title: editForm.title.trim(), priority: editForm.priority,
        dueDate: editForm.dueDate || null, estimatedMinutes: editForm.estimatedMinutes ? Number(editForm.estimatedMinutes) : null,
        notes: editForm.notes, project: editForm.project, projectId: linked?.id || editingTask.projectId || null,
      });
      setEditingTask(null);
    } catch (err) { if (isDev) console.error(err); }
    finally { setEditSaving(false); }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  const card = (extra = {}) => ({
    background: tokens.bgCard,
    border: `1px solid ${tokens.border}`,
    borderRadius: '8px',
    overflow: 'hidden',
    ...extra,
  });

  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  const firstName = profile?.firstName || 'Andrew';

  const URGENCY_COLOR = { high: tokens.red, medium: tokens.amber, low: tokens.textMuted };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', paddingBottom: '24px' }}>

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <div className="fade-up" style={{
        display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
        padding: '8px 0 12px',
        borderBottom: `1px solid ${tokens.border}`,
        marginBottom: '16px',
      }}>
        <span style={{ fontFamily: MONO, fontSize: '10px', color: tokens.textMuted, letterSpacing: '0.08em' }}>
          {dateLabel}
        </span>
        <span style={{ color: tokens.border }}>·</span>
        <span style={{ fontFamily: MONO, fontSize: '10px', color: tokens.blue }}>
          {openTaskCount} OPEN
        </span>
        <span style={{ fontFamily: MONO, fontSize: '10px', color: tokens.green }}>
          {doneTodayCount} DONE
        </span>
        <span style={{ fontFamily: MONO, fontSize: '10px', color: tokens.accent }}>
          ENERGY {energy}/10
        </span>
        {weatherForecast?.forecast?.[0] && (
          <>
            <span style={{ color: tokens.border }}>·</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', color: tokens.textMuted }}>
              {weatherCodeToEmoji(weatherForecast.forecast[0].code)} {weatherForecast.forecast[0].maxTemp}°F
            </span>
          </>
        )}
        <div style={{ flex: 1 }} />
        {/* Energy dial */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontFamily: MONO, fontSize: '9px', color: tokens.textMuted, letterSpacing: '0.08em' }}>ENERGY</span>
          <input
            type="range" min={1} max={10} value={energy}
            onChange={e => {
              const v = Number(e.target.value);
              setEnergy(v);
              saveProfile(user.uid, { energyToday: v }).catch(() => {});
            }}
            style={{ width: '80px', cursor: 'pointer' }}
          />
          <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 700, color: tokens.accent, width: '18px' }}>{energy}</span>
        </div>
      </div>

      {/* ── Greeting + Plan My Day ─────────────────────────────────────────── */}
      <div className="fade-up stagger-1" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: '9px', color: tokens.textMuted, letterSpacing: '0.12em', marginBottom: '4px' }}>
            ANCHOR / HOME / V3
          </div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 800, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1 }}>
            {getGreeting()}, {firstName}.
          </h1>
          {aiBriefing?.driftFlag && (
            <div style={{ marginTop: '6px', fontFamily: MONO, fontSize: '10px', color: tokens.amber, letterSpacing: '0.06em' }}>
              ⚠ DRIFT DETECTED · {aiBriefing.driftFlag}
            </div>
          )}
        </div>
        <button
          onClick={() => setPlanOpen(true)}
          style={{
            background: tokens.accent, color: '#fff',
            border: 'none', borderRadius: '6px',
            padding: '10px 18px', fontSize: '12px', fontWeight: 700,
            cursor: 'pointer', fontFamily: MONO, letterSpacing: '0.08em',
            flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          ✦ PLAN MY DAY
        </button>
      </div>

      {/* ── Row 1: Intel Briefing + Readout ──────────────────────────────── */}
      <div className="fade-up stagger-2" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 200px',
        gap: '10px',
        marginBottom: '10px',
      }}>

        {/* INTEL BRIEFING */}
        <div style={card()}>
          <SysHeader
            label="Intel Briefing"
            live={!!aiBriefing && !aiLoading}
            actionLabel={aiLoading ? null : '↻'}
            onAction={fetchAI}
          >
            {aiLoading && <Spinner size={12} />}
          </SysHeader>
          <div style={{ padding: '14px 16px' }}>
            {aiLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: tokens.textMuted, fontSize: '12px', fontFamily: MONO }}>
                <Spinner size={14} /> <span>PROCESSING...</span>
              </div>
            ) : aiBriefing ? (
              <>
                <div style={{ fontSize: '15px', fontWeight: 700, color: tokens.textPrimary, lineHeight: 1.4, marginBottom: '12px', letterSpacing: '-0.01em' }}>
                  {aiBriefing.headline}
                </div>
                {(aiBriefing.actions || []).map((action, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '7px' }}>
                    <span style={{ fontFamily: MONO, fontSize: '10px', color: tokens.accent, fontWeight: 700, flexShrink: 0, marginTop: '2px' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500, lineHeight: 1.35 }}>
                        {action.action}
                      </div>
                      {action.reason && (
                        <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                          {action.reason}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setFeedback({ open: true, key: 'briefing', text: '', saving: false })}
                  style={{ marginTop: '10px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: '9px', color: tokens.textMuted, letterSpacing: '0.08em', padding: 0 }}
                >
                  ◎ INCORRECT? GIVE FEEDBACK
                </button>
              </>
            ) : (
              <div style={{ fontSize: '12px', color: tokens.textMuted, fontFamily: MONO }}>AWAITING DATA...</div>
            )}
          </div>
        </div>

        {/* TODAY'S READOUT */}
        <div style={card()}>
          <SysHeader label="Readout" />
          <MetricBlock
            value={String(doneTodayCount).padStart(2, '0')}
            label="Done today"
            color={tokens.green}
          />
          <MetricBlock
            value={String(openTaskCount).padStart(2, '0')}
            label="Open tasks"
            color={tokens.blue}
          />
          <MetricBlock
            value={avgGoalScore != null ? `${avgGoalScore}%` : '--'}
            label="Avg goal score"
            color={avgGoalScore != null ? (avgGoalScore >= 60 ? tokens.green : avgGoalScore >= 40 ? tokens.amber : tokens.red) : tokens.textMuted}
          />
          <MetricBlock
            value={`${habitsDoneToday}/${(habits || []).filter(h => h.active !== false).length}`}
            label="Habits done"
            color={tokens.purple}
          />
        </div>
      </div>

      {/* ── Row 2: Execution Queue ─────────────────────────────────────────── */}
      <div className="fade-up stagger-3" style={{ ...card(), marginBottom: '10px' }}>
        <SysHeader label="Execution Queue" actionLabel="All tasks →" onAction={() => navigate('/tasks')}>
          <span style={{ fontFamily: MONO, fontSize: '9px', color: tokens.textMuted }}>
            {scheduledToday.length > 0 ? `${scheduledToday.length} SCHEDULED` : top3.length > 0 ? `${top3.length} PRIORITY` : ''}
          </span>
        </SysHeader>
        {scheduledToday.length === 0 && top3.length === 0 ? (
          <div style={{ padding: '20px 16px', fontFamily: MONO, fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.06em' }}>
            NO TASKS IN QUEUE
          </div>
        ) : (
          <div>
            {(scheduledToday.length > 0 ? scheduledToday : top3).map((task, i) => (
              <div
                key={task.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px',
                  borderBottom: i < (scheduledToday.length > 0 ? scheduledToday : top3).length - 1 ? `1px solid ${tokens.border}` : 'none',
                  borderLeft: `3px solid ${PRIORITY_COLOR[task.priority] || tokens.textMuted}`,
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = tokens.bgInput}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => openEdit(task)}
              >
                <button
                  onClick={e => { e.stopPropagation(); handleTaskDone(task); }}
                  style={{
                    width: 16, height: 16, borderRadius: '3px', flexShrink: 0,
                    border: `1.5px solid ${tokens.border}`,
                    background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                />
                <PriBadge priority={task.priority} />
                <span style={{ flex: 1, fontSize: '13px', color: tokens.textPrimary, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {task.title}
                </span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                  {task.scheduledStart && (
                    <span style={{ fontFamily: MONO, fontSize: '10px', color: tokens.accent }}>
                      {formatTime(task.scheduledStart)}
                    </span>
                  )}
                  {task.dueDate && (
                    <span style={{ fontFamily: MONO, fontSize: '10px', color: tokens.textMuted }}>
                      DUE {formatShortDate(task.dueDate).toUpperCase()}
                    </span>
                  )}
                  {task.estimatedMinutes && (
                    <span style={{ fontFamily: MONO, fontSize: '10px', color: tokens.textMuted }}>
                      {task.estimatedMinutes}m
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Row 3: Objectives + Action Required ──────────────────────────────*/}
      <div className="fade-up stagger-4" style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px',
      }}>

        {/* OBJECTIVES */}
        <div style={card()}>
          <SysHeader label="Objectives" actionLabel="All →" onAction={() => navigate('/goals')} />
          {goalTrajectoryItems.length === 0 ? (
            <div style={{ padding: '16px', fontFamily: MONO, fontSize: '11px', color: tokens.textMuted }}>NO ACTIVE GOALS</div>
          ) : (
            goalTrajectoryItems.slice(0, 5).map((item, i) => {
              const { goal, score, trend, openCount } = item;
              const scoreColor = score == null ? tokens.textMuted : score >= 65 ? tokens.green : score >= 40 ? tokens.amber : tokens.red;
              const trendGlyph = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
              return (
                <div
                  key={goal.id}
                  onClick={() => navigate(`/goals/${goal.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '9px 14px',
                    borderBottom: i < Math.min(goalTrajectoryItems.length, 5) - 1 ? `1px solid ${tokens.border}` : 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = tokens.bgInput}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {goal.title}
                    </div>
                    {openCount > 0 && (
                      <div style={{ fontFamily: MONO, fontSize: '9px', color: tokens.textMuted, marginTop: '2px' }}>
                        {openCount} OPEN TASK{openCount > 1 ? 'S' : ''}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    {score != null && (
                      <>
                        <span style={{ fontFamily: MONO, fontSize: '13px', fontWeight: 800, color: scoreColor }}>
                          {score}%
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: '11px', color: scoreColor, opacity: 0.7 }}>
                          {trendGlyph}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ACTION REQUIRED */}
        <div style={card()}>
          <SysHeader label="Action Required">
            {actionItems.length > 0 && (
              <span style={{ fontFamily: MONO, fontSize: '9px', color: tokens.red, fontWeight: 700 }}>
                {actionItems.length} ITEM{actionItems.length > 1 ? 'S' : ''}
              </span>
            )}
          </SysHeader>
          {actionItems.length === 0 ? (
            <div style={{ padding: '16px', fontFamily: MONO, fontSize: '11px', color: tokens.green }}>
              ✓ ALL CLEAR
            </div>
          ) : (
            actionItems.slice(0, 6).map((item, i) => (
              <div
                key={item.id}
                onClick={item.action}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '9px 14px',
                  borderBottom: i < Math.min(actionItems.length, 6) - 1 ? `1px solid ${tokens.border}` : 'none',
                  borderLeft: `3px solid ${URGENCY_COLOR[item.urgency] || tokens.textMuted}`,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = tokens.bgInput}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: '13px', flexShrink: 0 }}>{item.icon}</span>
                <span style={{ fontSize: '12px', color: tokens.textSecondary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
                <span style={{ fontFamily: MONO, fontSize: '9px', color: tokens.textMuted, flexShrink: 0 }}>→</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Row 4: Projects + Signal ───────────────────────────────────────── */}
      <div className="fade-up stagger-5" style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px',
      }}>

        {/* ACTIVE PROJECTS */}
        <div style={card()}>
          <SysHeader label="Active Projects" actionLabel="All →" onAction={() => navigate('/projects')} />
          {displayActiveProjects.length === 0 ? (
            <div style={{ padding: '16px', fontFamily: MONO, fontSize: '11px', color: tokens.textMuted }}>NO ACTIVE PROJECTS</div>
          ) : (
            displayActiveProjects.map((proj, i) => {
              const m = proj._mScore || 0;
              const mColor = m >= 65 ? tokens.green : m >= 35 ? tokens.amber : tokens.red;
              return (
                <div
                  key={proj.id}
                  onClick={() => navigate(`/projects/${proj.id}`)}
                  style={{
                    padding: '10px 14px',
                    borderBottom: i < displayActiveProjects.length - 1 ? `1px solid ${tokens.border}` : 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = tokens.bgInput}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                      {proj.title}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 700, color: mColor, flexShrink: 0 }}>
                      {m}%
                    </span>
                  </div>
                  {/* Momentum bar */}
                  <div style={{ height: '3px', background: tokens.track, borderRadius: '99px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${m}%`, background: mColor, borderRadius: '99px', transition: 'width 0.4s ease' }} />
                  </div>
                  {proj.status === 'stalled' && (
                    <div style={{ fontFamily: MONO, fontSize: '8px', color: tokens.amber, marginTop: '4px', letterSpacing: '0.06em' }}>
                      ⚠ STALLED
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* SIGNAL / PULSE */}
        <div style={card()}>
          <SysHeader
            label="Signal"
            live={!!pulseData && !pulseLoading}
            actionLabel={pulseLoading ? null : '↻'}
            onAction={() => fetchPulse(true)}
          >
            {pulseLoading && <Spinner size={12} />}
          </SysHeader>
          {pulseLoading ? (
            <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: MONO, fontSize: '11px', color: tokens.textMuted }}>
              <Spinner size={12} /> SCANNING...
            </div>
          ) : pulseData?.headline ? (
            <div>
              <div style={{ padding: '10px 14px', borderBottom: `1px solid ${tokens.border}` }}>
                <div style={{ fontFamily: MONO, fontSize: '9px', color: tokens.textMuted, letterSpacing: '0.08em', marginBottom: '4px' }}>INTELLIGENCE PICTURE</div>
                <div style={{ fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.5 }}>{pulseData.headline}</div>
              </div>
              {(pulseData.flags || []).map((flag, i) => {
                const flagColor = flag.type === 'risk' ? tokens.red : flag.type === 'goal' ? tokens.accent : flag.type === 'habit' ? tokens.green : tokens.amber;
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '8px',
                      padding: '8px 14px',
                      borderBottom: i < (pulseData.flags || []).length - 1 ? `1px solid ${tokens.border}` : 'none',
                      borderLeft: `3px solid ${flagColor}`,
                      cursor: flag.path ? 'pointer' : 'default',
                    }}
                    onClick={() => flag.path && navigate(flag.path)}
                    onMouseEnter={e => flag.path && (e.currentTarget.style.background = tokens.bgInput)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: '12px', flexShrink: 0 }}>{flag.icon || '●'}</span>
                    <div>
                      <div style={{ fontFamily: MONO, fontSize: '8px', color: flagColor, letterSpacing: '0.08em', marginBottom: '2px' }}>
                        [{(flag.type || 'info').toUpperCase()}]
                      </div>
                      <div style={{ fontSize: '11px', color: tokens.textSecondary, lineHeight: 1.4 }}>{flag.message}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '16px', fontFamily: MONO, fontSize: '11px', color: tokens.textMuted }}>NO SIGNAL DATA</div>
          )}
        </div>
      </div>

      {/* ── Weekly Directive ────────────────────────────────────────────────── */}
      {(weekFocus || weekFocusLoading) && (
        <div className="fade-up stagger-6" style={{ ...card(), marginBottom: '10px' }}>
          <SysHeader
            label="Weekly Directive"
            live={!!weekFocus && !weekFocusLoading}
            actionLabel={weekFocusLoading ? null : '↻'}
            onAction={fetchWeekFocus}
          >
            {weekFocusLoading && <Spinner size={12} />}
          </SysHeader>
          <div style={{ padding: '14px 16px' }}>
            {weekFocusLoading ? (
              <div style={{ fontFamily: MONO, fontSize: '11px', color: tokens.textMuted, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Spinner size={12} /> COMPUTING DIRECTIVE...
              </div>
            ) : weekFocus ? (
              <>
                {weekFocus.headline && (
                  <div style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.06em', marginBottom: '10px' }}>
                    // {weekFocus.headline}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                  {weekFocus.actions?.length > 0 && (
                    <div style={{ flex: 1, minWidth: '160px' }}>
                      <div style={{ fontFamily: MONO, fontSize: '9px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px' }}>THIS WEEK</div>
                      {weekFocus.actions.map((a, i) => (
                        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '5px', alignItems: 'flex-start' }}>
                          <span style={{ fontFamily: MONO, fontSize: '9px', color: tokens.accent, fontWeight: 700, flexShrink: 0, marginTop: '2px' }}>{String(i+1).padStart(2,'0')}</span>
                          <span style={{ fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.4 }}>{a}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {weekFocus.ignore && (
                    <div style={{ flex: 1, minWidth: '160px' }}>
                      <div style={{ fontFamily: MONO, fontSize: '9px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px' }}>IGNORE THIS WEEK</div>
                      <div style={{ fontSize: '12px', color: tokens.textMuted, lineHeight: 1.5 }}>{weekFocus.ignore}</div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setFeedback({ open: true, key: 'weekFocus', text: '', saving: false })}
                  style={{ marginTop: '10px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: '9px', color: tokens.textMuted, letterSpacing: '0.08em', padding: 0 }}
                >
                  ◎ INCORRECT? GIVE FEEDBACK
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Mobile: responsive grid overrides ─────────────────────────────── */}
      <style>{`
        @media (max-width: 600px) {
          .v3-grid-2col { grid-template-columns: 1fr !important; }
          .v3-intel-row  { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* ── Plan schedule modal ─────────────────────────────────────────────── */}
      {planOpen && (
        <Modal onClose={() => setPlanOpen(false)} title="Plan My Day">
          <PlanScheduleFlow onClose={() => setPlanOpen(false)} />
        </Modal>
      )}

      {/* ── Task edit modal ────────────────────────────────────────────────── */}
      {editingTask && (
        <Modal onClose={() => setEditingTask(null)} title="Edit Task">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Input label="Title" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '4px' }}>Priority</div>
                <select value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: `1px solid ${tokens.border}`, background: tokens.bgInput, color: tokens.textPrimary, fontFamily: fonts.body }}>
                  {['critical','high','medium','low'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '4px' }}>Due Date</div>
                <input type="date" value={editForm.dueDate} onChange={e => setEditForm(f => ({ ...f, dueDate: e.target.value }))} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: `1px solid ${tokens.border}`, background: tokens.bgInput, color: tokens.textPrimary, fontFamily: fonts.body }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button onClick={() => setEditingTask(null)} style={{ padding: '8px 16px', borderRadius: '6px', border: `1px solid ${tokens.border}`, background: 'none', cursor: 'pointer', color: tokens.textSecondary, fontFamily: fonts.body }}>Cancel</button>
              <button onClick={handleEditSave} disabled={editSaving} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: tokens.accent, color: '#fff', cursor: 'pointer', fontFamily: fonts.body, fontWeight: 600 }}>
                {editSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Completion note modal ──────────────────────────────────────────── */}
      {completionNote.open && (
        <Modal onClose={() => setCompletionNote({ open: false, task: null, text: '' })} title="Mark Complete">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '14px', color: tokens.textSecondary }}>{completionNote.task?.title}</div>
            <textarea
              placeholder="What did you find, learn, or decide? (optional)"
              value={completionNote.text}
              onChange={e => setCompletionNote(n => ({ ...n, text: e.target.value }))}
              rows={3}
              style={{ padding: '10px', borderRadius: '6px', border: `1px solid ${tokens.border}`, background: tokens.bgInput, color: tokens.textPrimary, fontFamily: fonts.body, fontSize: '13px', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setCompletionNote({ open: false, task: null, text: '' })} style={{ padding: '8px 16px', borderRadius: '6px', border: `1px solid ${tokens.border}`, background: 'none', cursor: 'pointer', color: tokens.textSecondary, fontFamily: fonts.body }}>Skip</button>
              <button onClick={handleCompletionNoteSubmit} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: tokens.accent, color: '#fff', cursor: 'pointer', fontFamily: fonts.body, fontWeight: 600 }}>Complete</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── AI feedback modal ──────────────────────────────────────────────── */}
      {feedback.open && (
        <Modal onClose={() => setFeedback({ open: false, key: '', text: '', saving: false })} title="Feedback">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '13px', color: tokens.textSecondary }}>What's wrong with this output? How should it be different?</div>
            <textarea
              value={feedback.text}
              onChange={e => setFeedback(f => ({ ...f, text: e.target.value }))}
              rows={3}
              placeholder="e.g. Stop suggesting X because..."
              style={{ padding: '10px', borderRadius: '6px', border: `1px solid ${tokens.border}`, background: tokens.bgInput, color: tokens.textPrimary, fontFamily: fonts.body, fontSize: '13px', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setFeedback({ open: false, key: '', text: '', saving: false })} style={{ padding: '8px 16px', borderRadius: '6px', border: `1px solid ${tokens.border}`, background: 'none', cursor: 'pointer', color: tokens.textSecondary, fontFamily: fonts.body }}>Cancel</button>
              <button onClick={handleFeedbackSubmit} disabled={feedback.saving} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: tokens.accent, color: '#fff', cursor: 'pointer', fontFamily: fonts.body, fontWeight: 600 }}>
                {feedback.saving ? 'Saving...' : 'Submit'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
