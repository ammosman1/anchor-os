// src/components/TaskModal.js
// Unified task create/edit modal used by every screen.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { tokens, fonts } from '../lib/tokens';
import { useData } from '../context/DataContext';
import { RECURRENCE_OPTIONS } from '../lib/tasks';
import { Modal, Button, Input, Select } from './ui';

// ─── Shared constants (exported so screens can reuse) ─────────────────────────
export const TASK_PRIORITIES = [
  { value: 'critical', label: '🔴 Critical' },
  { value: 'high',     label: '🟠 High'     },
  { value: 'medium',   label: '🟡 Medium'   },
  { value: 'low',      label: '⚪ Low'      },
];

export const FOCUS_TYPES = [
  { value: 'deep',    label: '🧠 Deep Work' },
  { value: 'shallow', label: '💬 Shallow'   },
  { value: 'admin',   label: '📋 Admin'     },
];

export const CONTEXT_OPTIONS = [
  { value: 'work',      label: 'Work'      },
  { value: 'personal',  label: 'Personal'  },
  { value: 'home',      label: 'Home'      },
  { value: 'financial', label: 'Financial' },
  { value: 'health',    label: 'Health'    },
];

export const CATEGORY_TO_CONTEXT = {
  work: 'work', personal: 'personal', home: 'home',
  finance: 'financial', health: 'health', creative: 'personal', business: 'work',
};

export function parseTags(str) {
  if (!str) return [];
  return String(str).split(',').map(s => s.trim()).filter(Boolean);
}

// ─── Day-of-week constants ────────────────────────────────────────────────────
const DAYS = [
  { key: 'mon', label: 'Mo' }, { key: 'tue', label: 'Tu' },
  { key: 'wed', label: 'We' }, { key: 'thu', label: 'Th' },
  { key: 'fri', label: 'Fr' }, { key: 'sat', label: 'Sa' },
  { key: 'sun', label: 'Su' },
];
const WEEKDAYS = ['mon','tue','wed','thu','fri'];
const WEEKENDS  = ['sat','sun'];

function daysMatch(a, b) {
  if (a.length !== b.length) return false;
  return [...a].sort().join() === [...b].sort().join();
}

// ─── Empty form ───────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  title: '', priority: 'high', projectId: '', goalId: '',
  context: 'personal', focusType: 'deep', recurrence: 'none',
  startDate: '', dueDate: '', estimatedMinutes: '',
  tags: '', notes: '', blockedBy: [], checklist: [], availableDays: [],
};

