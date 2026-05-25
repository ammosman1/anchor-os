// src/components/screens/HabitsScreen.js
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addHabit, updateHabit, deleteHabit, setHabitLog, getAICache, saveAICache } from '../../lib/db';
import { generateHabitInsights } from '../../lib/ai';
import { Button, Modal, Input } from '../ui';

const FREQUENCIES = [
  { value: 'daily',    label: 'Every day'    },
  { value: 'weekdays', label: 'Weekdays only' },
  { value: 'weekly',   label: 'Once a week'  },
];

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function isActiveDay(habit, dateStr) {
  if (habit.frequency === 'weekdays') {
    const day = new Date(dateStr + 'T12:00:00').getDay();
    return day >= 1 && day <= 5;
  }
  return true;
}

function getStreak(habitId, habitLogs) {
  const today = todayStr();
  const doneDates = new Set(
    habitLogs.filter(l => l.habitId === habitId && l.done).map(l => l.date)
  );
  let d = new Date();
  if (!doneDates.has(today)) d.setDate(d.getDate() - 1);
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const ds = d.toISOString().split('T')[0];
    if (!doneDates.has(ds)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function getBestStreak(habitId, habitLogs) {
  const sorted = habitLogs
    .filter(l => l.habitId === habitId && l.done)
    .map(l => l.date)
    .sort();
  if (sorted.length === 0) return 0;
  let best = 1, current = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = (new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000;
    if (diff === 1) { current++; if (current > best) best = current; }
    else { current = 1; }
  }
  return best;
}

// Returns only days from startDate (or up to 30 days back if no startDate)
function getHeatmapDays(habitId, habitLogs, startDate) {
  const result = [];
  const today = new Date();
  const start = startDate ? new Date(startDate + 'T12:00:00') : null;
  for (let i = 29; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    if (start && day < start) continue;
    const ds = day.toISOString().split('T')[0];
    const log = habitLogs.find(l => l.habitId === habitId && l.date === ds);
    result.push({ date: ds, done: !!(log?.done) });
  }
  return result;
}

// Completion rate counts only from startDate forward (or 30 days if no startDate)
function getCompletionRate(habitId, habitLogs, startDate) {
  const today = new Date();
  const start = startDate ? new Date(startDate + 'T12:00:00') : null;
  let done = 0, total = 0;
  for (let i = 0; i < 30; i++) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    if (start && day < start) break;
    total++;
    const ds = day.toISOString().split('T')[0];
    const log = habitLogs.find(l => l.habitId === habitId && l.date === ds);
    if (log?.done) done++;
  }
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function getTotalCompletions(habitId, habitLogs) {
  return habitLogs.filter(l => l.habitId === habitId && l.done).length;
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const BLANK_FORM = { title: '', frequency: 'daily', goalId: '', startDate: todayStr(), description: '' };

export default function HabitsScreen() {
  const { user }                     = useAuth();
  const { habits, habitLogs, goals } = useData();
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editHabit,    setEditHabit]    = useState(null);
  const [form,         setForm]         = useState(BLANK_FORM);
  const [saving,       setSaving]       = useState(false);
  const [toggling,      setToggling]     = useState(new Set());
  const [retroToggling, setRetroToggling] = useState(new Set());
  const [toggleError,   setToggleError]   = useState('');
  const [deleteConf,   setDeleteConf]   = useState(null);
  const [aiInsights,   setAiInsights]   = useState('');
  const [insightsLoading, setInsightsLoading] = useState(false);

  const today       = todayStr();
  const activeGoals = (goals || []).filter(g => g.status === 'active');

  const openAdd  = () => { setEditHabit(null); setForm(BLANK_FORM); setModalOpen(true); };
  const openEdit = (h) => {
    setEditHabit(h);
    setForm({
      title: h.title,
      frequency: h.frequency || 'daily',
      goalId: h.goalId || '',
      startDate: h.startDate || todayStr(),
      description: h.description || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try {
      const data = {
        title: form.title.trim(),
        frequency: form.frequency,
        goalId: form.goalId || null,
        startDate: form.startDate || todayStr(),
        description: form.description.trim() || null,
      };
      if (editHabit) {
        await updateHabit(user.uid, editHabit.id, data);
      } else {
        await addHabit(user.uid, data);
      }
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (habit) => {
    if (toggling.has(habit.id)) return;
    setToggling(prev => new Set(prev).add(habit.id));
    setToggleError('');
    try {
      const log = (habitLogs || []).find(l => l.habitId === habit.id && l.date === today);
      await setHabitLog(user.uid, habit.id, today, !(log?.done));
    } catch (err) {
      console.error('Habit toggle error:', err);
      setToggleError('Could not save — check your connection and try again.');
      setTimeout(() => setToggleError(''), 4000);
    } finally {
      setToggling(prev => { const n = new Set(prev); n.delete(habit.id); return n; });
    }
  };

  const handleRetroToggle = async (habit, date) => {
    const key = `${habit.id}_${date}`;
    if (retroToggling.has(key)) return;
    setRetroToggling(prev => new Set(prev).add(key));
    try {
      const log = (habitLogs || []).find(l => l.habitId === habit.id && l.date === date);
      await setHabitLog(user.uid, habit.id, date, !(log?.done));
    } catch (err) {
      console.error('Retro toggle error:', err);
    } finally {
      setRetroToggling(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  const handleDelete = async () => {
    if (!deleteConf) return;
    await deleteHabit(user.uid, deleteConf.id);
    setDeleteConf(null);
  };

  const activeHabits = useMemo(() =>
    (habits || []).filter(h => h.active !== false),
    [habits]
  );

  const completedToday   = activeHabits.filter(h => !!(habitLogs.find(l => l.habitId === h.id && l.date === today)?.done)).length;
  const scheduledToday   = activeHabits.filter(h => isActiveDay(h, today)).length;

  const bestCurrentStreak = useMemo(() =>
    activeHabits.reduce((max, h) => Math.max(max, getStreak(h.id, habitLogs)), 0),
    [activeHabits, habitLogs]
  );

  const overallRate = useMemo(() => {
    if (activeHabits.length === 0) return 0;
    const rates = activeHabits.map(h => getCompletionRate(h.id, habitLogs, h.startDate));
    return Math.round(rates.reduce((s, r) => s + r, 0) / rates.length);
  }, [activeHabits, habitLogs]);

  const loadInsights = useCallback(async (force = false) => {
    if (activeHabits.length === 0) return;
    const cacheKey = `habit-insights-${today}`;
    if (!force) {
      const cached = await getAICache(user.uid, cacheKey, 24);
      if (cached) { setAiInsights(cached); return; }
    }
    setInsightsLoading(true);
    try {
      const text = await generateHabitInsights(activeHabits, habitLogs);
      if (text) {
        setAiInsights(text);
        await saveAICache(user.uid, cacheKey, text);
      }
    } finally {
      setInsightsLoading(false);
    }
  }, [user.uid, today, activeHabits, habitLogs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeHabits.length > 0) loadInsights();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, margin: 0, letterSpacing: '-0.02em' }}>
            Habits
          </h1>
          {activeHabits.length > 0 && (
            <div style={{ fontSize: '13px', color: tokens.textMuted, marginTop: '4px' }}>
              {completedToday} / {scheduledToday} done today
            </div>
          )}
        </div>
        <Button onClick={openAdd}>+ Add Habit</Button>
      </div>

      {/* Summary stats row */}
      {activeHabits.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
          {[
            { label: 'Active Habits', val: activeHabits.length,                  color: tokens.textPrimary },
            { label: 'Done Today',    val: `${completedToday}/${scheduledToday}`, color: completedToday === scheduledToday && scheduledToday > 0 ? tokens.green : tokens.accent },
            { label: 'Best Streak',   val: `${bestCurrentStreak}d`,              color: bestCurrentStreak >= 7 ? tokens.accent : tokens.textSecondary },
            { label: 'Avg Rate',      val: `${overallRate}%`,                    color: overallRate >= 70 ? tokens.green : overallRate >= 40 ? tokens.accent : tokens.red },
          ].map(item => (
            <div key={item.label} style={{
              background: tokens.bgCard, border: `1px solid ${tokens.border}`,
              borderRadius: '12px', padding: '14px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color: item.color, lineHeight: 1 }}>{item.val}</div>
              <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '5px' }}>{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* AI Insights card */}
      {activeHabits.length > 0 && (
        <div style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', padding: '14px 16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>✦ AI Insights</div>
            <button
              onClick={() => loadInsights(true)}
              disabled={insightsLoading}
              style={{ background: 'none', border: 'none', cursor: insightsLoading ? 'default' : 'pointer', fontSize: '11px', color: tokens.textMuted, fontFamily: fonts.body, padding: 0, opacity: insightsLoading ? 0.5 : 1 }}
            >
              {insightsLoading ? 'Analyzing...' : '↺ Refresh'}
            </button>
          </div>
          {insightsLoading && !aiInsights ? (
            <div style={{ fontSize: '12px', color: tokens.textMuted }}>Analyzing your habit patterns...</div>
          ) : aiInsights ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {aiInsights.split('\n').filter(l => l.trim()).map((line, i) => (
                <div key={i} style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>{line}</div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: tokens.textMuted }}>Track a few habits to see personalized insights.</div>
          )}
        </div>
      )}

      {/* Empty state */}
      {activeHabits.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: tokens.textMuted }}>
          <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.4 }}>⊙</div>
          <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: tokens.textSecondary }}>No habits yet</div>
          <div style={{ fontSize: '13px', marginBottom: '20px', lineHeight: 1.6 }}>
            Add daily habits to track your consistency and build streaks.
          </div>
          <Button onClick={openAdd}>+ Add Your First Habit</Button>
        </div>
      )}

      {toggleError && (
        <div style={{ background: 'rgba(220,60,60,0.12)', border: '1px solid rgba(220,60,60,0.3)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: tokens.red, marginBottom: '12px' }}>
          {toggleError}
        </div>
      )}

      {/* Habit list */}
      {activeHabits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {activeHabits.map(habit => {
            const log         = habitLogs.find(l => l.habitId === habit.id && l.date === today);
            const isDone      = !!(log?.done);
            const isLoading   = toggling.has(habit.id);
            const streak      = getStreak(habit.id, habitLogs);
            const bestStreak  = getBestStreak(habit.id, habitLogs);
            const heatmap     = getHeatmapDays(habit.id, habitLogs, habit.startDate);
            const rate        = getCompletionRate(habit.id, habitLogs, habit.startDate);
            const totalDone   = getTotalCompletions(habit.id, habitLogs);
            const linkedGoal  = activeGoals.find(g => g.id === habit.goalId);
            const activeToday = isActiveDay(habit, today);
            const startLabel  = habit.startDate ? formatShortDate(habit.startDate) : '30 days ago';
            const isNew       = habit.startDate && heatmap.length < 30;

            return (
              <div key={habit.id} style={{
                background: tokens.bgCard, border: `1px solid ${isDone ? tokens.green : tokens.border}`,
                borderRadius: '12px', padding: '14px 16px',
                transition: 'border-color 0.2s',
              }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    onClick={() => activeToday && handleToggle(habit)}
                    disabled={!activeToday || isLoading}
                    title={activeToday ? (isDone ? 'Mark incomplete' : 'Mark complete') : 'Not scheduled today'}
                    style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${isDone ? tokens.green : tokens.border}`,
                      background: isDone ? tokens.greenDim : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: activeToday ? 'pointer' : 'default',
                      fontSize: '14px', color: tokens.green,
                      transition: 'all 0.15s', opacity: activeToday ? 1 : 0.4,
                    }}
                  >
                    {isLoading ? '·' : isDone ? '✓' : ''}
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: isDone ? tokens.textMuted : tokens.textPrimary, textDecoration: isDone ? 'line-through' : 'none', lineHeight: 1.3 }}>
                      {habit.title}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '10px', color: tokens.textMuted }}>
                        {FREQUENCIES.find(f => f.value === habit.frequency)?.label || 'Every day'}
                      </span>
                      {isNew && (
                        <span style={{ fontSize: '10px', color: tokens.blue }}>Started {startLabel}</span>
                      )}
                      {linkedGoal && (
                        <span style={{ fontSize: '10px', color: tokens.accent }}>◆ {linkedGoal.title}</span>
                      )}
                      {!activeToday && (
                        <span style={{ fontSize: '10px', color: tokens.textMuted, fontStyle: 'italic' }}>not today</span>
                      )}
                    </div>
                  </div>

                  {streak > 0 && (
                    <div style={{ textAlign: 'center', flexShrink: 0 }}>
                      <div style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: streak >= 7 ? tokens.accent : tokens.textSecondary, lineHeight: 1 }}>
                        {streak}
                      </div>
                      <div style={{ fontSize: '9px', color: tokens.textMuted, lineHeight: 1, marginTop: '2px' }}>streak</div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button onClick={() => openEdit(habit)}
                      style={{ background: 'none', border: `1px solid ${tokens.border}`, color: tokens.textMuted, borderRadius: '6px', padding: '3px 8px', cursor: 'pointer', fontSize: '11px', fontFamily: fonts.body }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.accent; e.currentTarget.style.color = tokens.accent; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = tokens.textMuted; }}
                    >✎</button>
                    <button onClick={() => setDeleteConf(habit)}
                      style={{ background: 'none', border: `1px solid ${tokens.border}`, color: tokens.textMuted, borderRadius: '6px', padding: '3px 8px', cursor: 'pointer', fontSize: '11px', fontFamily: fonts.body }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.red; e.currentTarget.style.color = tokens.red; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = tokens.textMuted; }}
                    >✕</button>
                  </div>
                </div>

                {/* Heatmap — only days from startDate; past 7 days are retroactively editable */}
                <div style={{ marginTop: '12px' }}>
                  {/* Day-of-week labels above dots */}
                  <div style={{ display: 'flex', gap: '3px', overflowX: 'auto', marginBottom: '3px' }}>
                    {heatmap.map((day, i) => {
                      const d = new Date(day.date + 'T12:00:00');
                      const dow = ['S','M','T','W','T','F','S'][d.getDay()];
                      const showLabel = i === 0 || d.getDay() === 1; // always show first + every Monday
                      return (
                        <div key={i} style={{ width: 13, height: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {showLabel && (
                            <span style={{ fontSize: '8px', color: tokens.textMuted, fontWeight: 600, lineHeight: 1 }}>{dow}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Heatmap dots */}
                  <div style={{ display: 'flex', gap: '3px', overflowX: 'auto' }}>
                    {heatmap.map((day, i) => {
                      const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                      const retroEditable = day.date < today && day.date >= sevenDaysAgo.toISOString().split('T')[0];
                      const retroKey = `${habit.id}_${day.date}`;
                      const retroLoading = retroToggling.has(retroKey);
                      const isToday = day.date === today;
                      const d = new Date(day.date + 'T12:00:00');
                      const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      return (
                        <div
                          key={i}
                          onClick={retroEditable ? () => handleRetroToggle(habit, day.date) : undefined}
                          title={`${dateLabel}: ${day.done ? 'Done ✓' : 'Missed'}${retroEditable ? ' (click to edit)' : ''}`}
                          style={{
                            width: 13, height: 13, flexShrink: 0, borderRadius: '3px',
                            background: retroLoading ? tokens.accent : day.done ? tokens.green : 'rgba(255,255,255,0.07)',
                            border: isToday
                              ? `1.5px solid ${tokens.accent}`
                              : day.done
                                ? `1px solid rgba(109,191,158,0.4)`
                                : retroEditable
                                  ? `1px solid rgba(255,255,255,0.18)`
                                  : `1px solid rgba(255,255,255,0.07)`,
                            opacity: retroLoading ? 0.7 : day.done ? 1 : retroEditable ? 0.7 : 0.4,
                            cursor: retroEditable ? 'pointer' : 'default',
                            transition: 'background 0.15s, opacity 0.15s, border-color 0.15s',
                            boxSizing: 'border-box',
                          }}
                        />
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontSize: '9px', color: tokens.textMuted }}>
                    <span>{startLabel}</span>
                    <span style={{ fontStyle: 'italic' }}>tap past 7d to edit</span>
                    <span>Today</span>
                  </div>
                </div>

                {/* Per-habit stats */}
                <div style={{ display: 'flex', gap: '20px', marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${tokens.border}` }}>
                  <div>
                    <div style={{ fontFamily: fonts.display, fontSize: '14px', fontWeight: 700, color: rate >= 70 ? tokens.green : rate >= 40 ? tokens.accent : tokens.red, lineHeight: 1 }}>{rate}%</div>
                    <div style={{ fontSize: '9px', color: tokens.textMuted, marginTop: '2px' }}>rate</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: fonts.display, fontSize: '14px', fontWeight: 700, color: tokens.textSecondary, lineHeight: 1 }}>{bestStreak}</div>
                    <div style={{ fontSize: '9px', color: tokens.textMuted, marginTop: '2px' }}>best streak</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: fonts.display, fontSize: '14px', fontWeight: 700, color: tokens.textSecondary, lineHeight: 1 }}>{totalDone}</div>
                    <div style={{ fontSize: '9px', color: tokens.textMuted, marginTop: '2px' }}>total done</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editHabit ? 'Edit Habit' : 'New Habit'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input
            label="Habit"
            value={form.title}
            onChange={v => setForm(p => ({ ...p, title: v }))}
            placeholder="e.g. Morning walk, Read 20 min, No screens before 9am"
          />
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Why / Purpose <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — helps AI understand intent)</span></label>
            <textarea
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="e.g. Mental clarity and energy for afternoon focus blocks, ties to long-term health goal"
              rows={2}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Frequency</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {FREQUENCIES.map(f => (
                <button key={f.value} onClick={() => setForm(p => ({ ...p, frequency: f.value }))}
                  style={{
                    flex: 1, padding: '8px 6px', fontSize: '11px', fontWeight: 600, borderRadius: '8px',
                    background: form.frequency === f.value ? tokens.accentDim : tokens.bgInput,
                    border: `1px solid ${form.frequency === f.value ? tokens.accent : tokens.border}`,
                    color: form.frequency === f.value ? tokens.accent : tokens.textSecondary,
                    cursor: 'pointer', fontFamily: fonts.body, textAlign: 'center', transition: 'all 0.12s',
                  }}
                >{f.label}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Start Date</label>
            <input
              type="date"
              value={form.startDate}
              max={todayStr()}
              onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', colorScheme: 'dark' }}
            />
          </div>
          {activeGoals.length > 0 && (
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Link to Goal (optional)</label>
              <select value={form.goalId} onChange={e => setForm(p => ({ ...p, goalId: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                <option value="">No goal linked</option>
                {activeGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button onClick={() => setModalOpen(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>
              {editHabit ? 'Save Changes' : 'Add Habit'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal open={!!deleteConf} onClose={() => setDeleteConf(null)} title="Delete Habit">
        {deleteConf && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: tokens.textSecondary, lineHeight: 1.6 }}>
              Delete <strong style={{ color: tokens.textPrimary }}>{deleteConf.title}</strong>? All log history will be lost.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setDeleteConf(null)} variant="ghost">Cancel</Button>
              <Button onClick={handleDelete} variant="danger">Delete</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
