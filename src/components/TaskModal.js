// src/components/TaskModal.js
// Unified task create/edit modal used by every screen.
// Caller provides onSave(formData) and handles the actual db write.
import React, { useState, useEffect, useRef } from 'react';
import { tokens, fonts } from '../lib/tokens';
import { useData } from '../context/DataContext';
import { RECURRENCE_OPTIONS } from '../lib/tasks';
import { Modal, Button, Input, Select } from './ui';

// ─── shared constants (exported so screens can reuse) ─────────────────────────
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

const EMPTY_FORM = {
  title: '', priority: 'high', projectId: '', goalId: '',
  context: 'personal', focusType: 'deep', recurrence: 'none',
  startDate: '', dueDate: '', estimatedMinutes: '',
  tags: '', notes: '', blockedBy: [], checklist: [],
};

function newChecklistItem(text = '') {
  return { id: `ci_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, text, done: false };
}

function labelStyle() {
  return {
    fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: tokens.textMuted,
    display: 'block', marginBottom: '6px',
  };
}

function selectStyle() {
  return {
    width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`,
    borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary,
    fontSize: '13px', outline: 'none', fontFamily: fonts.body,
  };
}

function dateStyle() {
  return {
    width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`,
    borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary,
    fontSize: '13px', outline: 'none', fontFamily: fonts.body,
    boxSizing: 'border-box', colorScheme: 'dark',
  };
}

function inputStyle() {
  return {
    width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`,
    borderRadius: '8px', padding: '9px 12px', color: tokens.textPrimary,
    fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box',
  };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TaskModal({
  open,
  onClose,
  onSave,
  task        = null,   // existing task → edit mode; null → create mode
  defaultValues = {},   // pre-fill fields when creating (e.g. goalId, projectId)
  extraActions  = null, // extra buttons rendered left of Cancel (e.g. Mark Complete)
  saving        = false,
  modalTitle,
}) {
  const { projects = [], goals = [], tasks = [] } = useData();
  const [form,          setForm]          = useState(EMPTY_FORM);
  const [blockerSearch, setBlockerSearch] = useState('');
  const [newItemText,   setNewItemText]   = useState('');
  const newItemRef = useRef(null);

  // Re-initialize form whenever the modal opens or the target task changes
  useEffect(() => {
    if (!open) return;
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
      });
    } else {
      setForm({ ...EMPTY_FORM, ...defaultValues });
    }
    setBlockerSearch('');
    setNewItemText('');
  }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const handleSave = () => {
    if (!form.title.trim() || saving) return;
    const linkedProject = projects.find(p => p.id === form.projectId);
    const derivedContext = linkedProject
      ? (CATEGORY_TO_CONTEXT[linkedProject.category] || form.context || 'personal')
      : (form.context || 'personal');
    onSave({
      title:            form.title.trim(),
      priority:         form.priority,
      projectId:        form.projectId || null,
      project:          linkedProject?.title || (task?.project || 'Inbox'),
      goalId:           form.goalId || null,
      context:          derivedContext,
      focusType:        form.focusType || 'deep',
      recurrence:       form.recurrence || 'none',
      startDate:        form.startDate  || null,
      dueDate:          form.dueDate    || null,
      estimatedMinutes: parseInt(form.estimatedMinutes) || null,
      tags:             parseTags(form.tags),
      notes:            form.notes,
      blockedBy:        form.blockedBy || [],
      checklist:        form.checklist || [],
    });
  };

  const activeGoals = (goals || []).filter(g => g.status === 'active');
  const activeProjects = (projects || []).filter(p => p.status === 'active');

  const blockerCandidates = tasks.filter(t =>
    !t.done &&
    t.id !== task?.id &&
    t.title.toLowerCase().includes(blockerSearch.toLowerCase()) &&
    !(form.blockedBy || []).includes(t.id)
  ).slice(0, 5);

  const title = modalTitle || (task ? 'Edit Task' : 'New Task');

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* Title */}
        <Input
          label="Task"
          value={form.title}
          onChange={v => set('title', v)}
          placeholder="What needs to get done?"
          autoFocus
        />

        {/* Priority + Project */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <Select
            label="Priority"
            value={form.priority}
            onChange={v => set('priority', v)}
            options={TASK_PRIORITIES}
          />
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

        {/* Context + Focus Type */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label style={labelStyle()}>Context</label>
            <select value={form.context} onChange={e => set('context', e.target.value)} style={selectStyle()}>
              {CONTEXT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <Select
            label="Focus Type"
            value={form.focusType}
            onChange={v => set('focusType', v)}
            options={FOCUS_TYPES}
          />
        </div>

        {/* Goal */}
        {activeGoals.length > 0 && (
          <div>
            <label style={labelStyle()}>Goal <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <select value={form.goalId} onChange={e => set('goalId', e.target.value)} style={selectStyle()}>
              <option value="">No goal linked</option>
              {activeGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
        )}

        {/* Start Date + Due Date */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label style={labelStyle()}>Start Date <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(available from)</span></label>
            <input
              type="date"
              value={form.startDate}
              max={form.dueDate || undefined}
              onChange={e => set('startDate', e.target.value)}
              style={dateStyle()}
            />
          </div>
          <div>
            <label style={labelStyle()}>Due Date</label>
            <input
              type="date"
              value={form.dueDate}
              min={form.startDate || undefined}
              onChange={e => set('dueDate', e.target.value)}
              style={dateStyle()}
            />
          </div>
        </div>

        {/* Est. Minutes + Recurrence */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <Input
            label="Est. Minutes"
            value={form.estimatedMinutes}
            onChange={v => set('estimatedMinutes', v)}
            placeholder="30, 60…"
            type="number"
          />
          <Select
            label="Repeat"
            value={form.recurrence}
            onChange={v => set('recurrence', v)}
            options={RECURRENCE_OPTIONS}
          />
        </div>

        {/* Tags */}
        <Input
          label="Tags (comma-separated)"
          value={form.tags}
          onChange={v => set('tags', v)}
          placeholder="e.g. email, client, urgent"
        />

        {/* Blocked By */}
        <div>
          <label style={labelStyle()}>Blocked By</label>
          {(form.blockedBy || []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
              {(form.blockedBy || []).map(id => {
                const bt = tasks.find(t => t.id === id);
                return bt ? (
                  <span key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', background: 'rgba(200,160,50,0.15)', color: tokens.amber, border: '1px solid rgba(200,160,50,0.3)', borderRadius: '5px', padding: '2px 8px', fontWeight: 600 }}>
                    ⊘ {bt.title.length > 32 ? bt.title.slice(0, 32) + '…' : bt.title}
                    <button
                      onClick={() => setForm(f => ({ ...f, blockedBy: f.blockedBy.filter(b => b !== id) }))}
                      style={{ background: 'none', border: 'none', color: tokens.amber, cursor: 'pointer', fontSize: '11px', lineHeight: 1, padding: '0 0 0 2px', fontFamily: fonts.body }}
                    >✕</button>
                  </span>
                ) : null;
              })}
            </div>
          )}
          <input
            value={blockerSearch}
            onChange={e => setBlockerSearch(e.target.value)}
            placeholder="Search for a task that blocks this one…"
            style={inputStyle()}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => { e.target.style.borderColor = tokens.border; }}
          />
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

        {/* Checklist */}
        <div>
          <label style={labelStyle()}>Checklist <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>({(form.checklist || []).filter(i => i.done).length}/{(form.checklist || []).length} done)</span></label>
          {(form.checklist || []).map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => setForm(f => ({ ...f, checklist: f.checklist.map(i => i.id === item.id ? { ...i, done: !i.done } : i) }))}
                style={{ width: 15, height: 15, flexShrink: 0, cursor: 'pointer', accentColor: tokens.accent }}
              />
              <input
                value={item.text}
                onChange={e => setForm(f => ({ ...f, checklist: f.checklist.map(i => i.id === item.id ? { ...i, text: e.target.value } : i) }))}
                style={{ ...inputStyle(), flex: 1, padding: '5px 10px', fontSize: '13px', textDecoration: item.done ? 'line-through' : 'none', color: item.done ? tokens.textMuted : tokens.textPrimary }}
                onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                onBlur={e => e.target.style.borderColor = tokens.border}
              />
              <button
                onClick={() => setForm(f => ({ ...f, checklist: f.checklist.filter(i => i.id !== item.id) }))}
                style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
              >✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            <input
              ref={newItemRef}
              value={newItemText}
              onChange={e => setNewItemText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newItemText.trim()) {
                  setForm(f => ({ ...f, checklist: [...(f.checklist || []), newChecklistItem(newItemText.trim())] }));
                  setNewItemText('');
                }
              }}
              placeholder="Add item… (press Enter)"
              style={{ ...inputStyle(), flex: 1, padding: '5px 10px', fontSize: '13px' }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
            />
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
        </div>

        {/* Notes */}
        <Input label="Notes" value={form.notes} onChange={v => set('notes', v)} placeholder="Any context…" multiline rows={3} />

        {/* Completion note (read-only, shown when editing a completed task) */}
        {task?.completionNote && (
          <div style={{ padding: '10px 12px', background: tokens.greenDim, border: `1px solid ${tokens.green}22`, borderRadius: '8px', fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700, color: tokens.green, fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>✓ Completion Note</span>
            {task.completionNote}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {extraActions}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>
              {task ? 'Save' : 'Add Task'}
            </Button>
          </div>
        </div>

      </div>
    </Modal>
  );
}
