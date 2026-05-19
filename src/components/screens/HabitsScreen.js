// src/components/screens/HabitsScreen.js
import React, { useState, useMemo } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addHabit, updateHabit, deleteHabit, setHabitLog } from '../../lib/db';
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

function getLast7(habitId, habitLogs) {
  const result = [];
  const d = new Date();
  for (let i = 6; i >= 0; i--) {
    const day = new Date(d);
    day.setDate(day.getDate() - i);
    const ds = day.toISOString().split('T')[0];
    const log = habitLogs.find(l => l.habitId === habitId && l.date === ds);
    result.push({ date: ds, done: !!(log?.done), dayLabel: ['Su','Mo','Tu','We','Th','Fr','Sa'][day.getDay()] });
  }
  return result;
}

const BLANK_FORM = { title: '', frequency: 'daily', goalId: '' };

export default function HabitsScreen() {
  const { user }                  = useAuth();
  const { habits, habitLogs, goals } = useData();
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editHabit,  setEditHabit]  = useState(null);
  const [form,       setForm]       = useState(BLANK_FORM);
  const [saving,     setSaving]     = useState(false);
  const [toggling,   setToggling]   = useState(new Set());
  const [deleteConf, setDeleteConf] = useState(null);

  const today      = todayStr();
  const activeGoals = (goals || []).filter(g => g.status === 'active');

  const openAdd = () => { setEditHabit(null); setForm(BLANK_FORM); setModalOpen(true); };
  const openEdit = (h) => {
    setEditHabit(h);
    setForm({ title: h.title, frequency: h.frequency || 'daily', goalId: h.goalId || '' });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try {
      const data = { title: form.title.trim(), frequency: form.frequency, goalId: form.goalId || null };
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
    try {
      const log = habitLogs.find(l => l.habitId === habit.id && l.date === today);
      await setHabitLog(user.uid, habit.id, today, !(log?.done));
    } finally {
      setToggling(prev => { const n = new Set(prev); n.delete(habit.id); return n; });
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

  const completedToday = activeHabits.filter(h => {
    const log = habitLogs.find(l => l.habitId === h.id && l.date === today);
    return log?.done;
  }).length;

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
              {completedToday} / {activeHabits.filter(h => isActiveDay(h, today)).length} done today
            </div>
          )}
        </div>
        <Button onClick={openAdd}>+ Add Habit</Button>
      </div>

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

      {/* Habit list */}
      {activeHabits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {activeHabits.map(habit => {
            const log      = habitLogs.find(l => l.habitId === habit.id && l.date === today);
            const isDone   = !!(log?.done);
            const isLoading = toggling.has(habit.id);
            const streak   = getStreak(habit.id, habitLogs);
            const last7    = getLast7(habit.id, habitLogs);
            const linkedGoal = activeGoals.find(g => g.id === habit.goalId);
            const activeToday = isActiveDay(habit, today);

            return (
              <div key={habit.id} style={{
                background: tokens.bgCard, border: `1px solid ${isDone ? tokens.green : tokens.border}`,
                borderRadius: '12px', padding: '14px 16px',
                transition: 'border-color 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {/* Checkbox */}
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

                  {/* Title + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: isDone ? tokens.textMuted : tokens.textPrimary, textDecoration: isDone ? 'line-through' : 'none', lineHeight: 1.3 }}>
                      {habit.title}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '10px', color: tokens.textMuted }}>
                        {FREQUENCIES.find(f => f.value === habit.frequency)?.label || 'Every day'}
                      </span>
                      {linkedGoal && (
                        <span style={{ fontSize: '10px', color: tokens.accent }}>◆ {linkedGoal.title}</span>
                      )}
                      {!activeToday && (
                        <span style={{ fontSize: '10px', color: tokens.textMuted, fontStyle: 'italic' }}>not today</span>
                      )}
                    </div>
                  </div>

                  {/* Streak */}
                  {streak > 0 && (
                    <div style={{ textAlign: 'center', flexShrink: 0 }}>
                      <div style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: streak >= 7 ? tokens.accent : tokens.textSecondary, lineHeight: 1 }}>
                        {streak}
                      </div>
                      <div style={{ fontSize: '9px', color: tokens.textMuted, lineHeight: 1, marginTop: '2px' }}>streak</div>
                    </div>
                  )}

                  {/* Actions */}
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

                {/* Last 7 days mini dots */}
                <div style={{ display: 'flex', gap: '5px', marginTop: '10px', alignItems: 'center' }}>
                  {last7.map((day, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                      <div style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: day.done ? tokens.green : tokens.border,
                        opacity: day.date === today ? 1 : 0.7,
                        border: day.date === today ? `2px solid ${tokens.accent}` : 'none',
                      }} />
                      <span style={{ fontSize: '8px', color: tokens.textMuted, lineHeight: 1 }}>{day.dayLabel}</span>
                    </div>
                  ))}
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