function newChecklistItem(text = '') {
  return { id: `ci_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, text, done: false };
}

// ─── Style helpers ────────────────────────────────────────────────────────────
function labelStyle() {
  return { fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' };
}
function selectStyle() {
  return { width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body };
}
function dateStyle() {
  return { width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', colorScheme: 'dark' };
}
function inputStyle() {
  return { width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' };
}

// ─── Collapsible section ──────────────────────────────────────────────────────
function Section({ label, open, onToggle, badge, children }) {
  return (
    <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: '4px' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', fontFamily: fonts.body, userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: open ? tokens.accent : tokens.textMuted }}>{label}</span>
          {badge && <span style={{ fontSize: '10px', background: tokens.accentDim, color: tokens.accent, borderRadius: '99px', padding: '1px 7px', fontWeight: 600 }}>{badge}</span>}
        </div>
        <span style={{ fontSize: '10px', color: tokens.textMuted, transition: 'transform 0.15s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '8px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TaskModal({
  open,
  onClose,
  onSave,
  onAutoSave,           // called on debounced changes in edit mode (no close)
  task        = null,   // existing task → edit mode; null → create mode
  defaultValues = {},
  extraActions  = null,
  saving        = false,
  modalTitle,
}) {
  const { projects = [], goals = [], tasks = [] } = useData();

  const [form,          setForm]          = useState(EMPTY_FORM);
  const [blockerSearch, setBlockerSearch] = useState('');
  const [newItemText,   setNewItemText]   = useState('');
  const newItemRef = useRef(null);

  // Section open states
  const [scheduleOpen,  setScheduleOpen]  = useState(false);
  const [detailsOpen,   setDetailsOpen]   = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  // Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const autoSaveTimer   = useRef(null);
  const justOpenedRef   = useRef(false); // skip first form-change effect after open

  // ── Initialize form on open / task change ──────────────────────────────────
  useEffect(() => {
    if (!open) return;
    justOpenedRef.current = true;
    setAutoSaveStatus('idle');

    if (task) {
      setForm({
        title:            task.title            || '',
        priority:         task.priority         || 'high',
        projectId:        task.projectId        || '',
        goalId:           task.goalId           || '',
        context:          task.context          || 'personal',
        focusType:        task.focusType        || 'deep',
        recurrence:       task.recurrence       || 'none',
        startDate:        task.startDate        || '',
        dueDate:          task.dueDate          || '',
        estimatedMinutes: task.estimatedMinutes ? String(task.estimatedMinutes) : '',
        tags:             Array.isArray(task.tags) ? task.tags.join(', ') : (task.tags || ''),
        notes:            task.notes            || '',
        blockedBy:        task.blockedBy        || [],
        checklist:        task.checklist        || [],
        availableDays:    task.availableDays    || [],
      });
      // Smart section defaults based on existing values
      setScheduleOpen(!!(
        task.startDate || task.dueDate || task.estimatedMinutes ||
        (task.recurrence && task.recurrence !== 'none') ||
        task.availableDays?.length ||
        (task.context && task.context !== 'personal') ||
        (task.focusType && task.focusType !== 'deep')
      ));
      setDetailsOpen(!!(
        task.goalId || task.tags?.length || task.blockedBy?.length || task.notes
      ));
      setChecklistOpen(!!(task.checklist?.length));
    } else {
      setForm({ ...EMPTY_FORM, ...defaultValues });
      setScheduleOpen(false);
      setDetailsOpen(false);
      setChecklistOpen(false);
    }
    setBlockerSearch('');
    setNewItemText('');
  }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build save payload (shared by auto-save and manual save) ──────────────
  const buildPayload = useCallback((f) => {
    const linkedProject = projects.find(p => p.id === f.projectId);
    const derivedContext = linkedProject
      ? (CATEGORY_TO_CONTEXT[linkedProject.category] || f.context || 'personal')
      : (f.context || 'personal');
    return {
      title:            f.title.trim(),
      priority:         f.priority,
      projectId:        f.projectId || null,
      project:          linkedProject?.title || (task?.project || 'Inbox'),
      goalId:           f.goalId || null,
      context:          derivedContext,
      focusType:        f.focusType || 'deep',
      recurrence:       f.recurrence || 'none',
      startDate:        f.startDate  || null,
      dueDate:          f.dueDate    || null,
      estimatedMinutes: parseInt(f.estimatedMinutes) || null,
      tags:             parseTags(f.tags),
      notes:            f.notes,
      blockedBy:        f.blockedBy || [],
      checklist:        f.checklist || [],
      availableDays:    f.availableDays || [],
    };
  }, [projects, task]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save debounce (edit mode only) ────────────────────────────────────
  useEffect(() => {
    if (justOpenedRef.current) { justOpenedRef.current = false; return; }
    if (!task || !onAutoSave || !form.title.trim()) return;

    setAutoSaveStatus('saving');
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await onAutoSave(buildPayload(form));
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus('idle'), 2000);
      } catch {
        setAutoSaveStatus('idle');
      }
    }, 800);
    return () => clearTimeout(autoSaveTimer.current);
  }, [form]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────────
  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const handleSave = () => {
    if (!form.title.trim() || saving) return;
    onSave(buildPayload(form));
  };

  const handleDone = () => {
    // Flush any pending auto-save synchronously before closing
    if (autoSaveStatus === 'saving' && task && onAutoSave && form.title.trim()) {
      clearTimeout(autoSaveTimer.current);
      onAutoSave(buildPayload(form));
    }
    onClose();
  };

  const toggleDay = (key) => {
    setForm(f => {
      const days = f.availableDays || [];
      const next = days.includes(key) ? days.filter(d => d !== key) : [...days, key];
      return { ...f, availableDays: next };
    });
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeGoals    = (goals    || []).filter(g => g.status === 'active');
  const activeProjects = (projects || []).filter(p => p.status === 'active');
  const blockerCandidates = tasks.filter(t =>
    !t.done && t.id !== task?.id &&
    t.title.toLowerCase().includes(blockerSearch.toLowerCase()) &&
    !(form.blockedBy || []).includes(t.id)
  ).slice(0, 5);

  const ad = form.availableDays || [];
  const quickPick = ad.length === 0 ? 'any' : daysMatch(ad, WEEKDAYS) ? 'weekdays' : daysMatch(ad, WEEKENDS) ? 'weekends' : 'custom';

  const scheduleBadge = (() => {
    const parts = [];
    if (form.estimatedMinutes) parts.push(`${form.estimatedMinutes}m`);
    if (form.dueDate) parts.push(`due ${form.dueDate}`);
    if (ad.length && quickPick !== 'any') parts.push(quickPick === 'weekdays' ? 'Weekdays' : quickPick === 'weekends' ? 'Weekends' : `${ad.length}d`);
    return parts.length ? parts.join(' · ') : null;
  })();
  const detailsBadge = (() => {
    const parts = [];
    if (form.goalId) parts.push('goal');
    if (form.blockedBy?.length) parts.push(`${form.blockedBy.length} blocker`);
    if (form.notes) parts.push('notes');
    return parts.length ? parts.join(' · ') : null;
  })();
  const checklistBadge = form.checklist?.length
    ? `${form.checklist.filter(i => i.done).length}/${form.checklist.length}`
    : null;

  const isEditMode = !!task;
  const modalTitleText = modalTitle || (isEditMode ? 'Edit Task' : 'New Task');

  // Auto-save status indicator
  const statusEl = isEditMode && onAutoSave ? (
    <span style={{ fontSize: '11px', color: autoSaveStatus === 'saved' ? tokens.green : tokens.textMuted, marginLeft: '8px', fontWeight: 500, transition: 'opacity 0.3s', opacity: autoSaveStatus === 'idle' ? 0 : 1 }}>
      {autoSaveStatus === 'saving' ? '↻ Saving…' : '✓ Saved'}
    </span>
  ) : null;

  return (
    <Modal open={open} onClose={isEditMode ? handleDone : onClose} title={<span>{modalTitleText}{statusEl}</span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>

        {/* ── Core (always visible) ────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '8px' }}>
          <Input
            label="Task"
            value={form.title}
            onChange={v => set('title', v)}
            placeholder="What needs to get done?"
            autoFocus
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Select label="Priority" value={form.priority} onChange={v => set('priority', v)} options={TASK_PRIORITIES} />
            <div>
              <label style={labelStyle()}>Project</label>
              <select
                value={form.projectId}
                onChange={e => {
                  const proj = projects.find(p => p.id === e.target.value);
                  const inherited = proj ? (CATEGORY_TO_CONTEXT[proj.category] || form.context) : form.context;
                  setForm(f => ({ ...f, projectId: e.target.value, context: inherited }));
                }}
                style={selectStyle()}
              >
                <option value="">Inbox</option>
                {activeProjects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── Schedule section ─────────────────────────────────────────────── */}
        <Section label="Schedule" open={scheduleOpen} onToggle={() => setScheduleOpen(o => !o)} badge={!scheduleOpen ? scheduleBadge : null}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={labelStyle()}>Context</label>
              <select value={form.context} onChange={e => set('context', e.target.value)} style={selectStyle()}>
                {CONTEXT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <Select label="Focus Type" value={form.focusType} onChange={v => set('focusType', v)} options={FOCUS_TYPES} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Input label="Est. Minutes" value={form.estimatedMinutes} onChange={v => set('estimatedMinutes', v)} placeholder="30, 60…" type="number" />
            <Select label="Repeat" value={form.recurrence} onChange={v => set('recurrence', v)} options={RECURRENCE_OPTIONS} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={labelStyle()}>Start Date <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(available from)</span></label>
              <input type="date" value={form.startDate} max={form.dueDate || undefined} onChange={e => set('startDate', e.target.value)} style={dateStyle()} />
            </div>
            <div>
              <label style={labelStyle()}>Due Date</label>
              <input type="date" value={form.dueDate} min={form.startDate || undefined} onChange={e => set('dueDate', e.target.value)} style={dateStyle()} />
            </div>
          </div>

          {/* Available Days */}
          <div>
            <label style={labelStyle()}>Available Days <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(when can this be scheduled?)</span></label>
            {/* Quick-picks */}
            <div style={{ display: 'flex', gap: '5px', marginBottom: '7px' }}>
              {[
                { key: 'any',      label: 'Any day',  days: [] },
                { key: 'weekdays', label: 'Weekdays', days: WEEKDAYS },
                { key: 'weekends', label: 'Weekends', days: WEEKENDS },
              ].map(({ key, label, days }) => (
                <button key={key} type="button"
                  onClick={() => set('availableDays', days)}
                  style={{ padding: '4px 12px', fontSize: '11px', fontWeight: 600, borderRadius: '99px', cursor: 'pointer', fontFamily: fonts.body, transition: 'all 0.12s',
                    background: quickPick === key ? tokens.accent : tokens.bgInput,
                    color: quickPick === key ? tokens.accentText || '#fff' : tokens.textSecondary,
                    border: `1px solid ${quickPick === key ? tokens.accent : tokens.border}`,
                  }}
                >{label}</button>
              ))}
            </div>
            {/* Day grid */}
            <div style={{ display: 'flex', gap: '4px' }}>
              {DAYS.map(({ key, label }) => {
                const active = ad.includes(key);
                return (
                  <button key={key} type="button" onClick={() => toggleDay(key)}
                    style={{ flex: 1, padding: '6px 2px', fontSize: '11px', fontWeight: 700, borderRadius: '7px', cursor: 'pointer', fontFamily: fonts.body, transition: 'all 0.12s',
                      background: active ? tokens.accentDim : tokens.bgInput,
                      color: active ? tokens.accent : tokens.textMuted,
                      border: `1px solid ${active ? tokens.accent : tokens.border}`,
                    }}
                  >{label}</button>
                );
              })}
            </div>
          </div>
        </Section>

        {/* ── Details section ──────────────────────────────────────────────── */}
        <Section label="Details" open={detailsOpen} onToggle={() => setDetailsOpen(o => !o)} badge={!detailsOpen ? detailsBadge : null}>
          {activeGoals.length > 0 && (
            <div>
              <label style={labelStyle()}>Goal <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
              <select value={form.goalId} onChange={e => set('goalId', e.target.value)} style={selectStyle()}>
                <option value="">No goal linked</option>
                {activeGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </div>
          )}

          <Input label="Tags (comma-separated)" value={form.tags} onChange={v => set('tags', v)} placeholder="e.g. email, client, urgent" />

          <div>
            <label style={labelStyle()}>Blocked By</label>
            {(form.blockedBy || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
                {(form.blockedBy || []).map(id => {
                  const bt = tasks.find(t => t.id === id);
                  return bt ? (
                    <span key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', background: 'rgba(200,160,50,0.15)', color: tokens.amber, border: '1px solid rgba(200,160,50,0.3)', borderRadius: '5px', padding: '2px 8px', fontWeight: 600 }}>
                      ⊘ {bt.title.length > 32 ? bt.title.slice(0, 32) + '…' : bt.title}
                      <button onClick={() => setForm(f => ({ ...f, blockedBy: f.blockedBy.filter(b => b !== id) }))} style={{ background: 'none', border: 'none', color: tokens.amber, cursor: 'pointer', fontSize: '11px', lineHeight: 1, padding: '0 0 0 2px', fontFamily: fonts.body }}>✕</button>
                    </span>
                  ) : null;
                })}
              </div>
            )}
            <input value={blockerSearch} onChange={e => setBlockerSearch(e.target.value)} placeholder="Search for a task that blocks this one…"
              style={inputStyle()} onFocus={e => e.target.style.borderColor = tokens.borderFocus} onBlur={e => { e.target.style.borderColor = tokens.border; }} />
            {blockerSearch.trim() && (
              <div style={{ marginTop: '4px', border: `1px solid ${tokens.border}`, borderRadius: '8px', overflow: 'hidden', background: tokens.bgCard }}>
                {blockerCandidates.length === 0
                  ? <div style={{ padding: '8px 12px', fontSize: '12px', color: tokens.textMuted }}>No matching tasks</div>
                  : blockerCandidates.map((t, i) => (
                      <div key={t.id}
                        onMouseDown={() => { setForm(f => ({ ...f, blockedBy: [...(f.blockedBy || []), t.id] })); setBlockerSearch(''); }}
                        style={{ padding: '8px 12px', fontSize: '13px', color: tokens.textPrimary, cursor: 'pointer', borderBottom: i < blockerCandidates.length - 1 ? `1px solid ${tokens.border}` : 'none', display: 'flex', alignItems: 'center', gap: '8px' }}
                        onMouseEnter={e => e.currentTarget.style.background = tokens.bgGlass}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <span style={{ fontSize: '10px', color: tokens.textMuted, textTransform: 'capitalize' }}>{t.priority}</span>
                        {t.title}
                      </div>
                    ))
                }
              </div>
            )}
          </div>

          <Input label="Notes" value={form.notes} onChange={v => set('notes', v)} placeholder="Any context…" multiline rows={3} />
        </Section>

        {/* ── Checklist section ────────────────────────────────────────────── */}
        <Section label="Checklist" open={checklistOpen} onToggle={() => setChecklistOpen(o => !o)} badge={!checklistOpen ? checklistBadge : null}>
          {(form.checklist || []).map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '-4px' }}>
              <input type="checkbox" checked={item.done}
                onChange={() => setForm(f => ({ ...f, checklist: f.checklist.map(i => i.id === item.id ? { ...i, done: !i.done } : i) }))}
                style={{ width: 15, height: 15, flexShrink: 0, cursor: 'pointer', accentColor: tokens.accent }} />
              <input value={item.text}
                onChange={e => setForm(f => ({ ...f, checklist: f.checklist.map(i => i.id === item.id ? { ...i, text: e.target.value } : i) }))}
                style={{ ...inputStyle(), flex: 1, padding: '5px 10px', fontSize: '13px', textDecoration: item.done ? 'line-through' : 'none', color: item.done ? tokens.textMuted : tokens.textPrimary }}
                onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                onBlur={e => e.target.style.borderColor = tokens.border} />
              <button onClick={() => setForm(f => ({ ...f, checklist: f.checklist.filter(i => i.id !== item.id) }))}
                style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            <input ref={newItemRef} value={newItemText} onChange={e => setNewItemText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newItemText.trim()) {
                  setForm(f => ({ ...f, checklist: [...(f.checklist || []), newChecklistItem(newItemText.trim())] }));
                  setNewItemText('');
                }
              }}
              placeholder="Add item… (press Enter)"
              style={{ ...inputStyle(), flex: 1, padding: '5px 10px', fontSize: '13px' }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border} />
            <button
              onClick={() => {
                if (!newItemText.trim()) return;
                setForm(f => ({ ...f, checklist: [...(f.checklist || []), newChecklistItem(newItemText.trim())] }));
                setNewItemText('');
                newItemRef.current?.focus();
              }}
              style={{ padding: '5px 12px', background: tokens.accentDim, border: `1px solid ${tokens.accentDim}`, borderRadius: '8px', color: tokens.accent, fontWeight: 600, fontSize: '12px', cursor: 'pointer', fontFamily: fonts.body, flexShrink: 0 }}
            >+ Add</button>
          </div>
        </Section>

        {/* Completion note (read-only) */}
        {task?.completionNote && (
          <div style={{ marginTop: '8px', padding: '10px 12px', background: tokens.greenDim, border: `1px solid ${tokens.green}22`, borderRadius: '8px', fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700, color: tokens.green, fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>✓ Completion Note</span>
            {task.completionNote}
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', paddingTop: '12px', borderTop: `1px solid ${tokens.border}`, marginTop: '4px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>{extraActions}</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {isEditMode ? (
              // Edit mode: Done closes (data already auto-saved)
              <Button onClick={handleDone}>Done</Button>
            ) : (
              // Create mode: explicit save required
              <>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>Add Task</Button>
              </>
            )}
          </div>
        </div>

      </div>
    </Modal>
  );
}
