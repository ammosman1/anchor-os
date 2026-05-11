// src/components/screens/HomeScreen.js
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getAIFocusRecommendation } from '../../lib/ai';
import { updateTask, addTask } from '../../lib/db';
import { Card, AICard, SectionLabel, MomentumBar, Tag, Button, EmptyState, priorityColors } from '../ui';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getDateString() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

const QUOTES = [
  { text: "Momentum matters. Action beats overthinking.", attr: "Andrew Mosman" },
  { text: "Most people quit too early. Systems outperform willpower.", attr: "" },
  { text: "Clarity reduces stress. Simplicity is powerful.", attr: "" },
  { text: "Small operational improvements compound massively over time.", attr: "" },
  { text: "The successful warrior is the average man, with laser-like focus.", attr: "Bruce Lee" },
  { text: "What's the bottleneck? Fix it. Everything else is noise.", attr: "" },
  { text: "Great execution creates opportunity.", attr: "" },
];

export default function HomeScreen() {
  const { user, profile, updateProfile } = useAuth();
  const { todayTasks, activeProjects, totalDebt, tasks } = useData();
  const navigate = useNavigate();

  const [energy,      setEnergy]      = useState(profile?.energyToday || 7);
  const [aiText,      setAiText]      = useState('');
  const [aiLoading,   setAiLoading]   = useState(false);
  const [quickTask,   setQuickTask]   = useState('');
  const [addingTask,  setAddingTask]  = useState(false);
  const [quote]                       = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);

  // Top 3 = non-done tasks sorted by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const top3 = [...todayTasks]
    .sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9))
    .slice(0, 3);

  const mustWin = top3.find(t => t.priority === 'critical') || top3[0];

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
    if (top3.length > 0 || activeProjects.length > 0) fetchAI();
    // eslint-disable-next-line
  }, []);

  const handleEnergyChange = async (val) => {
    setEnergy(val);
    await updateProfile({ energyToday: val, energyDate: new Date().toDateString() });
  };

  const handleToggleTask = async (task) => {
    await updateTask(user.uid, task.id, { done: !task.done });
  };

  const handleQuickAdd = async () => {
    if (!quickTask.trim()) return;
    setAddingTask(true);
    await addTask(user.uid, {
      title: quickTask.trim(),
      priority: 'medium',
      project: 'Inbox',
      energy: 'medium',
    });
    setQuickTask('');
    setAddingTask(false);
  };

  const momentumColor = (m) => m >= 65 ? tokens.green : m >= 35 ? tokens.accent : tokens.red;

  const doneTodayCount = tasks.filter(t => t.done && new Date(t.updatedAt?.toDate?.() || 0).toDateString() === new Date().toDateString()).length;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>

      {/* Header */}
      <div className="fade-up" style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>
          {getDateString()}
        </div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '30px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>
          {getGreeting()}, {profile?.firstName || 'Andrew'}.
        </h1>
        <p style={{ color: tokens.textSecondary, fontSize: '14px', marginTop: '6px' }}>
          {doneTodayCount > 0 ? `${doneTodayCount} task${doneTodayCount > 1 ? 's' : ''} done today · ` : ''}
          {top3.length} priorities on deck.
        </p>
      </div>

      {/* AI Focus Card */}
      <div className="fade-up stagger-1" style={{ marginBottom: '16px' }}>
        <AICard
          text={aiText || 'Loading your strategic recommendation...'}
          loading={aiLoading}
          onRefresh={fetchAI}
          label="FOCUS RECOMMENDATION"
        />
      </div>

      {/* Must Win + Energy */}
      <div className="fade-up stagger-2" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '14px', marginBottom: '14px', alignItems: 'stretch' }}>

        {/* Must Win */}
        <Card accent style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <SectionLabel>Must-Win Today</SectionLabel>
          {mustWin ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <div
                  onClick={() => handleToggleTask(mustWin)}
                  style={{
                    width: 20, height: 20, borderRadius: '5px', flexShrink: 0, marginTop: 2,
                    border: `1.5px solid ${tokens.accent}`,
                    background: mustWin.done ? tokens.accentDim : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: '11px', color: tokens.accent,
                  }}
                >
                  {mustWin.done ? '✓' : ''}
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: tokens.textPrimary, textDecoration: mustWin.done ? 'line-through' : 'none', opacity: mustWin.done ? 0.5 : 1 }}>
                    {mustWin.title}
                  </div>
                  <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '3px' }}>{mustWin.project}</div>
                </div>
                <Tag label={mustWin.priority} color={priorityColors[mustWin.priority]?.bg} textColor={priorityColors[mustWin.priority]?.text} style={{ marginLeft: 'auto' }} />
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: tokens.textMuted }}>
              No critical task set. <span style={{ color: tokens.accent, cursor: 'pointer' }} onClick={() => navigate('/projects')}>Add one →</span>
            </div>
          )}
        </Card>

        {/* Energy */}
        <Card style={{ minWidth: '160px', display: 'flex', flexDirection: 'column' }}>
          <SectionLabel>Energy</SectionLabel>
          <div style={{ fontFamily: fonts.display, fontSize: '40px', fontWeight: 700, color: energy >= 7 ? tokens.green : energy >= 4 ? tokens.accent : tokens.red, lineHeight: 1 }}>
            {energy}
            <span style={{ fontSize: '18px', color: tokens.textMuted, fontWeight: 400 }}>/10</span>
          </div>
          <input
            type="range" min={1} max={10} value={energy}
            onChange={e => handleEnergyChange(Number(e.target.value))}
            style={{ width: '100%', marginTop: '12px', accentColor: tokens.accent }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: tokens.textMuted, marginTop: '4px' }}>
            <span>Empty</span><span>Full</span>
          </div>
        </Card>
      </div>

      {/* Top 3 + Quick Add */}
      <div className="fade-up stagger-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>

        {/* Top 3 */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>Top Priorities</SectionLabel>
            <button onClick={() => navigate('/projects')} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer' }}>View all →</button>
          </div>
          {top3.length === 0 ? (
            <div style={{ fontSize: '13px', color: tokens.textMuted }}>No tasks yet. <span style={{ color: tokens.accent, cursor: 'pointer' }} onClick={() => navigate('/projects')}>Add tasks →</span></div>
          ) : (
            top3.map((task, i) => (
              <div key={task.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: i < top3.length - 1 ? '12px' : 0 }}>
                <div
                  onClick={() => handleToggleTask(task)}
                  style={{
                    width: 18, height: 18, borderRadius: '4px', flexShrink: 0, marginTop: '2px',
                    border: `1.5px solid ${task.done ? tokens.green : tokens.border}`,
                    background: task.done ? tokens.greenDim : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: '10px', color: tokens.green,
                  }}
                >
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

        {/* Quick Add */}
        <Card>
          <SectionLabel>Quick Capture</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <textarea
              value={quickTask}
              onChange={e => setQuickTask(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuickAdd(); }}}
              placeholder="Something on your mind? Drop it here..."
              rows={3}
              style={{
                background: tokens.bgInput,
                border: `1px solid ${tokens.border}`,
                borderRadius: '8px',
                padding: '10px 12px',
                color: tokens.textPrimary,
                fontSize: '13px',
                resize: 'none',
                outline: 'none',
                fontFamily: fonts.body,
                lineHeight: 1.6,
              }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
            />
            <div style={{ display: 'flex', gap: '6px' }}>
              <Button onClick={handleQuickAdd} loading={addingTask} disabled={!quickTask.trim()} size="sm" style={{ flex: 1 }}>
                + Add to Inbox
              </Button>
              <Button onClick={() => navigate('/brain-dump')} variant="ghost" size="sm">
                Full Dump →
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Active Projects */}
      <div className="fade-up stagger-4" style={{ marginBottom: '14px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>Active Projects</SectionLabel>
            <button onClick={() => navigate('/projects')} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.accent, cursor: 'pointer' }}>
              Manage →
            </button>
          </div>
          {activeProjects.length === 0 ? (
            <EmptyState icon="◈" title="No active projects" subtitle="Add your first project to start tracking momentum." action={<Button onClick={() => navigate('/projects')} size="sm">New Project</Button>} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
              {activeProjects.slice(0, 6).map(p => (
                <div
                  key={p.id}
                  onClick={() => navigate('/projects')}
                  style={{ padding: '12px 14px', borderRadius: '8px', background: tokens.bgGlass, border: `1px solid ${tokens.border}`, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = tokens.borderHover}
                  onMouseLeave={e => e.currentTarget.style.borderColor = tokens.border}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                  <MomentumBar value={p.momentum || 0} color={momentumColor(p.momentum || 0)} />
                  <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '5px' }}>{p.momentum || 0}% momentum</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Debt Callout (if any) */}
      {totalDebt > 0 && (
        <div className="fade-up stagger-5" style={{ marginBottom: '14px' }}>
          <div
            onClick={() => navigate('/debt')}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 18px',
              background: tokens.redDim,
              border: `1px solid rgba(212,122,107,0.15)`,
              borderRadius: '10px',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,122,107,0.18)'}
            onMouseLeave={e => e.currentTarget.style.background = tokens.redDim}
          >
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.red }}>Outstanding Debt Load</div>
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px' }}>Track your payoff progress</div>
            </div>
            <div style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.red }}>
              ${totalDebt.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Quote */}
      <div className="fade-up stagger-6" style={{ textAlign: 'center', padding: '20px 0', borderTop: `1px solid ${tokens.border}` }}>
        <p style={{ fontFamily: fonts.display, fontSize: '15px', color: tokens.textMuted, fontStyle: 'italic', lineHeight: 1.7 }}>
          "{quote.text}"
        </p>
        {quote.attr && <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '6px', letterSpacing: '0.08em' }}>— {quote.attr}</div>}
      </div>
    </div>
  );
}
