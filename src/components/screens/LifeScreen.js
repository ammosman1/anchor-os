// src/components/screens/LifeScreen.js
import React, { useState, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getProfile } from '../../lib/db';
import { Card, SectionLabel, MomentumBar } from '../ui';

function LifeScreen() {
  const { user }                                                          = useAuth();
  const { projects, tasks, totalDebt, debtAccounts, weeklyReviews }      = useData();
  const [dailyReviews, setDailyReviews]                                  = useState([]);
  const [loadingHistory, setLoadingHistory]                              = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const prof = await getProfile(user.uid);
      if (!prof) { setLoadingHistory(false); return; }
      const reviews = [];
      Object.entries(prof).forEach(([key, val]) => {
        if (key.startsWith('review_morning_') || key.startsWith('review_eod_')) reviews.push({ id: key, ...val });
      });
      reviews.sort((a, b) => new Date(b.date) - new Date(a.date));
      setDailyReviews(reviews);
      setLoadingHistory(false);
    };
    load();
  }, [user]);

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
    weeklyReviews.filter(r => r.wins).slice(0, 3).forEach(r => {
      r.wins.split('\n').filter(Boolean).slice(0, 2).forEach(w => {
        wins.push({ text: w, date: r.displayDate || r.weekKey, type: 'Weekly' });
      });
    });
    return wins.slice(0, 6);
  })();

  // Recent struggles from bottlenecks and stalled projects
  const recentStruggles = (() => {
    const struggles = [];
    weeklyReviews.filter(r => r.bottlenecks).slice(0, 3).forEach(r => {
      r.bottlenecks.split('\n').filter(Boolean).slice(0, 2).forEach(b => {
        struggles.push({ text: b, date: r.displayDate || r.weekKey, type: 'Bottleneck' });
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
    </div>
  );
}

export default LifeScreen;
