// src/components/screens/HomeScreenV2.js
// Primary home screen — clean, focused daily command center

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getTodaysPulse, getWeeklyFocusStatement } from '../../lib/ai';
import { buildHolisticContext } from '../../lib/aiContext';
import { updateTask, getPulseCache, savePulseCache, saveHealthLog } from '../../lib/db';
import { getValidAccessToken, getEvents } from '../../lib/calendar';
import { calculateUrgency, isTaskBlocked } from '../../lib/tasks';
import { fetchMonthlyCashFlow } from '../../lib/teller';
import { fetchWeeklyWeather, weatherCodeToEmoji, DEFAULT_ZIP } from '../../lib/weather';
import { Tag, Button, priorityColors, Modal, Spinner } from '../ui';
import PlanScheduleFlow from './PlanScheduleFlow';
import TaskModal from '../TaskModal';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function weekStartDate(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0,0,0,0);
  return d;
}

const PRIORITY_ACCENT = {
  critical: tokens.red,
  high:     tokens.amber,
  medium:   tokens.accent,
  low:      tokens.textMuted,
};

export default function HomeScreenV2() {
  const { user, profile } = useAuth();
  const {
    tasks, goals, calendarIntegration, projects, weeklyReviews,
    brainDumps, userProfile, plaidItems, dailyReviews, manualCashFlow,
    debtAccounts, assetAccounts, notes, lastWeeklyReset,
    savingsAnalysis, savingsHistory, actedOnRecommendations,
    habits, habitLogs, healthLogs = [],
  } = useData();
  const navigate = useNavigate();

  const [planOpen,      setPlanOpen]      = useState(false);
  const [editingTask,   setEditingTask]   = useState(null);
  const [editSaving,    setEditSaving]    = useState(false);
  const [completionNote, setCompletionNote] = useState({ open: false, task: null, text: '' });
  const [actionCenterOpen, setActionCenterOpen] = useState(true);
  const [weekExpanded,  setWeekExpanded]  = useState(false);

  const [intelData,        setIntelData]        = useState(null);
  const [intelLoading,     setIntelLoading]     = useState(false);
  const [weekFocus,        setWeekFocus]        = useState(null);
  const [weekFocusLoading, setWeekFocusLoading] = useState(false);

  const [calendarEvents,  setCalendarEvents]  = useState([]);
  const [calendarDensity, setCalendarDensity] = useState(null);
  const [plaidData,       setPlaidData]       = useState(null);
  const [weatherForecast, setWeatherForecast] = useState(null);

  // Health check-in
  const [healthCheckin, setHealthCheckin] = useState({ energy: null, sleep: null, exercise: null });
  const [healthSaving,  setHealthSaving]  = useState(false);

  const isAfter5pm = new Date().getHours() >= 17;
  const todayStr   = todayYMD();

  // Load today's health log on mount
  const todayHealthLog = useMemo(() => healthLogs.find(l => l.date === todayStr), [healthLogs, todayStr]);
  useEffect(() => {
    if (todayHealthLog) {
      setHealthCheckin({ energy: todayHealthLog.energy ?? null, sleep: todayHealthLog.sleep ?? null, exercise: todayHealthLog.exercise ?? null });
    }
  }, [todayHealthLog]);

  const handleHealthSave = async (updates) => {
    const next = { ...healthCheckin, ...updates };
    setHealthCheckin(next);
    if (next.energy !== null || next.exercise !== null || next.sleep !== null) {
      setHealthSaving(true);
      try { await saveHealthLog(user.uid, todayStr, next); } finally { setHealthSaving(false); }
    }
  };

  // ── Computed task sets ────────────────────────────────────────────────────

  const carryForwardTasks = useMemo(() => {
    const seen = new Set(); const result = [];
    tasks.forEach(t => {
      if (t.done || t.status === 'dropped') return;
      let past = false;
      if (t.scheduledDate && t.scheduledDate < todayStr) past = true;
      if (!past && t.scheduledStart) {
        const d = new Date(t.scheduledStart);
        const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (ymd < todayStr) past = true;
      }
      const overdue = t.dueDate && t.dueDate < todayStr;
      if ((past || overdue) && !seen.has(t.id)) { seen.add(t.id); result.push(t); }
    });
    const prio = { critical: 0, high: 1, medium: 2, low: 3 };
    return result.sort((a, b) => (prio[a.priority] ?? 2) - (prio[b.priority] ?? 2));
  }, [tasks, todayStr]);

  const scheduledToday = useMemo(() => tasks.filter(t => {
    if (t.done) return false;
    if (t.scheduledDate === todayStr) return true;
    if (t.scheduledStart) {
      const d = new Date(t.scheduledStart);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === todayStr;
    }
    return false;
  }).sort((a, b) => (a.scheduledStart || '').localeCompare(b.scheduledStart || '')), [tasks, todayStr]);

  const todayDayCode = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];

  const priorityTasks = useMemo(() => [...tasks]
    .filter(t => {
      if (t.done) return false;
      if (isTaskBlocked(t, tasks)) return false;
      if (t.priority !== 'critical' && t.priority !== 'high') return false;
      if (t.startDate && t.startDate > todayStr) return false;
      if (t.availableDays?.length > 0 && !t.availableDays.includes(todayDayCode)) return false;
      return true;
    })
    .sort((a, b) => calculateUrgency(b) - calculateUrgency(a)),
  [tasks, todayStr, todayDayCode]);

  // Hero tasks: scheduled today first, fill with top priority — max 5
  const heroTasks = useMemo(() => {
    const seen = new Set(); const result = [];
    for (const t of scheduledToday) {
      if (result.length >= 5) break;
      if (!seen.has(t.id)) { seen.add(t.id); result.push(t); }
    }
    for (const t of priorityTasks) {
      if (result.length >= 5) break;
      if (!seen.has(t.id)) { seen.add(t.id); result.push(t); }
    }
    return result;
  }, [scheduledToday, priorityTasks]);

  // Task aging — untouched 30+ days
  const agedTasks = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return tasks.filter(t => {
      if (t.done) return false;
      const updMs = t.updatedAt?.toDate?.().getTime() ?? (t.updatedAt ? new Date(t.updatedAt).getTime() : null);
      const creMs = t.createdAt?.toDate?.().getTime() ?? (t.createdAt ? new Date(t.createdAt).getTime() : null);
      const lastTouched = updMs || creMs || 0;
      return lastTouched > 0 && lastTouched < cutoff;
    });
  }, [tasks]);

  const deadlineRiskTasks = useMemo(() => {
    const now = new Date(); const in7 = new Date(now.getTime() + 7*24*60*60*1000);
    return tasks.filter(t => {
      if (t.done || !t.dueDate) return false;
      const due = new Date(t.dueDate + 'T23:59:59');
      return due >= now && due <= in7 && !t.scheduledStart && !t.scheduledDate;
    }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }, [tasks]);

  const atRiskThisWeek = useMemo(() => {
    const now = Date.now(); const in5 = now + 5*24*60*60*1000;
    return tasks.filter(t => {
      if (t.done || !t.dueDate) return false;
      const dueMs = new Date(t.dueDate + 'T23:59:59').getTime();
      return dueMs >= now && dueMs <= in5 && (t.priority === 'critical' || t.priority === 'high') && (t.pushCount || 0) >= 2;
    });
  }, [tasks]);

  const driftingGoals = useMemo(() => {
    const now = new Date(); const in60 = new Date(now.getTime() + 60*24*60*60*1000);
    const weekAgo = new Date(now.getTime() - 7*24*60*60*1000);
    return (goals || []).filter(g => {
      if (g.status !== 'active') return false;
      const lowScore = g.likelihoodScore != null && g.likelihoodScore < 40;
      const nearDeadline = g.targetDate && (() => {
        const [y, m] = g.targetDate.split('-').map(Number);
        return new Date(y, m-1, 1) <= in60;
      })();
      if (!lowScore && !nearDeadline) return false;
      const linkedProjIds = (projects || []).filter(p => p.goalId === g.id).map(p => p.id);
      return !tasks.some(t => {
        if (t.done) return false;
        if (t.goalId !== g.id && !linkedProjIds.includes(t.projectId)) return false;
        const upd = t.updatedAt?.toDate?.() || (t.updatedAt ? new Date(t.updatedAt) : new Date(0));
        return upd >= weekAgo;
      });
    });
  }, [goals, tasks, projects]);

  // Sprint nudge — goals where last sprint is 80%+ complete
  const sprintReadyGoals = useMemo(() => {
    return (goals || []).filter(g => {
      if (g.status !== 'active' || !g.lastSprintBatch) return false;
      const sprintTasks = tasks.filter(t => t.sprintBatch === g.lastSprintBatch);
      if (sprintTasks.length === 0) return false;
      const donePct = sprintTasks.filter(t => t.done).length / sprintTasks.length;
      return donePct >= 0.8;
    });
  }, [goals, tasks]);

  const reviewReminderDue = useMemo(() => {
    if (!weeklyReviews?.length) return true;
    const lastMs = weeklyReviews[0].savedAt?.toMillis?.() || (weeklyReviews[0].savedAt ? new Date(weeklyReviews[0].savedAt).getTime() : 0);
    return (Date.now() - lastMs) > 7*24*60*60*1000;
  }, [weeklyReviews]);

  const eodDoneToday     = useMemo(() => (dailyReviews || []).some(r => r.type === 'eod'     && r.date === new Date().toDateString()), [dailyReviews]);
  const morningDoneToday = useMemo(() => (dailyReviews || []).some(r => r.type === 'morning' && r.date === new Date().toDateString()), [dailyReviews]);

  const doneTodayCount = tasks.filter(t => {
    if (!t.done) return false;
    return (t.updatedAt?.toDate?.() || new Date(0)).toDateString() === new Date().toDateString();
  }).length;

  const activeGoals      = (goals || []).filter(g => g.status === 'active');
  const goalsOnTrack     = activeGoals.filter(g => g.likelihoodScore != null && g.likelihoodScore >= 70).length;
  const criticalRemaining = tasks.filter(t => !t.done && t.priority === 'critical').length;

  // Today's habits
  const todayHabits = useMemo(() => {
    if (!habits?.length) return [];
    const todayDow = new Date().getDay();
    return habits.filter(h => {
      if (!h.active && h.active !== undefined) return false;
      if (h.frequency === 'daily') return true;
      if (h.frequency === 'weekdays') return todayDow >= 1 && todayDow <= 5;
      if (h.frequency === 'weekends') return todayDow === 0 || todayDow === 6;
      if (Array.isArray(h.days)) return h.days.includes(todayDow);
      return true;
    });
  }, [habits]);

  const habitsDoneToday = useMemo(() => {
    const todayStr2 = new Date().toDateString(); const doneSet = new Set();
    (habitLogs || []).forEach(log => {
      if (log.date === todayStr2 || (log.completedAt && new Date(log.completedAt?.toDate?.() || log.completedAt).toDateString() === todayStr2)) {
        doneSet.add(log.habitId);
      }
    });
    return doneSet;
  }, [habitLogs]);

  // ── Action Center items ───────────────────────────────────────────────────
  const actionItems = useMemo(() => {
    const items = [];
    if (carryForwardTasks.length > 0) {
      const hi = carryForwardTasks.some(t => t.priority === 'critical' || t.priority === 'high');
      items.push({ id: 'carry-forward', icon: '⚑', urgency: hi ? 'high' : 'medium', label: `${carryForwardTasks.length} task${carryForwardTasks.length > 1 ? 's' : ''} not completed from previous days`, detail: carryForwardTasks.slice(0,3).map(t => t.title).join(' · ') + (carryForwardTasks.length > 3 ? ` +${carryForwardTasks.length-3} more` : ''), actionLabel: 'Reschedule →', actionFn: () => navigate('/calendar') });
    }
    if (atRiskThisWeek.length > 0) items.push({ id: 'at-risk', icon: '⚑', urgency: 'high', label: `${atRiskThisWeek.length} task${atRiskThisWeek.length>1?'s':''} at risk — due soon, pushed repeatedly`, detail: atRiskThisWeek.map(t=>t.title).join(' · '), actionLabel: 'Schedule →', actionFn: () => navigate('/calendar') });
    if (deadlineRiskTasks.length > 0) items.push({ id: 'deadline-risk', icon: '⏱', urgency: 'high', label: `${deadlineRiskTasks.length} unscheduled task${deadlineRiskTasks.length>1?'s':''} due within 7 days`, detail: deadlineRiskTasks.slice(0,2).map(t=>t.title).join(' · ') + (deadlineRiskTasks.length>2 ? ` +${deadlineRiskTasks.length-2} more` : ''), actionLabel: 'Schedule →', actionFn: () => navigate('/calendar') });
    if (driftingGoals.length > 0) items.push({ id: 'drifting-goals', icon: '⚠', urgency: 'medium', label: `${driftingGoals.length} goal${driftingGoals.length>1?'s':''} drifting with no action this week`, detail: driftingGoals.map(g=>`${g.title}${g.likelihoodScore!=null?` (${g.likelihoodScore}%)`:''}`).join(' · '), actionLabel: 'Review →', actionFn: () => navigate('/goals') });
    sprintReadyGoals.forEach(g => {
      items.push({ id: `sprint-${g.id}`, icon: '🏃', urgency: 'medium', label: `"${g.title}" sprint is nearly done — ready for next batch?`, detail: 'Run Rolling Plan to generate next set of tasks', actionLabel: 'Next Sprint →', actionFn: () => navigate(`/goals/${g.id}`) });
    });
    if (agedTasks.length > 0) items.push({ id: 'aged-tasks', icon: '⏳', urgency: 'low', label: `${agedTasks.length} task${agedTasks.length>1?'s':''} untouched for 30+ days`, detail: agedTasks.slice(0,3).map(t=>t.title).join(' · ') + (agedTasks.length>3 ? ` +${agedTasks.length-3} more` : ''), actionLabel: 'Triage →', actionFn: () => navigate('/tasks') });
    if (reviewReminderDue) items.push({ id: 'weekly-review', icon: '📋', urgency: 'medium', label: 'Weekly review overdue', detail: weeklyReviews?.length === 0 ? 'No reviews yet' : 'Last review was over a week ago', actionLabel: 'Review →', actionFn: () => navigate('/review') });
    if (!isAfter5pm && !morningDoneToday) items.push({ id: 'morning-review', icon: '☀', urgency: 'medium', label: 'Morning review not done', detail: 'Set your priorities and must-win for today', actionLabel: 'Start →', actionFn: () => navigate('/review') });
    if (isAfter5pm && !eodDoneToday) items.push({ id: 'eod', icon: '🌙', urgency: 'low', label: 'End-of-Day check-in', detail: "Reflect on today, set tomorrow's intentions", actionLabel: 'Check in →', actionFn: () => navigate('/review?tab=eod') });
    const isSunday = new Date().getDay() === 0;
    if (isSunday) {
      const sundayKey = (() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); return d.toISOString().split('T')[0]; })();
      if (lastWeeklyReset?.weekKey !== sundayKey) items.unshift({ id: 'weekly-reset', icon: '🔄', urgency: 'high', label: 'Sunday Weekly Reset', detail: 'Review goals, triage tasks, check finances, and set your weekly intention', actionLabel: 'Start Reset →', actionFn: () => navigate('/weekly-reset') });
    }
    return items;
  }, [carryForwardTasks, atRiskThisWeek, deadlineRiskTasks, driftingGoals, sprintReadyGoals, agedTasks, reviewReminderDue, morningDoneToday, eodDoneToday, isAfter5pm, weeklyReviews, lastWeeklyReset, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Holistic context ──────────────────────────────────────────────────────
  const getHolisticContext = () => buildHolisticContext({
    goals: goals || [], tasks, projects: projects || [], brainDumps: brainDumps || [],
    weeklyReviews: weeklyReviews || [], userProfile: userProfile || profile,
    calendarDensity, calendarEvents, plaidData, manualCashFlow,
    debtAccounts: debtAccounts || [], assetAccounts: assetAccounts || [],
    weatherForecast, notes: notes || [], savingsAnalysis, savingsHistory,
    habits: habits || [], habitLogs: habitLogs || [], dailyReviews: dailyReviews || [],
    actedOnRecommendations: actedOnRecommendations || [],
  });

  // ── AI fetchers ───────────────────────────────────────────────────────────
  const fetchIntel = async (force = false) => {
    if (intelLoading) return;
    if (!force) {
      try { const c = await getPulseCache(user.uid); if (c) { setIntelData(c); return; } } catch {}
    }
    setIntelLoading(true);
    try {
      const result = await getTodaysPulse({ holisticContext: getHolisticContext(), tasks, goals: goals || [], habits: habits || [], dailyReviews: dailyReviews || [] });
      if (result) { setIntelData(result); savePulseCache(user.uid, result).catch(() => {}); }
    } catch {}
    finally { setIntelLoading(false); }
  };

  const fetchWeekFocus = async () => {
    const cacheKey = 'weeklyFocusCache';
    const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey)); } catch { return null; } })();
    if (cached?.data && Date.now() - cached.ts < 24*60*60*1000) { setWeekFocus(cached.data); return; }
    setWeekFocusLoading(true);
    const data = await getWeeklyFocusStatement({ goals: goals||[], tasks, weeklyReviews: weeklyReviews||[], holisticContext: getHolisticContext() });
    if (data) { setWeekFocus(data); localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() })); }
    setWeekFocusLoading(false);
  };

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchIntel();
    fetchWeekFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function load() {
      if (!calendarIntegration?.connected) return;
      try {
        const token = await getValidAccessToken(user.uid, calendarIntegration);
        if (!token) return;
        const ws = weekStartDate(new Date()); const we = new Date(ws); we.setDate(we.getDate()+7);
        const evs = await getEvents(token, ws.toISOString(), we.toISOString());
        const evList = evs || [];
        const density = {};
        evList.forEach(ev => { if (!ev.start?.dateTime) return; const day = new Date(ev.start.dateTime).toLocaleDateString('en-US', { weekday: 'long' }); density[day] = (density[day]||0)+1; });
        if (Object.keys(density).length > 0) setCalendarDensity(density);
        setCalendarEvents(evList);
      } catch {}
    }
    load();
  }, [calendarIntegration]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function load() {
      if (!plaidItems?.length) return;
      const data = await fetchMonthlyCashFlow(plaidItems);
      if (data) setPlaidData(data);
    }
    load();
  }, [plaidItems]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function load() {
      const zip = userProfile?.zip || DEFAULT_ZIP;
      const data = await fetchWeeklyWeather(zip);
      if (data) setWeatherForecast(data);
    }
    load();
  }, [userProfile?.zip]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Task handlers ─────────────────────────────────────────────────────────
  const handleToggleTask = async (task) => {
    if (!task.done) {
      await updateTask(user.uid, task.id, { done: true, status: 'completed', completedAt: new Date().toISOString() });
      setCompletionNote({ open: true, task, text: '' });
    } else {
      await updateTask(user.uid, task.id, { done: false, status: 'pending', completedAt: null, completionNote: null });
    }
  };

  const handleSaveCompletionNote = async () => {
    if (!completionNote.task) return;
    if (completionNote.text.trim()) await updateTask(user.uid, completionNote.task.id, { completionNote: completionNote.text.trim() });
    setCompletionNote({ open: false, task: null, text: '' });
  };

  const handleEditSave = async (formData) => {
    if (!editingTask) return;
    setEditSaving(true);
    try {
      const updates = { ...formData };
      if (formData.dueDate && editingTask.dueDate && formData.dueDate > editingTask.dueDate) updates.pushCount = (editingTask.pushCount||0)+1;
      if (editingTask.scheduledStart && formData.estimatedMinutes) updates.scheduledEnd = new Date(new Date(editingTask.scheduledStart).getTime() + formData.estimatedMinutes*60000).toISOString();
      await updateTask(user.uid, editingTask.id, updates);
      setEditingTask(null);
    } catch {}
    finally { setEditSaving(false); }
  };

  const handleAutoSave = async (formData) => {
    if (!editingTask) return;
    const updates = { ...formData };
    if (editingTask.scheduledStart && formData.estimatedMinutes) updates.scheduledEnd = new Date(new Date(editingTask.scheduledStart).getTime() + formData.estimatedMinutes*60000).toISOString();
    await updateTask(user.uid, editingTask.id, updates);
  };

  const handleUnschedule = async () => {
    if (!editingTask) return;
    setEditSaving(true);
    try { await updateTask(user.uid, editingTask.id, { status: 'pending', scheduledDate: null, scheduledStart: null, scheduledEnd: null, calendarEventId: null }); setEditingTask(null); }
    catch {}
    finally { setEditSaving(false); }
  };

  // Health check-in config
  const ENERGY_OPTIONS  = [['😴',1],['😕',2],['😐',3],['🙂',4],['⚡',5]];
  const SLEEP_OPTIONS   = [['😫','poor'],['😐','ok'],['😴','good']];
  const EXERCISE_OPTIONS= [['✗', false],['✓', true]];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="fade-up" style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '4px', textTransform: 'uppercase' }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>
              {getGreeting()}, {profile?.firstName || user?.displayName?.split(' ')[0] || 'Andrew'}.
            </h1>
            <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>
              {doneTodayCount > 0 ? `${doneTodayCount} done · ` : ''}{scheduledToday.length > 0 ? `${scheduledToday.length} scheduled · ` : ''}{criticalRemaining > 0 ? `${criticalRemaining} critical left` : 'No critical tasks'}
            </p>
            {weatherForecast?.forecast?.[0] && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', marginTop: '8px', padding: '4px 12px 4px 8px', background: tokens.bgGlass, border: `1px solid ${tokens.border}`, borderRadius: '20px', fontSize: '12px' }}>
                <span style={{ fontSize: '18px', lineHeight: 1 }}>{weatherCodeToEmoji(weatherForecast.forecast[0].code)}</span>
                <span style={{ fontWeight: 700, color: tokens.textPrimary }}>{weatherForecast.forecast[0].maxTemp}°F</span>
                <span style={{ color: tokens.textSecondary }}>{weatherForecast.forecast[0].label}</span>
                {weatherForecast.location && <span style={{ color: tokens.textMuted }}>· {weatherForecast.location}</span>}
              </div>
            )}
          </div>
          <button onClick={() => setPlanOpen(true)}
            style={{ background: tokens.accentDim, color: tokens.accent, border: `1px solid ${tokens.accentDim}`, borderRadius: '10px', padding: '9px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body, flexShrink: 0, whiteSpace: 'nowrap', marginTop: '4px', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = tokens.accent; e.currentTarget.style.color = tokens.bgCard; }}
            onMouseLeave={e => { e.currentTarget.style.background = tokens.accentDim; e.currentTarget.style.color = tokens.accent; }}>
            ✦ Plan My Day
          </button>
        </div>
      </div>

      {/* ── Health Check-in (compact row) ────────────────────────────────── */}
      <div className="fade-up stagger-1" style={{ marginBottom: '14px' }}>
        <div style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0 }}>
            Today's Check-in {healthSaving && <span style={{ fontWeight: 400, color: tokens.accent }}>saving…</span>}
          </div>
          {/* Energy */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: tokens.textMuted }}>Energy</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {ENERGY_OPTIONS.map(([emoji, val]) => (
                <button key={val} onClick={() => handleHealthSave({ energy: val })}
                  style={{ fontSize: '16px', lineHeight: 1, background: healthCheckin.energy === val ? tokens.accentDim : 'transparent', border: `1px solid ${healthCheckin.energy === val ? tokens.accent : tokens.border}`, borderRadius: '6px', padding: '3px 5px', cursor: 'pointer', transition: 'all 0.12s', opacity: healthCheckin.energy && healthCheckin.energy !== val ? 0.4 : 1 }}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          {/* Sleep */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: tokens.textMuted }}>Sleep</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {SLEEP_OPTIONS.map(([emoji, val]) => (
                <button key={val} onClick={() => handleHealthSave({ sleep: val })}
                  style={{ fontSize: '16px', lineHeight: 1, background: healthCheckin.sleep === val ? tokens.accentDim : 'transparent', border: `1px solid ${healthCheckin.sleep === val ? tokens.accent : tokens.border}`, borderRadius: '6px', padding: '3px 5px', cursor: 'pointer', transition: 'all 0.12s', opacity: healthCheckin.sleep && healthCheckin.sleep !== val ? 0.4 : 1 }}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          {/* Exercise */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: tokens.textMuted }}>Exercise</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {EXERCISE_OPTIONS.map(([emoji, val]) => (
                <button key={String(val)} onClick={() => handleHealthSave({ exercise: val })}
                  style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1, background: healthCheckin.exercise === val ? tokens.accentDim : 'transparent', border: `1px solid ${healthCheckin.exercise === val ? tokens.accent : tokens.border}`, borderRadius: '6px', padding: '3px 8px', cursor: 'pointer', transition: 'all 0.12s', color: healthCheckin.exercise === val ? tokens.accent : tokens.textMuted, opacity: healthCheckin.exercise !== null && healthCheckin.exercise !== val ? 0.4 : 1 }}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Action Center ─────────────────────────────────────────────────── */}
      {actionItems.length > 0 && (
        <div className="fade-up stagger-2" style={{ marginBottom: '14px' }}>
          <div style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', overflow: 'hidden' }}>
            <div onClick={() => setActionCenterOpen(o => !o)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', cursor: 'pointer', userSelect: 'none', borderBottom: actionCenterOpen ? `1px solid ${tokens.border}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: tokens.textPrimary }}>⚡ Action Center</span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: tokens.accent, background: tokens.accentDim, padding: '1px 8px', borderRadius: '99px' }}>{actionItems.length}</span>
              </div>
              <span style={{ fontSize: '11px', color: tokens.textMuted }}>{actionCenterOpen ? '▲' : '▾'}</span>
            </div>
            {actionCenterOpen && actionItems.map((item, i) => {
              const uc  = item.urgency === 'high' ? tokens.red : item.urgency === 'medium' ? tokens.amber : tokens.accent;
              const ubg = item.urgency === 'high' ? `${tokens.red}12` : item.urgency === 'medium' ? tokens.amberDim : tokens.accentDim;
              return (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: i < actionItems.length-1 ? `1px solid ${tokens.border}` : 'none', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '1px' }}><span style={{ marginRight: '5px' }}>{item.icon}</span>{item.label}</div>
                    {item.detail && <div style={{ fontSize: '11px', color: tokens.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.detail}</div>}
                  </div>
                  <button onClick={item.actionFn} style={{ background: ubg, color: uc, border: `1px solid ${uc}30`, borderRadius: '8px', padding: '5px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body, flexShrink: 0, whiteSpace: 'nowrap' }}>{item.actionLabel}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Today's Top Tasks ─────────────────────────────────────────────── */}
      <div className="fade-up stagger-3" style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Today's Focus
          </div>
          <button onClick={() => navigate('/tasks')} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer', fontFamily: fonts.body }}>All tasks →</button>
        </div>

        {heroTasks.length === 0 ? (
          <div style={{ padding: '20px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: tokens.textMuted }}>No tasks scheduled or prioritized for today.</div>
            <button onClick={() => navigate('/tasks')} style={{ marginTop: '10px', background: tokens.accentDim, color: tokens.accent, border: 'none', borderRadius: '8px', padding: '7px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body }}>Add tasks →</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {heroTasks.map(task => {
              const accentColor = PRIORITY_ACCENT[task.priority] || tokens.accent;
              const isScheduled = task.scheduledStart || task.scheduledDate === todayStr;
              return (
                <div key={task.id}
                  onClick={() => setEditingTask(task)}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderLeft: `3px solid ${task.done ? tokens.green : accentColor}`, borderRadius: '10px', cursor: 'pointer', transition: 'all 0.12s', opacity: task.done ? 0.6 : 1 }}
                  onMouseEnter={e => e.currentTarget.style.background = tokens.bgCardHover}
                  onMouseLeave={e => e.currentTarget.style.background = tokens.bgCard}>
                  <div onClick={e => { e.stopPropagation(); handleToggleTask(task); }}
                    style={{ width: 22, height: 22, borderRadius: '6px', flexShrink: 0, border: `2px solid ${task.done ? tokens.green : accentColor}`, background: task.done ? tokens.greenDim : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '11px', color: tokens.green, transition: 'all 0.15s' }}>
                    {task.done ? '✓' : ''}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary, textDecoration: task.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.title}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '3px', flexWrap: 'wrap' }}>
                      {isScheduled && task.scheduledStart && <span style={{ fontSize: '11px', color: tokens.blue, fontWeight: 600 }}>{formatTime(task.scheduledStart)}</span>}
                      {isScheduled && !task.scheduledStart && <span style={{ fontSize: '11px', color: tokens.textMuted }}>All day</span>}
                      <span style={{ fontSize: '11px', color: tokens.textMuted }}>{task.project || 'Inbox'}</span>
                      {task.dueDate && <span style={{ fontSize: '11px', color: new Date(task.dueDate) < new Date() ? tokens.red : tokens.textMuted }}>due {task.dueDate}</span>}
                      {task.estimatedMinutes && <span style={{ fontSize: '11px', color: tokens.textMuted }}>⏱ {task.estimatedMinutes}m</span>}
                    </div>
                  </div>
                  <Tag label={task.priority} color={priorityColors[task.priority]?.bg} textColor={priorityColors[task.priority]?.text} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Today's Intel ─────────────────────────────────────────────────── */}
      <div className="fade-up stagger-4" style={{ marginBottom: '14px' }}>
        <div style={{ background: `linear-gradient(135deg, ${tokens.accentGlow} 0%, transparent 100%)`, border: `1px solid ${tokens.accentDim}`, borderRadius: '12px', padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: `radial-gradient(circle, ${tokens.accentGlow} 0%, transparent 70%)`, pointerEvents: 'none' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: 26, height: 26, borderRadius: '7px', background: tokens.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>✦</div>
              <span style={{ fontSize: '10px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Today's Intel</span>
            </div>
            <button onClick={() => { setIntelData(null); fetchIntel(true); }} disabled={intelLoading}
              style={{ background: 'none', border: 'none', fontSize: '13px', color: intelLoading ? tokens.textMuted : tokens.accent, cursor: intelLoading ? 'default' : 'pointer', opacity: intelLoading ? 0.5 : 1, fontFamily: fonts.body }}>
              {intelLoading ? '...' : '↻'}
            </button>
          </div>
          {intelLoading && !intelData && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Spinner size={13} />
              <span style={{ fontSize: '12px', color: tokens.textMuted }}>Reading your day...</span>
            </div>
          )}
          {intelData && (
            <>
              {intelData.headline && <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary, lineHeight: 1.5, marginBottom: '10px' }}>{intelData.headline}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(intelData.items || []).map((item, i) => {
                  const typeColor = item.type === 'risk' ? tokens.red : item.type === 'opportunity' ? tokens.green : item.type === 'finance' ? tokens.green : tokens.amber;
                  return (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', background: tokens.bgCardHover, borderRadius: '8px' }}>
                      <span style={{ fontSize: '13px', flexShrink: 0, color: typeColor }}>{item.icon}</span>
                      <span style={{ flex: 1, fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.55 }}>{item.text}</span>
                      {item.actionLabel && item.link && (
                        <button onClick={() => navigate(item.link)} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer', fontFamily: fonts.body, flexShrink: 0, fontWeight: 600, padding: 0 }}>{item.actionLabel}</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {!intelData && !intelLoading && (
            <button onClick={() => fetchIntel(true)} style={{ fontSize: '12px', color: tokens.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.body }}>Generate intel →</button>
          )}
        </div>
      </div>

      {/* ── This Week ─────────────────────────────────────────────────────── */}
      <div className="fade-up stagger-5" style={{ marginBottom: '14px' }}>
        <div style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', overflow: 'hidden' }}>
          <div onClick={() => setWeekExpanded(o => !o)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '3px' }}>This Week</div>
              <div style={{ fontSize: '13px', color: weekFocus?.headline ? tokens.textPrimary : tokens.textMuted, fontWeight: weekFocus?.headline ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {weekFocusLoading ? 'Analyzing...' : weekFocus?.headline || 'No focus set yet'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '12px', flexShrink: 0 }}>
              {criticalRemaining > 0 && <span style={{ fontSize: '10px', fontWeight: 700, color: tokens.red, background: `${tokens.red}15`, padding: '2px 8px', borderRadius: '99px' }}>{criticalRemaining} critical</span>}
              {activeGoals.length > 0 && <span style={{ fontSize: '10px', fontWeight: 700, color: tokens.green, background: tokens.greenDim, padding: '2px 8px', borderRadius: '99px' }}>{goalsOnTrack}/{activeGoals.length} goals</span>}
              <span style={{ fontSize: '11px', color: tokens.textMuted, marginLeft: '4px' }}>{weekExpanded ? '▲' : '▾'}</span>
            </div>
          </div>
          {weekExpanded && weekFocus && (
            <div style={{ padding: '0 16px 14px', borderTop: `1px solid ${tokens.border}`, paddingTop: '12px' }}>
              {weekFocus.thisWeekFocus?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: weekFocus.whatToIgnore ? '12px' : 0 }}>
                  {weekFocus.thisWeekFocus.map((action, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: tokens.accent, background: tokens.accentDim, borderRadius: '4px', padding: '2px 7px', flexShrink: 0, marginTop: '1px', fontFamily: 'monospace' }}>{i+1}</span>
                      <span style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.45 }}>{action}</span>
                    </div>
                  ))}
                </div>
              )}
              {weekFocus.whatToIgnore && (
                <div style={{ padding: '9px 13px', background: tokens.amberDim, borderRadius: '8px', border: `1px solid ${tokens.amber}30` }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: tokens.amber, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Ignore This Week: </span>
                  <span style={{ fontSize: '12px', color: tokens.textSecondary }}>{weekFocus.whatToIgnore}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button onClick={e => { e.stopPropagation(); localStorage.removeItem('weeklyFocusCache'); setWeekFocus(null); fetchWeekFocus(); }} style={{ fontSize: '11px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontWeight: 600, fontFamily: fonts.body }}>↻ Refresh</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Habits ────────────────────────────────────────────────────────── */}
      {todayHabits.length > 0 && (
        <div className="fade-up stagger-5" style={{ marginBottom: '14px' }}>
          <div style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Habits Today — {habitsDoneToday.size}/{todayHabits.length} done
              </div>
              <button onClick={() => navigate('/habits')} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer', fontFamily: fonts.body }}>All →</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {todayHabits.map(habit => {
                const done = habitsDoneToday.has(habit.id);
                return (
                  <div key={habit.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', background: done ? tokens.greenDim : tokens.bgCardHover, border: `1px solid ${done ? tokens.green : tokens.border}`, fontSize: '12px', color: done ? tokens.green : tokens.textSecondary, fontWeight: done ? 600 : 400, transition: 'all 0.15s' }}>
                    {done && <span style={{ fontSize: '10px' }}>✓</span>}
                    <span>{habit.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Plan Schedule Wizard ──────────────────────────────────────────── */}
      <PlanScheduleFlow open={planOpen} onClose={() => setPlanOpen(false)} calendarIntegration={calendarIntegration} weatherForecast={weatherForecast} />

      {/* ── Completion Note Modal ─────────────────────────────────────────── */}
      <Modal open={completionNote.open} onClose={handleSaveCompletionNote} title="Task Done ✓">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>{completionNote.task?.title}</div>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.5 }}>What did you find, learn, or decide? <span style={{ color: tokens.textMuted }}>(optional)</span></div>
          <textarea value={completionNote.text} onChange={e => setCompletionNote(n => ({ ...n, text: e.target.value }))} placeholder="e.g. CPA confirmed filing..." autoFocus rows={3}
            style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus} onBlur={e => e.target.style.borderColor = tokens.border}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveCompletionNote(); }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => setCompletionNote({ open: false, task: null, text: '' })}>Skip</Button>
            <Button onClick={handleSaveCompletionNote}>Save Note</Button>
          </div>
        </div>
      </Modal>

      <TaskModal
        open={!!editingTask}
        onClose={() => setEditingTask(null)}
        onSave={handleEditSave}
        onAutoSave={handleAutoSave}
        task={editingTask}
        saving={editSaving}
        extraActions={editingTask?.scheduledStart ? (
          <Button variant="ghost" onClick={handleUnschedule} loading={editSaving} style={{ color: tokens.red }}>Unschedule</Button>
        ) : null}
      />

    </div>
  );
}
