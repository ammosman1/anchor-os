// src/components/screens/HomeScreen.js
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getAIFocusRecommendation } from '../../lib/ai';
import { updateTask, addTask } from '../../lib/db';
import {
  Card, AICard, SectionLabel, MomentumBar, Tag, Button,
  EmptyState, priorityColors,
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
  const { tasks, activeProjects, totalDebt, goals, calendarIntegration } = useData();
  const navigate = useNavigate();

  const [energy,     setEnergy]     = useState(profile?.energyToday || 7);
  const [aiText,     setAiText]     = useState('');
  const [aiLoading,  setAiLoading]  = useState(false);
  const [quickTask,  setQuickTask]  = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [planOpen,   setPlanOpen]   = useState(false);
  const [quote]                     = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);

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

  // Today's scheduled tasks
  const scheduledToday = tasks.filter(t =>
    !t.done && t.status === 'scheduled' && t.scheduledDate === todayStr
  ).sort((a, b) => (a.scheduledStart || '').localeCompare(b.scheduledStart || ''));

  // Priority tasks (high/critical, unscheduled)
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const todayTasks = [...tasks]
    .filter(t => !t.done && (t.priority === 'critical' || t.priority === 'high' || t.source === 'brain-dump' || !t.projectId))
    .sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

  const top3    = todayTasks.slice(0, 3);
  const mustWin = top3.find(t => t.priority === 'critical') || top3[0];

  const doneTodayCount = tasks.filter(t => {
    if (!t.done) return false;
    const updated = t.updatedAt?.toDate?.() || new Date(0);
    return updated.toDateString() === new Date().toDateString();
  }).length;

  // Goal snapshot — show top 3 active goals with likelihood scores
  const goalsSnapshot = (goals || [])
    .filter(g => g.status === 'active' && g.likelihoodScore != null)
    .sort((a, b) => a.likelihoodScore - b.likelihoodScore) // worst first
    .slice(0, 3);

  const fetchAI = async () => {
    setAiLoading(true);
    const text = await getAIFocusRecommendation({
      energy,
      topTasks: top3,
      projects: activeProjects,
    });
    setAiText(text || 'Focus on your single highest-leverage task. Everything else can wait.');
    setAiLoading(false);
  };

  useEffect(() => {
    fetchAI();
    // eslint-disable-next-line
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

  const momentumColor = (m) => m >= 65 ? tokens.green : m >= 35 ? tokens.accent : tokens.red;
  const likelihoodColor = (s) => s >= 70 ? tokens.green : s >= 40 ? tokens.amber : tokens.red;

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
                <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                  <div onClick={() => handleToggleTask(task)}
                    style={{ width: 18, height: 18, borderRadius: '4px', flexShrink: 0, border: `1.5px solid ${task.done ? tokens.green : tokens.blue}`, background: task.done ? tokens.greenDim : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '10px', color: tokens.green, transition: 'all 0.15s' }}>
                    {task.done ? '✓' : ''}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: tokens.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</div>
                    {task.scheduledStart && (
                      <div style={{ fontSize: '11px', color: tokens.blue, marginTop: '2px' }}>{formatTime(task.scheduledStart)} – {formatTime(task.scheduledEnd)}</div>
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

      {/* Goal Likelihood Snapshot */}
      {goalsSnapshot.length > 0 && (
        <div className="fade-up stagger-4" style={{ marginBottom: '14px' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <SectionLabel style={{ marginBottom: 0 }}>Goal Likelihood</SectionLabel>
              <button onClick={() => navigate('/goals')} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer' }}>All Goals →</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {goalsSnapshot.map(goal => (
                <div key={goal.id} onClick={() => navigate('/goals')} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: tokens.textPrimary }}>{goal.title}</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: likelihoodColor(goal.likelihoodScore) }}>{goal.likelihoodScore}%</span>
                  </div>
                  <MomentumBar value={goal.likelihoodScore} color={likelihoodColor(goal.likelihoodScore)} height={3} />
                  {goal.likelihoodScore < 50 && (
                    <div style={{ fontSize: '10px', color: tokens.red, marginTop: '3px', fontWeight: 600 }}>⚑ Off track — see Goals for recovery plan</div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Active Projects */}
      <div className="fade-up stagger-4" style={{ marginBottom: '14px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>Active Projects</SectionLabel>
            <button onClick={() => navigate('/projects')} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer' }}>
              Manage →
            </button>
          </div>
          {activeProjects.length === 0 ? (
            <EmptyState icon="◈" title="No active projects" subtitle="Add your first project." action={<Button onClick={() => navigate('/projects')} size="sm">New Project</Button>} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
              {activeProjects.slice(0, 6).map(p => (
                <div key={p.id} onClick={() => navigate('/projects')}
                  style={{ padding: '12px 14px', borderRadius: '8px', background: tokens.bgGlass, border: `1px solid ${tokens.border}`, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = tokens.borderHover}
                  onMouseLeave={e => e.currentTarget.style.borderColor = tokens.border}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                  <MomentumBar value={p.momentum || 0} color={momentumColor(p.momentum || 0)} />
                  <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '5px' }}>{p.momentum || 0}% momentum</div>
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
      />
    </div>
  );
}
