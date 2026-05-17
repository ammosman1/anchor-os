// src/components/screens/HomeScreen.js
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getAIFocusRecommendation, getWeeklyFocusStatement } from '../../lib/ai';
import { buildHolisticContext } from '../../lib/aiContext';
import { updateTask, addTask, saveProfile } from '../../lib/db';
import { getValidAccessToken, getEvents } from '../../lib/calendar';
import { calculateMomentum } from '../../lib/momentum';
import { calculateUrgency } from '../../lib/tasks';
import { fetchMonthlyCashFlow } from '../../lib/plaid';
import { fetchWeeklyWeather, isOutdoorTask } from '../../lib/weather';
import {
  Card, AICard, SectionLabel, MomentumBar, Tag, Button,
  EmptyState, priorityColors, Modal, Input,
} from '../ui';
import PlanScheduleFlow from './PlanScheduleFlow';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getDateString() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
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
  d.setHours(0, 0, 0, 0);
  return d;
}

const QUOTES = [
  { text: "Momentum matters. Action beats overthinking.", attr: "" },
  { text: "Systems outperform willpower.", attr: "" },
  { text: "Clarity reduces stress. Simplicity is powerful.", attr: "" },
  { text: "Small operational improvements compound massively over time.", attr: "" },
  { text: "The successful warrior is the average man, with laser-like focus.", attr: "Bruce Lee" },
  { text: "What's the bottleneck? Fix it. Everything else is noise.", attr: "" },
  { text: "Great execution creates opportunity.", attr: "" },
];

