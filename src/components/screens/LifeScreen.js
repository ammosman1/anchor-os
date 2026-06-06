// src/components/screens/LifeScreen.js
import React, { useState, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { disconnectCalendar, getAICache, saveAICache } from '../../lib/db';
import { initiateCalendarAuth, getValidAccessToken, getEvents, formatEventTime, formatEventDuration, deleteEvent } from '../../lib/calendar';
import { callAI } from '../../lib/ai';
import { Card, SectionLabel, MomentumBar, Button } from '../ui';

function LifeScreen() {
  const { user }                                                                    = useAuth();
  const { projects, tasks, totalDebt, debtAccounts, weeklyReviews, dailyReviews, calendarIntegration, habits, habitLogs, healthLogs = [] } = useData();
  const [todayEvents,      setTodayEvents]      = useState([]);
  const [loadingEvents,    setLoadingEvents]    = useState(false);
  const [insights,         setInsights]         = useState(null);
  const [loadingInsights,  setLoadingInsights]  = useState(false);

  const handleDeleteEvent = async (eventId) => {
    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      if (!token) return;
      await deleteEvent(token, eventId);
      setTodayEvents(prev => prev.filter(e => e.id !== eventId));
    } catch (err) {
      console.error('Delete event error:', err);
    }
  };

  const runInsights = async () => {
    setLoadingInsights(true);
    const todayKey = `insights-${new Date().toISOString().split('T')[0]}`;
    const cached = await getAICache(user.uid, todayKey);
    if (cached) {
      try { setInsights(JSON.parse(cached)); } catch { setInsights(null); }
      setLoadingInsights(false);
      return;
    }

    // Task completions by date
    const tasksByDay = {};
    tasks.forEach(t => {
      if (!t.done || !t.completedAt) return;
      const raw = t.completedAt?.toDate?.() || new Date(t.completedAt);
      const d = raw.toISOString().split('T')[0];
      if (d) tasksByDay[d] = (tasksByDay[d] || 0) + 1;
    });

    // Habit completions by date
    const habitsByDay = {};
    (habitLogs || []).forEach(l => {
      if (l.done) habitsByDay[l.date] = (habitsByDay[l.date] || 0) + 1;
    });

    // Merge into health log rows
    const data = (healthLogs || []).slice(0, 30).map(l => ({
      date: l.date,
      energy: l.energy ?? null,
      sleep: l.sleep ?? null,
      exercise: l.exercise === true ? 'yes' : l.exercise === false ? 'no' : null,
      tasksCompleted: tasksByDay[l.date] || 0,
      habitsCompleted: habitsByDay[l.date] || 0,
    })).filter(l => l.energy !== null || l.sleep !== null);

    if (data.length < 5) {
      setInsights([{ text: 'Log at least 5 days of health data to see pattern insights.', type: 'info' }]);
      setLoadingInsights(false);
      return;
    }

    const dataStr = data.map(d =>
      `${d.date}: energy=${d.energy ?? '?'}/5, sleep=${d.sleep ?? '?'}h, exercise=${d.exercise ?? '?'}, tasks_done=${d.tasksCompleted}, habits_done=${d.habitsCompleted}`
    ).join('\n');

    try {
      const result = await callAI({
        messages: [{ role: 'user', content: `Analyze this ${data.length}-day personal data and find 3-4 concrete patterns. Prioritize correlations between health metrics and task/habit completion. Be specific with numbers. Return ONLY a JSON array:\n[{"insight":"...","type":"positive|warning|neutral"}]\n\nData:\n${dataStr}` }],
        systemExtra: 'You are analyzing personal productivity and health data to surface non-obvious patterns. Output ONLY valid JSON array, no markdown, no explanation outside the JSON.',
        maxTokens: 450,
      });
      // Strip markdown code fences if present
      const clean = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);
      setInsights(parsed);
      saveAICache(user.uid, todayKey, JSON.stringify(parsed));
    } catch {
      setInsights([{ text: 'Could not analyze patterns — try again later.', type: 'info' }]);
    }
    setLoadingInsights(false);
  };

  // Load today's calendar events when integration is connected
  useEffect(() => {
    if (!calendarIntegration?.connected || !user) return;
    const load = async () => {
      setLoadingEvents(true);
      try {
        const token = await getValidAccessToken(user.uid, calendarIntegration);
        if (!token) return;
        const today = new Date();
        const timeMin = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0).toISOString();
        const timeMax = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();
        const { events } = await getEvents(token, timeMin, timeMax);
        setTodayEvents(events);
      } catch { /* silent — calendar errors shouldn't break the page */ }
      finally { setLoadingEvents(false); }
    };
    load();
  }, [calendarIntegration?.connected, user]); // eslint-disable-line react-hooks/exhaustive-deps -- getEvents is a stable import; date helpers inside the effect are not reactive values


  // ─── Real computed metrics ─────────────────────────────────────────────────
  const activeProjects   = projects.filter(p => p.status === 'active');
  const stalledProjects  = projects.filter(p => p.status === 'stalled');
  const completedTasks   = tasks.filter(t => t.done);
  const pendingTasks     = tasks.filter(t => !t.done);
  const overdueTasks     = tasks.filter(t => !t.done && t.dueDate && new Date(t.dueDate + 'T00:00:00') < new Date());
  const highPriorityPending = tasks.filter(t => !t.done && (t.priority === 'critical' || t.priority === 'high'));

  // Task completion rate (last 14 days)
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recentTasks     = tasks.filter(t => { const d = t.createdAt?.toDate?.() || new Date(0); return d.getTime() > fourteenDaysAgo; });
  const recentDone      = recentTasks.filter(t => t.done);
  const completionRate  = recentTasks.length > 0 ? Math.round((recentDone.length / recentTasks.length) * 100) : 0;

  // Average project momentum
  const avgMomentum = projects.length > 0
    ? Math.round(projects.reduce((s, p) => s + (p.momentum || 0), 0) / projects.length)
    : 0;

  // Review streak — count consecutive days with at least one review
  const reviewStreak = (() => {
    if (dailyReviews.length === 0) return 0;
    const reviewDates = new Set(dailyReviews.map(r => r.date));
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toDateString();
      if (reviewDates.has(key)) { streak++; }
      else if (i > 0) { break; } // allow today to not be reviewed yet
    }
    return streak;
  })();

  // Source-of-tasks breakdown
  const taskSources = {
    brainDump:    tasks.filter(t => t.source === 'brain-dump').length,
    quickCapture: tasks.filter(t => t.source === 'quick-capture').length,
    project:      tasks.filter(t => t.source === 'project').length,
    advisor:      tasks.filter(t => t.source === 'advisor').length,
    review:       tasks.filter(t => t.source === 'review').length,
    manual:       tasks.filter(t => !t.source || t.source === 'manual').length,
  };

  // Recent wins from EOD and weekly reviews
  const recentWins = (() => {
    const wins = [];
    dailyReviews.filter(r => r.type === 'eod' && r.accomplished).slice(0, 5).forEach(r => {
      wins.push({ text: r.accomplished, date: r.displayDate || r.date, type: 'EOD' });
    });
    weeklyReviews.filter(r => r.wins && typeof r.wins === 'string').slice(0, 3).forEach(r => {
      r.wins.split('\n').filter(Boolean).slice(0, 2).forEach(w => {
        wins.push({ text: w, date: r.displayDate || r.weekKey, type: 'Weekly' });
      });
    });
    weeklyReviews.filter(r => Array.isArray(r.wins)).slice(0, 3).forEach(r => {
      r.wins.slice(0, 2).forEach(w => {
        if (w && typeof w === 'string') wins.push({ text: w, date: r.displayDate || r.weekKey, type: 'Weekly' });
      });
    });
    return wins.slice(0, 6);
  })();

  // Recent struggles from bottlenecks and stalled projects
  const recentStruggles = (() => {
    const struggles = [];
    weeklyReviews.filter(r => r.bottlenecks && typeof r.bottlenecks === 'string').slice(0, 3).forEach(r => {
      r.bottlenecks.split('\n').filter(Boolean).slice(0, 2).forEach(b => {
        struggles.push({ text: b, date: r.displayDate || r.weekKey, type: 'Bottleneck' });
      });
    });
    weeklyReviews.filter(r => Array.isArray(r.bottlenecks)).slice(0, 3).forEach(r => {
      r.bottlenecks.slice(0, 2).forEach(b => {
        if (b && typeof b === 'string') struggles.push({ text: b, date: r.displayDate || r.weekKey, type: 'Bottleneck' });
      });
    });
    stalledProjects.slice(0, 3).forEach(p => {
      struggles.push({ text: `${p.title} — stalled`, date: 'Current', type: 'Project' });
    });
    if (overdueTasks.length > 0) {
      struggles.push({ text: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}`, date: 'Current', type: 'Tasks' });
    }
    return struggles.slice(0, 6);
  })();

  // Execution consistency (daily task completion last 14 days)
  const executionData = (() => {
    const data = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toDateString();
      const dayDone = tasks.filter(t => {
        if (!t.done) return false;
        const u = t.updatedAt?.toDate?.() || new Date(0);
        return u.toDateString() === dayStr;
      }).length;
      data.push(Math.min(100, dayDone * 20)); // scale: 5 tasks = 100%
    }
    return data;
  })();

  // Habits summary for Life OS
  const todayStrLife    = new Date().toISOString().split('T')[0];
  const activeHabitsLife = (habits || []).filter(h => h.active !== false);

  const habitsDoneToday = activeHabitsLife.filter(h =>
    !!(habitLogs || []).find(l => l.habitId === h.id && l.date === todayStrLife && l.done)
  ).length;

  const habitsScheduledToday = activeHabitsLife.filter(h => {
    if (h.frequency === 'weekdays') {
      const day = new Date().getDay();
      return day >= 1 && day <= 5;
    }
    return true;
  }).length;

  const topHabitStreaks = activeHabitsLife.map(h => {
    const doneDates = new Set((habitLogs || []).filter(l => l.habitId === h.id && l.done).map(l => l.date));
    let d = new Date();
    const t = d.toISOString().split('T')[0];
    if (!doneDates.has(t)) d.setDate(d.getDate() - 1);
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const ds = d.toISOString().split('T')[0];
      if (!doneDates.has(ds)) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return { title: h.title, streak };
  }).sort((a, b) => b.streak - a.streak).slice(0, 3);

  const habits14DayData = (() => {
    const data = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const scheduled = activeHabitsLife.filter(h => {
        if (h.frequency === 'weekdays') { const day = new Date(ds + 'T12:00:00').getDay(); return day >= 1 && day <= 5; }
        return true;
      }).length;
      const done = activeHabitsLife.filter(h =>
        !!(habitLogs || []).find(l => l.habitId === h.id && l.date === ds && l.done)
      ).length;
      data.push(scheduled > 0 ? Math.round((done / scheduled) * 100) : 0);
    }
    return data;
  })();

  const habitsAvgRate14 = habits14DayData.length > 0
    ? Math.round(habits14DayData.reduce((s, v) => s + v, 0) / habits14DayData.length)
    : 0;

  // Life area scores — calculated from real data
  const lifeAreas = [
    {
      area: 'Work',
      score: Math.min(100, Math.round(completionRate * 0.5 + avgMomentum * 0.5)),
      color: tokens.blue,
      icon: '◈',
      detail: `${activeProjects.length} active projects`,
    },
    {
      area: 'Finance',
      score: totalDebt > 0 ? Math.max(10, Math.min(60, 60 - Math.round(totalDebt / 10000))) : 75,
      color: tokens.amber,
      icon: '◉',
      detail: totalDebt > 0 ? `$${totalDebt.toLocaleString()} outstanding` : 'No debt tracked',
    },
    {
      area: 'Health',
      score: reviewStreak >= 5 ? 80 : reviewStreak >= 3 ? 65 : 50,
      color: tokens.green,
      icon: '◎',
      detail: `${reviewStreak} day review streak`,
    },
    {
      area: 'Execution',
      score: completionRate,
      color: completionRate >= 70 ? tokens.green : completionRate >= 40 ? tokens.accent : tokens.red,
      icon: '✓',
      detail: `${completionRate}% completion rate`,
    },
    {
      area: 'Focus',
      score: highPriorityPending.length <= 3 ? 85 : highPriorityPending.length <= 6 ? 60 : 35,
      color: tokens.purple,
      icon: '✦',
      detail: `${highPriorityPending.length} high priority pending`,
    },
    {
      area: 'Momentum',
      score: avgMomentum,
      color: avgMomentum >= 65 ? tokens.green : avgMomentum >= 35 ? tokens.accent : tokens.red,
      icon: '▲',
      detail: `Avg across ${projects.length} projects`,
    },
  ];

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {/* Header */}
      <div className="fade-up" style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Life Dashboard</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Life OS</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>Real data. No guesses.</p>
      </div>

      {/* Key stats row */}
      <div className="fade-up stagger-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Active Projects',  val: activeProjects.length,  color: tokens.blue   },
          { label: 'Tasks Done',       val: completedTasks.length,  color: tokens.green  },
          { label: 'Overdue',          val: overdueTasks.length,    color: overdueTasks.length > 0 ? tokens.red : tokens.textMuted },
          { label: 'Review Streak',    val: `${reviewStreak}d`,     color: reviewStreak >= 3 ? tokens.accent : tokens.textMuted },
        ].map(item => (
          <Card key={item.label} style={{ textAlign: 'center', padding: '14px' }}>
            <div style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: item.color }}>{item.val}</div>
            <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '4px' }}>{item.label}</div>
          </Card>
        ))}
      </div>

      {/* Life area scores */}
      <div className="fade-up stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {lifeAreas.map(item => (
          <Card key={item.area} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20px', marginBottom: '4px', color: item.color }}>{item.icon}</div>
            <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '4px' }}>{item.area}</div>
            <div style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: item.color, marginBottom: '8px' }}>{item.score}</div>
            <MomentumBar value={item.score} color={item.color} />
            <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '6px', lineHeight: 1.4 }}>{item.detail}</div>
          </Card>
        ))}
      </div>

      {/* Execution consistency chart */}
      <div className="fade-up stagger-3" style={{ marginBottom: '14px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>Execution Consistency — Last 14 Days</SectionLabel>
            <span style={{ fontSize: '12px', color: tokens.accent, fontWeight: 600 }}>{completionRate}% avg</span>
          </div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '60px' }}>
            {executionData.map((v, i) => (
              <div key={i} style={{ flex: 1, height: `${Math.max(4, v)}%`, borderRadius: '3px 3px 0 0', background: v >= 60 ? tokens.green : v >= 20 ? tokens.accent : 'rgba(255,255,255,0.08)', transition: 'height 0.5s ease' }} title={`${v}%`} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '10px', color: tokens.textMuted }}>
            <span>14 days ago</span><span>Today</span>
          </div>
        </Card>
      </div>

      {/* Pattern Insights */}
      <div className="fade-up stagger-4" style={{ marginBottom: '14px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: insights ? '14px' : 0 }}>
            <div>
              <SectionLabel style={{ marginBottom: 0 }}>Pattern Insights</SectionLabel>
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '3px' }}>AI-detected correlations across health, habits &amp; tasks</div>
            </div>
            <Button size="sm" variant={insights ? 'ghost' : 'primary'} onClick={runInsights} disabled={loadingInsights}>
              {loadingInsights ? 'Analyzing…' : insights ? 'Refresh' : 'Run Analysis'}
            </Button>
          </div>
          {insights && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {insights.map((item, i) => {
                const color = item.type === 'positive' ? tokens.green : item.type === 'warning' ? tokens.amber : tokens.textSecondary;
                const icon  = item.type === 'positive' ? '↑' : item.type === 'warning' ? '⚑' : '→';
                return (
                  <div key={i} style={{ display: 'flex', gap: '10px', padding: '10px 12px', background: tokens.bgInput, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                    <span style={{ color, flexShrink: 0, fontWeight: 700, fontSize: '13px', marginTop: '1px' }}>{icon}</span>
                    <span style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.5 }}>{item.insight || item.text}</span>
                  </div>
                );
              })}
            </div>
          )}
          {!insights && !loadingInsights && (
            <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '8px' }}>
              Analyzes 30 days of energy, sleep, exercise, task completion, and habits to find non-obvious patterns.
            </div>
          )}
        </Card>
      </div>

      {/* Habits Summary */}
      {activeHabitsLife.length > 0 && (
        <div className="fade-up stagger-4" style={{ marginBottom: '14px' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <SectionLabel style={{ marginBottom: 0 }}>Habits — Today</SectionLabel>
              <span style={{ fontSize: '13px', fontWeight: 600, color: habitsDoneToday === habitsScheduledToday && habitsScheduledToday > 0 ? tokens.green : tokens.accent }}>
                {habitsDoneToday}/{habitsScheduledToday} done
              </span>
            </div>

            {topHabitStreaks.filter(h => h.streak > 0).length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Top Streaks</div>
                {topHabitStreaks.filter(h => h.streak > 0).map((h, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: i < topHabitStreaks.length - 1 ? '6px' : 0 }}>
                    <span style={{ fontSize: '12px', color: tokens.textSecondary }}>{h.title}</span>
                    <span style={{ fontFamily: fonts.display, fontSize: '14px', fontWeight: 700, color: h.streak >= 7 ? tokens.accent : tokens.textSecondary }}>{h.streak}d</span>
                  </div>
                ))}
              </div>
            )}

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '10px', color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>14-Day Completion</div>
                <span style={{ fontSize: '12px', fontWeight: 600, color: habitsAvgRate14 >= 70 ? tokens.green : habitsAvgRate14 >= 40 ? tokens.accent : tokens.red }}>{habitsAvgRate14}% avg</span>
              </div>
              <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '36px' }}>
                {habits14DayData.map((v, i) => (
                  <div key={i} style={{
                    flex: 1, height: `${Math.max(4, v)}%`, borderRadius: '2px 2px 0 0',
                    background: v >= 70 ? tokens.green : v >= 40 ? tokens.accent : v > 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
                    transition: 'height 0.5s ease',
                  }} title={`${v}%`} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: tokens.textMuted }}>
                <span>14 days ago</span><span>Today</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Recent Wins + Struggles */}
      <div className="fade-up stagger-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
        <Card>
          <SectionLabel>Recent Wins</SectionLabel>
          {recentWins.length === 0 ? (
            <div style={{ fontSize: '12px', color: tokens.textMuted }}>Complete EOD or weekly reviews to see wins here.</div>
          ) : (
            recentWins.map((win, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: i < recentWins.length - 1 ? '10px' : 0 }}>
                <span style={{ color: tokens.green, flexShrink: 0, marginTop: '1px' }}>✓</span>
                <div>
                  <div style={{ fontSize: '12px', color: tokens.textPrimary, lineHeight: 1.5 }}>{win.text}</div>
                  <div style={{ fontSize: '10px', color: tokens.textMuted }}>{win.date} · {win.type}</div>
                </div>
              </div>
            ))
          )}
        </Card>

        <Card>
          <SectionLabel>Current Struggles</SectionLabel>
          {recentStruggles.length === 0 ? (
            <div style={{ fontSize: '12px', color: tokens.green }}>✓ No major struggles detected</div>
          ) : (
            recentStruggles.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: i < recentStruggles.length - 1 ? '10px' : 0 }}>
                <span style={{ color: tokens.red, flexShrink: 0, marginTop: '1px' }}>⚑</span>
                <div>
                  <div style={{ fontSize: '12px', color: tokens.textPrimary, lineHeight: 1.5 }}>{s.text}</div>
                  <div style={{ fontSize: '10px', color: tokens.textMuted }}>{s.date} · {s.type}</div>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>

      {/* Task source breakdown */}
      <div className="fade-up stagger-5" style={{ marginBottom: '14px' }}>
        <Card>
          <SectionLabel>Task Sources</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(taskSources).filter(([, v]) => v > 0).map(([source, count]) => {
              const total = tasks.length || 1;
              const pct   = Math.round((count / total) * 100);
              const colors = { brainDump: tokens.purple, quickCapture: tokens.blue, project: tokens.green, advisor: tokens.accent, review: tokens.amber, manual: tokens.textMuted };
              const labels = { brainDump: 'Brain Dump', quickCapture: 'Quick Capture', project: 'Project', advisor: 'Advisor', review: 'Review', manual: 'Manual' };
              return (
                <div key={source}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', color: tokens.textSecondary }}>{labels[source]}</span>
                    <span style={{ fontSize: '12px', color: colors[source], fontWeight: 600 }}>{count} ({pct}%)</span>
                  </div>
                  <MomentumBar value={pct} color={colors[source]} height={3} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Debt summary */}
      {debtAccounts.length > 0 && (
        <div className="fade-up stagger-5">
          <Card style={{ borderColor: 'rgba(212,122,107,0.2)', background: 'rgba(212,122,107,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <SectionLabel style={{ marginBottom: 0 }}>Debt Load</SectionLabel>
              <div style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.red }}>${totalDebt.toLocaleString()}</div>
            </div>
            {debtAccounts.map((a, i) => {
              const pct = Math.round(((a.balance || 0) / (totalDebt || 1)) * 100);
              return (
                <div key={a.id} style={{ marginBottom: i < debtAccounts.length - 1 ? '10px' : 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', color: tokens.textSecondary }}>{a.name}</span>
                    <span style={{ fontSize: '12px', color: tokens.red }}>${(a.balance || 0).toLocaleString()}</span>
                  </div>
                  <MomentumBar value={pct} color={tokens.red} height={3} />
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {/* Integrations */}
      <div className="fade-up stagger-6" style={{ marginTop: '14px' }}>
        <Card>
          <SectionLabel>Integrations</SectionLabel>

          {/* Google Calendar row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ width: 38, height: 38, borderRadius: '10px', background: tokens.bgInput, border: `1px solid ${tokens.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>📅</div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>Google Calendar</div>
                <div style={{ fontSize: '11px', marginTop: '2px', color: calendarIntegration?.connected ? tokens.green : tokens.textMuted }}>
                  {calendarIntegration?.connected ? '● Connected' : '○ Not connected'}
                </div>
              </div>
            </div>
            {calendarIntegration?.connected ? (
              <Button variant="ghost" size="sm" onClick={() => disconnectCalendar(user.uid)}>Disconnect</Button>
            ) : (
              <Button size="sm" onClick={() => initiateCalendarAuth(user.uid)}>Connect</Button>
            )}
          </div>

          {/* Today's events — shown when connected */}
          {calendarIntegration?.connected && (
            <div style={{ marginTop: '18px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
                Today's Calendar
              </div>
              {loadingEvents ? (
                <div style={{ fontSize: '12px', color: tokens.textMuted }}>Loading...</div>
              ) : todayEvents.length === 0 ? (
                <div style={{ fontSize: '12px', color: tokens.textMuted }}>No events today — wide open.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {todayEvents.map(event => {
                    const isAllDay = !event.start?.dateTime;
                    return (
                      <div key={event.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${tokens.border}` }}>
                        <div style={{ width: 3, borderRadius: '99px', alignSelf: 'stretch', background: tokens.blue, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', color: tokens.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.summary || '(No title)'}</div>
                          <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>
                            {isAllDay ? 'All day' : `${formatEventTime(event.start.dateTime)} – ${formatEventTime(event.end.dateTime)}`}
                          </div>
                        </div>
                        {!isAllDay && (
                          <div style={{ fontSize: '10px', color: tokens.textMuted, flexShrink: 0 }}>
                            {formatEventDuration(event.start.dateTime, event.end.dateTime)}
                          </div>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteEvent(event.id); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.red, fontSize: '12px', opacity: 0.55, padding: '2px 4px', flexShrink: 0, lineHeight: 1 }}
                        >✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default LifeScreen;