export default function HomeScreen() {
  const { user, profile, updateProfile } = useAuth();
  const { tasks, activeProjects, totalDebt, goals, calendarIntegration, projects, weeklyReviews, brainDumps, userProfile, plaidItems } = useData();
  const navigate = useNavigate();

  const [energy,      setEnergy]      = useState(profile?.energyToday || 7);
  const [aiText,      setAiText]      = useState('');
  const [aiLoading,   setAiLoading]   = useState(false);
  const [quickTask,   setQuickTask]   = useState('');
  const [addingTask,  setAddingTask]  = useState(false);
  const [planOpen,    setPlanOpen]    = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editForm,    setEditForm]    = useState({});
  const [editSaving,    setEditSaving]    = useState(false);
  const [weekFocus,     setWeekFocus]     = useState(null);
  const [weekFocusLoading, setWeekFocusLoading] = useState(false);
  const [quote]                         = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);

  // AI feedback state
  const [feedbackOpen,    setFeedbackOpen]    = useState(false);
  const [feedbackKey,     setFeedbackKey]     = useState('');
  const [feedbackText,    setFeedbackText]    = useState('');
  const [feedbackSaving,  setFeedbackSaving]  = useState(false);
  const [calendarDensity,  setCalendarDensity]  = useState(null);
  const [plaidData,        setPlaidData]        = useState(null);
  const [weatherForecast,  setWeatherForecast]  = useState(null);

  const isAfter5pm = new Date().getHours() >= 17;
  const todayStr   = todayYMD();

  // Yesterday's incomplete high-priority tasks (morning rework banner)
  const yesterdayStr = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }, []);

  const reworkTasks = useMemo(() =>
    tasks.filter(t =>
      !t.done &&
      t.scheduledDate === yesterdayStr &&
      (t.priority === 'critical' || t.priority === 'high')
    ),
  [tasks, yesterdayStr]);

  // Today's scheduled tasks — catches both date-only and timed schedules
  const scheduledToday = tasks.filter(t => {
    if (t.done) return false;
    if (t.scheduledDate === todayStr) return true;
    if (t.scheduledStart) {
      const d = new Date(t.scheduledStart);
      const localYmd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (localYmd === todayStr) return true;
    }
    return false;
  }).sort((a, b) => (a.scheduledStart || '').localeCompare(b.scheduledStart || ''));

  // Priority tasks sorted by urgency score
  const todayTasks = [...tasks]
    .filter(t => !t.done && (t.priority === 'critical' || t.priority === 'high' || t.source === 'brain-dump' || !t.projectId))
    .sort((a, b) => calculateUrgency(b) - calculateUrgency(a));

  const top3    = todayTasks.slice(0, 3);
  const mustWin = top3.find(t => t.priority === 'critical') || top3[0];

  const doneTodayCount = tasks.filter(t => {
    if (!t.done) return false;
    const updated = t.updatedAt?.toDate?.() || new Date(0);
    return updated.toDateString() === new Date().toDateString();
  }).length;

  // Deadline risk: unscheduled tasks due within 7 days
  const deadlineRiskTasks = useMemo(() => {
    const now = new Date();
    const in7  = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return tasks.filter(t => {
      if (t.done || !t.dueDate) return false;
      const due = new Date(t.dueDate + 'T23:59:59');
      return due >= now && due <= in7 && !t.scheduledStart && !t.scheduledDate;
    }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }, [tasks]);

  // At-risk this week: high/critical tasks that have been chronically deferred AND are due within 5 days
  const atRiskThisWeek = useMemo(() => {
    const now = Date.now();
    const in5 = now + 5 * 24 * 60 * 60 * 1000;
    return tasks.filter(t => {
      if (t.done || !t.dueDate) return false;
      const dueMs = new Date(t.dueDate + 'T23:59:59').getTime();
      if (dueMs < now || dueMs > in5) return false;
      const isHighPriority = t.priority === 'critical' || t.priority === 'high';
      return isHighPriority && (t.pushCount || 0) >= 2;
    }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }, [tasks]);

  // Weekly review reminder — show if no review in last 7 days
  const reviewReminderDue = useMemo(() => {
    if (!weeklyReviews) return false;
    if (weeklyReviews.length === 0) return true;
    const lastMs = weeklyReviews[0].savedAt?.toMillis?.() ||
      (weeklyReviews[0].savedAt ? new Date(weeklyReviews[0].savedAt).getTime() : 0);
    return (Date.now() - lastMs) > 7 * 24 * 60 * 60 * 1000;
  }, [weeklyReviews]);

  // Compute display-active projects: includes stalled projects with momentum > 50
  // (same displayStatus logic as ProjectsScreen, avoids DataContext auto-stall hiding real activity)
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
      .sort((a, b) => b._mScore - a._mScore);
  }, [projects, tasks]);

  // Goal trajectory
  const activeGoals   = (goals || []).filter(g => g.status === 'active');
  const scoredGoals   = activeGoals.filter(g => g.likelihoodScore != null);
  const onTrackGoals  = scoredGoals.filter(g => g.likelihoodScore >= 70);
  const possibleGoals = scoredGoals.filter(g => g.likelihoodScore >= 50 && g.likelihoodScore < 70);
  const atRiskGoals   = scoredGoals.filter(g => g.likelihoodScore < 50).sort((a, b) => a.likelihoodScore - b.likelihoodScore);

  const getHolisticContext = () => buildHolisticContext({
    goals:          goals || [],
    tasks,
    projects:       projects || [],
    brainDumps:     brainDumps || [],
    weeklyReviews:  weeklyReviews || [],
    userProfile:    userProfile || profile,
    calendarDensity,
    plaidData,
    weatherForecast,
  });

  const fetchAI = async () => {
    setAiLoading(true);
    const text = await getAIFocusRecommendation({
      energy,
      topTasks:         top3,
      projects:         activeProjects,
      holisticContext:  getHolisticContext(),
    });
    setAiText(text || 'Focus on your single highest-leverage task. Everything else can wait.');
    setAiLoading(false);
  };

  const fetchWeekFocus = async () => {
    const cacheKey = 'weeklyFocusCache';
    const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey)); } catch { return null; } })();
    if (cached?.data && Date.now() - cached.ts < 24 * 60 * 60 * 1000) {
      setWeekFocus(cached.data);
      return;
    }
    setWeekFocusLoading(true);
    const data = await getWeeklyFocusStatement({
      goals:           goals || [],
      tasks,
      weeklyReviews:   weeklyReviews || [],
      holisticContext: getHolisticContext(),
    });
    if (data) {
      setWeekFocus(data);
      localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
    }
    setWeekFocusLoading(false);
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim()) return;
    setFeedbackSaving(true);
    try {
      const existing    = userProfile?.aiFeedback || profile?.aiFeedback || {};
      const newFeedback = { ...existing, [feedbackKey]: feedbackText.trim() };
      await saveProfile(user.uid, { aiFeedback: newFeedback });
      await updateProfile({ aiFeedback: newFeedback });
      setFeedbackOpen(false);
      setFeedbackText('');
      // Re-generate the relevant content
      if (feedbackKey === 'briefing') fetchAI();
      else if (feedbackKey === 'weekFocus') { localStorage.removeItem('weeklyFocusCache'); setWeekFocus(null); fetchWeekFocus(); }
    } catch (err) {
      console.error('Feedback save error:', err);
    } finally {
      setFeedbackSaving(false);
    }
  };

  useEffect(() => {
    fetchAI();
    fetchWeekFocus();
    // eslint-disable-next-line
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
        const density = {};
        (evs || []).forEach(ev => {
          if (!ev.start?.dateTime) return;
          const day = new Date(ev.start.dateTime).toLocaleDateString('en-US', { weekday: 'long' });
          density[day] = (density[day] || 0) + 1;
        });
        if (Object.keys(density).length > 0) {
          setCalendarDensity(density);
          try { sessionStorage.setItem('calendarDensity', JSON.stringify(density)); } catch {}
        }
      } catch { /* optional enhancement — fail silently */ }
    }
    fetchDensity();
    // eslint-disable-next-line
  }, [calendarIntegration]);

  useEffect(() => {
    async function loadPlaid() {
      if (!plaidItems?.length) return;
      const data = await fetchMonthlyCashFlow(plaidItems);
      if (data) setPlaidData(data);
    }
    loadPlaid();
    // eslint-disable-next-line
  }, [plaidItems]);

  useEffect(() => {
    async function loadWeather() {
      const data = await fetchWeeklyWeather('50063');
      if (data) setWeatherForecast(data);
    }
    loadWeather();
  }, []);

  const handleEnergyChange = async (val) => {
    setEnergy(val);
    await updateProfile({ energyToday: val, energyDate: new Date().toDateString() });
  };

  const handleToggleTask = async (task) => {
    if (!task.done) {
      await updateTask(user.uid, task.id, { done: true, status: 'completed', completedAt: new Date().toISOString() });
    } else {
      await updateTask(user.uid, task.id, { done: false, status: 'pending', completedAt: null });
    }
  };

  const handleQuickAdd = async () => {
    if (!quickTask.trim()) return;
    setAddingTask(true);
    await addTask(user.uid, {
      title: quickTask.trim(),
      priority: 'high',
      project: 'Inbox',
      energy: 'medium',
      source: 'quick-capture',
      status: 'pending',
    });
    setQuickTask('');
    setAddingTask(false);
  };

  const openEdit = (task) => {
    setEditingTask(task);
    setEditForm({
      title:            task.title || '',
      priority:         task.priority || 'medium',
      dueDate:          task.dueDate || '',
      estimatedMinutes: task.estimatedMinutes || '',
      notes:            task.notes || '',
      project:          task.project || 'Inbox',
    });
  };

  const handleEditSave = async () => {
    if (!editingTask || !editForm.title.trim()) return;
    setEditSaving(true);
    const linked = (projects || []).find(p => p.title === editForm.project);
    try {
      const newMins = editForm.estimatedMinutes ? Number(editForm.estimatedMinutes) : null;
      const updates = {
        title:            editForm.title.trim(),
        priority:         editForm.priority,
        dueDate:          editForm.dueDate || null,
        estimatedMinutes: newMins,
        notes:            editForm.notes,
        project:          editForm.project,
        projectId:        linked?.id || editingTask.projectId || null,
      };
      // Track dueDate pushes
      if (editForm.dueDate && editingTask.dueDate && editForm.dueDate > editingTask.dueDate) {
        updates.pushCount = (editingTask.pushCount || 0) + 1;
      }
      // Recalculate end time when duration changes and task has a time slot
      if (editingTask.scheduledStart && newMins) {
        updates.scheduledEnd = new Date(new Date(editingTask.scheduledStart).getTime() + newMins * 60000).toISOString();
      }
      await updateTask(user.uid, editingTask.id, updates);
      setEditingTask(null);
    } catch (err) {
      console.error('Edit save error:', err);
    } finally {
      setEditSaving(false);
    }
  };

  const handleUnschedule = async () => {
    if (!editingTask) return;
    setEditSaving(true);
    try {
      await updateTask(user.uid, editingTask.id, {
        status:         'pending',
        scheduledDate:  null,
        scheduledStart: null,
        scheduledEnd:   null,
        calendarEventId: null,
      });
      setEditingTask(null);
    } catch (err) {
      console.error('Unschedule error:', err);
    } finally {
      setEditSaving(false);
    }
  };

  const momentumColor = (m) => m >= 65 ? tokens.green : m >= 35 ? tokens.accent : tokens.red;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>

      {/* Header */}
      <div className="fade-up" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '4px', textTransform: 'uppercase' }}>
              {getDateString()}
            </div>
            <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>
              {getGreeting()}, {profile?.firstName || 'Andrew'}.
            </h1>
            <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>
              {doneTodayCount > 0 ? `${doneTodayCount} done today · ` : ''}{scheduledToday.length > 0 ? `${scheduledToday.length} scheduled · ` : ''}{top3.length} priorities on deck.
            </p>
          </div>
          <button onClick={() => setPlanOpen(true)}
            style={{ background: tokens.accentDim, color: tokens.accent, border: `1px solid ${tokens.accentDim}`, borderRadius: '10px', padding: '9px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body, flexShrink: 0, whiteSpace: 'nowrap', marginTop: '4px', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = tokens.accent; e.currentTarget.style.color = tokens.bgCard; }}
            onMouseLeave={e => { e.currentTarget.style.background = tokens.accentDim; e.currentTarget.style.color = tokens.accent; }}>
            ✦ Plan My Day
          </button>
        </div>
      </div>

      {/* Morning rework banner — only when high-priority tasks weren't completed yesterday */}
      {reworkTasks.length > 0 && (
        <div className="fade-up stagger-1" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: tokens.amberDim, border: `1px solid ${tokens.amber}`, borderRadius: '12px' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: tokens.amber, marginBottom: '2px' }}>
                ⚑ {reworkTasks.length} high-priority task{reworkTasks.length > 1 ? 's' : ''} not completed yesterday
              </div>
              <div style={{ fontSize: '12px', color: tokens.textSecondary }}>
                {reworkTasks.map(t => t.title).join(' · ')}
              </div>
            </div>
            <button onClick={() => setPlanOpen(true)}
              style={{ background: tokens.amber, color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body, flexShrink: 0, marginLeft: '12px', whiteSpace: 'nowrap' }}>
              Rework Schedule
            </button>
          </div>
        </div>
      )}

      {/* At Risk This Week — chronic deferral + imminent deadline */}
      {atRiskThisWeek.length > 0 && (
        <div className="fade-up stagger-1" style={{ marginBottom: '14px' }}>
          <div style={{ padding: '12px 18px', background: 'rgba(212,122,107,0.1)', border: `1px solid rgba(212,122,107,0.4)`, borderRadius: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: tokens.red, marginBottom: '6px' }}>
              ⚑ At Risk This Week
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
              {atRiskThisWeek.map(t => (
                <div key={t.id} style={{ fontSize: '12px', color: tokens.textSecondary, display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: tokens.textPrimary }}>{t.title}</span>
                  <span style={{ color: tokens.red }}>due {t.dueDate}</span>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: tokens.red, background: 'rgba(212,122,107,0.15)', padding: '1px 5px', borderRadius: '3px' }}>↻{t.pushCount}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '11px', color: tokens.textMuted }}>These tasks have been pushed multiple times — they need real time blocked today.</div>
          </div>
        </div>
      )}

      {/* Weekly Review Reminder */}
      {reviewReminderDue && (
        <div className="fade-up stagger-1" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: tokens.accentDim, border: `1px solid rgba(200,169,110,0.3)`, borderRadius: '12px' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: tokens.accent, marginBottom: '2px' }}>
                📋 Weekly review overdue
              </div>
              <div style={{ fontSize: '12px', color: tokens.textSecondary }}>
                {weeklyReviews?.length === 0 ? 'No reviews yet — start your first weekly review.' : 'Last review was over a week ago. Stay on track with a quick check-in.'}
              </div>
            </div>
            <button onClick={() => navigate('/review')}
              style={{ background: tokens.accent, color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body, flexShrink: 0, marginLeft: '12px', whiteSpace: 'nowrap' }}>
              Review →
            </button>
          </div>
        </div>
      )}

      {/* Outdoor task weather warning */}
      {weatherForecast && (() => {
        const tomorrow = weatherForecast.forecast?.[1];
        const outdoorTasksScheduled = tasks.filter(t => !t.done && isOutdoorTask(t) && (t.scheduledDate === todayStr || t.scheduledDate === (tomorrow?.date)));
        const badDayTasks = outdoorTasksScheduled.filter(t => {
          const dayForecast = weatherForecast.forecast?.find(d => d.date === t.scheduledDate);
          return dayForecast && !dayForecast.outdoorFriendly;
        });
        if (badDayTasks.length === 0) return null;
        const badDay = weatherForecast.forecast?.find(d => d.date === badDayTasks[0].scheduledDate);
        return (
          <div className="fade-up stagger-1" style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 18px', background: tokens.blueDim, border: `1px solid ${tokens.blue}30`, borderRadius: '12px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: tokens.blue, marginBottom: '2px' }}>
                  🌧 Weather alert — outdoor tasks may need rescheduling
                </div>
                <div style={{ fontSize: '12px', color: tokens.textSecondary }}>
                  {badDay?.label}, {badDay?.maxTemp}°F, {badDay?.precipProbability}% rain on {badDay?.date} · {badDayTasks.map(t => t.title).join(', ')}
                </div>
              </div>
              <button onClick={() => setPlanOpen(true)}
                style={{ background: tokens.blue, color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body, flexShrink: 0, marginLeft: '12px', whiteSpace: 'nowrap' }}>
                Reschedule →
              </button>
            </div>
          </div>
        );
      })()}

      {/* Deadline Risk Banner */}
      {deadlineRiskTasks.length > 0 && (
        <div className="fade-up stagger-1" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: tokens.redDim, border: `1px solid ${tokens.red}30`, borderRadius: '12px' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: tokens.red, marginBottom: '2px' }}>
                ⏱ {deadlineRiskTasks.length} unscheduled task{deadlineRiskTasks.length > 1 ? 's' : ''} due within 7 days
              </div>
              <div style={{ fontSize: '12px', color: tokens.textSecondary }}>
                {deadlineRiskTasks.slice(0, 2).map(t => t.title).join(' · ')}{deadlineRiskTasks.length > 2 ? ` +${deadlineRiskTasks.length - 2} more` : ''}
              </div>
            </div>
            <button onClick={() => setPlanOpen(true)}
              style={{ background: tokens.red, color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body, flexShrink: 0, marginLeft: '12px', whiteSpace: 'nowrap' }}>
              Schedule →
            </button>
          </div>
        </div>
      )}

      {/* Quick Capture */}
      <div className="fade-up stagger-1" style={{ marginBottom: '14px' }}>
        <div style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg, padding: '14px 16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '16px', flexShrink: 0 }}>⚡</span>
          <input
            value={quickTask}
            onChange={e => setQuickTask(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }}
            placeholder="Quick capture — what's on your mind?"
            style={{ flex: 1, background: 'transparent', border: 'none', color: tokens.textPrimary, fontSize: '14px', outline: 'none', fontFamily: fonts.body }}
          />
          {quickTask.trim() ? (
            <button onClick={handleQuickAdd} disabled={addingTask}
              style={{ background: tokens.accent, color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', flexShrink: 0, fontFamily: fonts.body }}>
              {addingTask ? '...' : 'Add'}
            </button>
          ) : (
            <button onClick={() => navigate('/brain-dump')}
              style={{ background: tokens.accentDim, color: tokens.accent, border: 'none', borderRadius: '6px', padding: '6px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', flexShrink: 0, fontFamily: fonts.body, whiteSpace: 'nowrap' }}>
              Full Dump →
            </button>
          )}
        </div>
      </div>

      {/* AI Daily Briefing — primary card */}
      <div className="fade-up stagger-2" style={{ marginBottom: '14px' }}>
        <AICard
          text={aiText || 'Generating your daily briefing...'}
          loading={aiLoading}
          onRefresh={fetchAI}
          label="DAILY BRIEFING"
          feedbackButtons={!aiLoading && aiText ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button title="Accurate" style={{ background: 'transparent', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '3px 9px', fontSize: '12px', cursor: 'pointer', color: tokens.textMuted, fontFamily: fonts.body }}>👍</button>
              <button title="Give feedback" onClick={() => { setFeedbackKey('briefing'); setFeedbackOpen(true); }} style={{ background: 'transparent', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '3px 9px', fontSize: '12px', cursor: 'pointer', color: tokens.textMuted, fontFamily: fonts.body }}>👎</button>
            </div>
          ) : null}
        />
      </div>

      {/* Today's Scheduled Tasks */}
      {scheduledToday.length > 0 && (
        <div className="fade-up stagger-2" style={{ marginBottom: '14px' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <SectionLabel style={{ marginBottom: 0 }}>Scheduled Today</SectionLabel>
              <button onClick={() => navigate('/calendar')} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer' }}>Calendar →</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {scheduledToday.map(task => (
                <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}`, cursor: 'pointer', transition: 'background 0.12s' }}
                  onClick={() => openEdit(task)}
                  onMouseEnter={e => e.currentTarget.style.background = tokens.bgCardHover}
                  onMouseLeave={e => e.currentTarget.style.background = tokens.bgGlass}>
                  <div onClick={e => { e.stopPropagation(); handleToggleTask(task); }}
                    style={{ width: 18, height: 18, borderRadius: '4px', flexShrink: 0, border: `1.5px solid ${task.done ? tokens.green : tokens.blue}`, background: task.done ? tokens.greenDim : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '10px', color: tokens.green, transition: 'all 0.15s' }}>
                    {task.done ? '✓' : ''}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: tokens.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</div>
                    {task.scheduledStart && (
                      <div style={{ fontSize: '11px', color: tokens.blue, marginTop: '2px' }}>{formatTime(task.scheduledStart)} – {formatTime(task.scheduledEnd)}</div>
                    )}
                    {!task.scheduledStart && task.scheduledDate && (
                      <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>All day — tap to add a time</div>
                    )}
                  </div>
                  <Tag label={task.priority} color={priorityColors[task.priority]?.bg} textColor={priorityColors[task.priority]?.text} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Must-Win + Top Priorities + Energy */}
      <div className="fade-up stagger-3" style={{ marginBottom: '14px' }}>
        <Card accent>
          <SectionLabel>Must-Win Today</SectionLabel>
          {mustWin ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <div onClick={() => handleToggleTask(mustWin)}
                style={{ width: 22, height: 22, borderRadius: '6px', flexShrink: 0, marginTop: 1, border: `1.5px solid ${tokens.accent}`, background: mustWin.done ? tokens.accentDim : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '12px', color: tokens.accent }}>
                {mustWin.done ? '✓' : ''}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: tokens.textPrimary, textDecoration: mustWin.done ? 'line-through' : 'none', opacity: mustWin.done ? 0.5 : 1 }}>
                  {mustWin.title}
                </div>
                <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '3px' }}>{mustWin.project}</div>
              </div>
              <Tag label={mustWin.priority} color={priorityColors[mustWin.priority]?.bg} textColor={priorityColors[mustWin.priority]?.text} />
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: tokens.textMuted }}>
              No critical task set. <span style={{ color: tokens.accent, cursor: 'pointer' }} onClick={() => navigate('/tasks')}>Add one →</span>
            </div>
          )}
        </Card>
      </div>

      {/* Top Priorities + Energy — side by side */}
      <div className="fade-up stagger-3" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', marginBottom: '14px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>Top Priorities</SectionLabel>
            <button onClick={() => navigate('/tasks')} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer' }}>All →</button>
          </div>
          {top3.length === 0 ? (
            <div style={{ fontSize: '13px', color: tokens.textMuted }}>
              Nothing high priority. <span style={{ color: tokens.accent, cursor: 'pointer' }} onClick={() => navigate('/tasks')}>Add tasks →</span>
            </div>
          ) : (
            top3.map((task, i) => (
              <div key={task.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: i < top3.length - 1 ? '12px' : 0 }}>
                <div onClick={() => handleToggleTask(task)}
                  style={{ width: 18, height: 18, borderRadius: '4px', flexShrink: 0, marginTop: '2px', border: `1.5px solid ${task.done ? tokens.green : tokens.border}`, background: task.done ? tokens.greenDim : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '10px', color: tokens.green }}>
                  {task.done ? '✓' : ''}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500, textDecoration: task.done ? 'line-through' : 'none', opacity: task.done ? 0.5 : 1 }}>
                    {task.title}
                  </div>
                  <div style={{ fontSize: '11px', color: tokens.textMuted }}>{task.project}</div>
                </div>
                <Tag label={task.priority} color={priorityColors[task.priority]?.bg} textColor={priorityColors[task.priority]?.text} />
              </div>
            ))
          )}
        </Card>

        <Card style={{ minWidth: '140px' }}>
          <SectionLabel>Energy</SectionLabel>
          <div style={{ fontFamily: fonts.display, fontSize: '36px', fontWeight: 700, color: energy >= 7 ? tokens.green : energy >= 4 ? tokens.accent : tokens.red, lineHeight: 1 }}>
            {energy}<span style={{ fontSize: '16px', color: tokens.textMuted }}>/10</span>
          </div>
          <input
            type="range" min={1} max={10} value={energy}
            onChange={e => handleEnergyChange(Number(e.target.value))}
            style={{ width: '100%', marginTop: '12px', accentColor: tokens.accent }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: tokens.textMuted, marginTop: '4px' }}>
            <span>Low</span><span>High</span>
          </div>
        </Card>
      </div>

      {/* Goal Trajectory */}
      {(scoredGoals.length > 0 || activeGoals.length > 0) && (
        <div className="fade-up stagger-4" style={{ marginBottom: '14px' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <SectionLabel style={{ marginBottom: 0 }}>Trajectory</SectionLabel>
              <button onClick={() => navigate('/goals')} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer' }}>All Goals →</button>
            </div>

            {/* Score summary chips */}
            {scoredGoals.length > 0 && (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: atRiskGoals.length > 0 ? '14px' : 0 }}>
                {onTrackGoals.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: tokens.greenDim, borderRadius: '20px', border: `1px solid ${tokens.green}30` }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: tokens.green, display: 'inline-block' }} />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: tokens.green }}>{onTrackGoals.length} on track</span>
                  </div>
                )}
                {possibleGoals.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: tokens.amberDim, borderRadius: '20px', border: `1px solid ${tokens.amber}30` }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: tokens.amber, display: 'inline-block' }} />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: tokens.amber }}>{possibleGoals.length} possible</span>
                  </div>
                )}
                {atRiskGoals.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: tokens.redDim, borderRadius: '20px', border: `1px solid ${tokens.red}30` }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: tokens.red, display: 'inline-block' }} />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: tokens.red }}>{atRiskGoals.length} at risk</span>
                  </div>
                )}
                {activeGoals.length > scoredGoals.length && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: tokens.bgGlass, borderRadius: '20px', border: `1px solid ${tokens.border}` }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: tokens.textMuted, display: 'inline-block' }} />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: tokens.textMuted }}>{activeGoals.length - scoredGoals.length} unscored</span>
                  </div>
                )}
              </div>
            )}

            {/* At-risk goals list */}
            {atRiskGoals.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {atRiskGoals.map(goal => (
                  <div key={goal.id}
                    onClick={() => navigate(`/goals/${goal.id}`)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: tokens.redDim, borderRadius: '8px', border: `1px solid ${tokens.red}20`, cursor: 'pointer', transition: 'opacity 0.12s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: tokens.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ⚑ {goal.title}
                      </div>
                      {goal.likelihoodReasoning && (
                        <div style={{ fontSize: '11px', color: tokens.textSecondary, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {goal.likelihoodReasoning}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: '12px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: tokens.red }}>{goal.likelihoodScore}%</span>
                      <span style={{ fontSize: '11px', color: tokens.textMuted }}>→</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No goals scored yet */}
            {scoredGoals.length === 0 && activeGoals.length > 0 && (
              <div style={{ fontSize: '13px', color: tokens.textMuted }}>
                {activeGoals.length} active goal{activeGoals.length > 1 ? 's' : ''} not yet scored.{' '}
                <span style={{ color: tokens.accent, cursor: 'pointer' }} onClick={() => navigate('/goals')}>Run analysis →</span>
              </div>
            )}
            {activeGoals.length === 0 && (
              <div style={{ fontSize: '13px', color: tokens.textMuted }}>
                No active goals.{' '}
                <span style={{ color: tokens.accent, cursor: 'pointer' }} onClick={() => navigate('/goals')}>Add your first goal →</span>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* This Week's Focus */}
      <div className="fade-up stagger-4" style={{ marginBottom: '14px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>This Week's Focus</SectionLabel>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {weekFocus && !weekFocusLoading && (
                <>
                  <button title="Accurate" style={{ background: 'transparent', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '3px 9px', fontSize: '12px', cursor: 'pointer', color: tokens.textMuted, fontFamily: fonts.body }}>👍</button>
                  <button title="Give feedback" onClick={() => { setFeedbackKey('weekFocus'); setFeedbackOpen(true); }} style={{ background: 'transparent', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '3px 9px', fontSize: '12px', cursor: 'pointer', color: tokens.textMuted, fontFamily: fonts.body }}>👎</button>
                </>
              )}
              <button onClick={() => { localStorage.removeItem('weeklyFocusCache'); setWeekFocus(null); fetchWeekFocus(); }}
                disabled={weekFocusLoading}
                style={{ background: 'none', border: 'none', fontSize: '13px', color: weekFocusLoading ? tokens.textMuted : tokens.accent, cursor: weekFocusLoading ? 'default' : 'pointer', opacity: weekFocusLoading ? 0.5 : 1 }}>
                {weekFocusLoading ? '...' : '↻'}
              </button>
            </div>
          </div>

          {weekFocusLoading && !weekFocus && (
            <div style={{ fontSize: '13px', color: tokens.textMuted, fontStyle: 'italic' }}>Analyzing your week...</div>
          )}

          {weekFocus && (
            <>
              {weekFocus.headline && (
                <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '14px', lineHeight: 1.4 }}>
                  {weekFocus.headline}
                </div>
              )}

              {weekFocus.thisWeekFocus?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: weekFocus.whatToIgnore ? '14px' : 0 }}>
                  {weekFocus.thisWeekFocus.map((action, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: tokens.accent, background: tokens.accentDim, borderRadius: '4px', padding: '2px 7px', flexShrink: 0, marginTop: '1px', fontFamily: 'monospace' }}>{i + 1}</span>
                      <span style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.45 }}>{action}</span>
                    </div>
                  ))}
                </div>
              )}

              {weekFocus.whatToIgnore && (
                <div style={{ padding: '10px 14px', background: tokens.amberDim, borderRadius: '8px', border: `1px solid ${tokens.amber}30` }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: tokens.amber, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Ignore This Week: </span>
                  <span style={{ fontSize: '12px', color: tokens.textSecondary }}>{weekFocus.whatToIgnore}</span>
                </div>
              )}
            </>
          )}

          {!weekFocus && !weekFocusLoading && (
            <div style={{ fontSize: '13px', color: tokens.textMuted }}>
              <span style={{ color: tokens.accent, cursor: 'pointer' }} onClick={fetchWeekFocus}>Generate focus plan →</span>
            </div>
          )}
        </Card>
      </div>

      {/* Active Projects */}
      <div className="fade-up stagger-4" style={{ marginBottom: '14px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>Active Projects</SectionLabel>
            <button onClick={() => navigate('/projects')} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer' }}>
              Manage →
            </button>
          </div>
          {displayActiveProjects.length === 0 ? (
            <EmptyState icon="◈" title="No active projects" subtitle="Add your first project." action={<Button onClick={() => navigate('/projects')} size="sm">New Project</Button>} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
              {displayActiveProjects.slice(0, 6).map(p => (
                <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                  style={{ padding: '12px 14px', borderRadius: '8px', background: tokens.bgGlass, border: `1px solid ${tokens.border}`, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = tokens.borderHover}
                  onMouseLeave={e => e.currentTarget.style.borderColor = tokens.border}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                  <MomentumBar value={p._mScore} color={momentumColor(p._mScore)} />
                  <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '5px' }}>{p._mScore}% momentum</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* EOD Check-in CTA — visible after 5pm */}
      {isAfter5pm && (
        <div className="fade-up stagger-5" style={{ marginBottom: '14px' }}>
          <div
            onClick={() => navigate('/review')}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: tokens.blueDim, border: `1px solid ${tokens.blueDim}`, borderRadius: '12px', cursor: 'pointer' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.blue, marginBottom: '2px' }}>🌙 End-of-Day Check-in</div>
              <div style={{ fontSize: '12px', color: tokens.textSecondary }}>Reflect on today, set tomorrow's intentions.</div>
            </div>
            <span style={{ fontSize: '14px', color: tokens.blue }}>→</span>
          </div>
        </div>
      )}

      {/* Debt Callout */}
      {totalDebt > 0 && (
        <div className="fade-up stagger-5" style={{ marginBottom: '14px' }}>
          <div onClick={() => navigate('/debt')}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: tokens.redDim, border: `1px solid ${tokens.redDim}`, borderRadius: '10px', cursor: 'pointer' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.red }}>Outstanding Debt Load</div>
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>Track your payoff progress →</div>
            </div>
            <div style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.red }}>
              ${totalDebt.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Quote */}
      <div className="fade-up stagger-6" style={{ textAlign: 'center', padding: '20px 0', borderTop: `1px solid ${tokens.border}` }}>
        <p style={{ fontFamily: fonts.display, fontSize: '14px', color: tokens.textMuted, fontStyle: 'italic', lineHeight: 1.7 }}>
          "{quote.text}"
        </p>
        {quote.attr && <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '6px', letterSpacing: '0.08em' }}>— {quote.attr}</div>}
      </div>

      {/* Plan Schedule Wizard */}
      <PlanScheduleFlow
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        calendarIntegration={calendarIntegration}
        weatherForecast={weatherForecast}
      />

      {/* AI Feedback Modal */}
      <Modal open={feedbackOpen} onClose={() => { setFeedbackOpen(false); setFeedbackText(''); }} title="Give AI Feedback">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>
            What's wrong with this? Your correction will be saved as a hard constraint and the content will regenerate.
          </div>
          <textarea
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            placeholder="e.g. The must-win should focus on Wells Fargo work first, not tax prep..."
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

      {/* Task Edit Modal */}
      <Modal open={!!editingTask} onClose={() => setEditingTask(null)} title="Edit Task">
        {editingTask && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Input label="Title" value={editForm.title} onChange={v => setEditForm(p => ({ ...p, title: v }))} placeholder="Task title" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Priority</label>
                <select value={editForm.priority} onChange={e => setEditForm(p => ({ ...p, priority: e.target.value }))}
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                  {['critical','high','medium','low'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Est. Minutes</label>
                <input type="number" value={editForm.estimatedMinutes} onChange={e => setEditForm(p => ({ ...p, estimatedMinutes: e.target.value }))} placeholder="45"
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Due Date</label>
              <input type="date" value={editForm.dueDate} onChange={e => setEditForm(p => ({ ...p, dueDate: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
            </div>
            <Input label="Notes" value={editForm.notes} onChange={v => setEditForm(p => ({ ...p, notes: v }))} placeholder="Notes..." />
            {editingTask?.scheduledStart && (
              <div style={{ padding: '10px 14px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}`, fontSize: '12px' }}>
                <span style={{ color: tokens.textMuted }}>Scheduled: </span>
                <span style={{ color: tokens.accent, fontWeight: 600 }}>
                  {new Date(editingTask.scheduledStart).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {formatTime(editingTask.scheduledStart)} – {formatTime(editingTask.scheduledEnd || new Date(new Date(editingTask.scheduledStart).getTime() + (editingTask.estimatedMinutes || 45) * 60000).toISOString())}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', paddingTop: '4px' }}>
              <div>
                {editingTask?.scheduledStart && (
                  <Button variant="ghost" onClick={handleUnschedule} loading={editSaving}
                    style={{ color: tokens.red }}>
                    Remove from Schedule
                  </Button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="ghost" onClick={() => setEditingTask(null)}>Cancel</Button>
                <Button onClick={handleEditSave} loading={editSaving}>Save</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
