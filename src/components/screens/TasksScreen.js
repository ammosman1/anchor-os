// src/components/screens/TasksScreen.js
import React, { useState, useMemo, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addTask, updateTask, deleteTask, addNote } from '../../lib/db';
import { RECURRENCE_OPTIONS, scheduleNextRecurrence, calculateUrgency, isTaskBlocked, isDeferred } from '../../lib/tasks';
import { getValidAccessToken, deleteEvent } from '../../lib/calendar';
import { Card, Button, Input, Select, SectionLabel, Tag, Modal, EmptyState, priorityColors } from '../ui';

const PRIORITIES = [
  { value: 'critical', label: '🔴 Critical' },
  { value: 'high',     label: '🟠 High'     },
  { value: 'medium',   label: '🟡 Medium'   },
  { value: 'low',      label: '⚪ Low'      },
];

const FOCUS_TYPES = [
  { value: 'deep',    label: '🧠 Deep Work'  },
  { value: 'shallow', label: '💬 Shallow'    },
  { value: 'admin',   label: '📋 Admin'      },
];

const FOCUS_TYPE_COLORS = {
  deep:    { bg: '#1a2340', text: '#5B8DEF' },
  shallow: { bg: '#1a2930', text: '#4EA8A8' },
  admin:   { bg: '#1f1a2e', text: '#9B59B6' },
};

const CONTEXT_OPTIONS = [
  { value: 'work',      label: 'Work'      },
  { value: 'personal',  label: 'Personal'  },
  { value: 'home',      label: 'Home'      },
  { value: 'financial', label: 'Financial' },
  { value: 'health',    label: 'Health'    },
];

const CONTEXT_COLORS = {
  work:      { bg: 'rgba(91,143,212,0.15)',  text: '#5B8FD4' },
  personal:  { bg: 'rgba(155,133,201,0.15)', text: '#9B85C9' },
  home:      { bg: 'rgba(109,191,158,0.15)', text: '#6DBF9E' },
  financial: { bg: 'rgba(200,169,110,0.15)', text: '#C8A96E' },
  health:    { bg: 'rgba(78,168,168,0.15)',  text: '#4EA8A8' },
};

const CATEGORY_TO_CONTEXT = {
  work:     'work',
  personal: 'personal',
  home:     'home',
  finance:  'financial',
  health:   'health',
  creative: 'personal',
  business: 'work',
};

const STATUS_FILTERS = ['all', 'inbox', 'brain-dump', 'critical', 'high', 'blocked', 'done'];

const emptyForm = { title: '', priority: 'high', projectId: '', goalId: '', context: 'personal', notes: '', estimatedMinutes: '', tags: '', recurrence: 'none', focusType: 'deep', dueDate: '', startDate: '', blockedBy: [] };

function timeAgo(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff  = Math.floor((Date.now() - date.getTime()) / (1000 * 60));
  if (diff < 1)    return 'just now';
  if (diff < 60)   return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

function parseTags(str) {
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

export default function TasksScreen() {
  const { user }                        = useAuth();
  const { tasks, projects, goals, calendarIntegration } = useData();
  const [filter,         setFilter]         = useState('all');
  const [filterTag,      setFilterTag]      = useState('');
  const [filterProject,  setFilterProject]  = useState('');
  const [filterContext,  setFilterContext]  = useState('');
  const [showModal,  setShowModal]      = useState(false);
  const [form,       setForm]           = useState(emptyForm);
  const [saving,     setSaving]         = useState(false);
  const [editing,    setEditing]        = useState(null);
  const [search,       setSearch]        = useState('');
  const [schedulingTask, setSchedulingTask] = useState(null);
  const [focusTask,    setFocusTask]     = useState(null); // { task, duration, startTime }
  const [timeLeft,     setTimeLeft]      = useState(null); // seconds
  const [completionNote, setCompletionNote] = useState({ open: false, task: null, text: '', saveToNotes: false });
  const [blockerSearch, setBlockerSearch] = useState('');

  // Focus timer countdown
  useEffect(() => {
    if (!focusTask) { setTimeLeft(null); return; }
    const iv = setInterval(() => {
      const elapsed = Math.floor((Date.now() - focusTask.startTime) / 1000);
      const remaining = focusTask.duration * 60 - elapsed;
      setTimeLeft(Math.max(0, remaining));
      if (remaining <= 0) clearInterval(iv);
    }, 1000);
    return () => clearInterval(iv);
  }, [focusTask]);

  const startFocus = (task) => {
    const duration = task.estimatedMinutes || 25;
    setFocusTask({ task, duration, startTime: Date.now() });
    setTimeLeft(duration * 60);
  };

  const stopFocus = () => { setFocusTask(null); setTimeLeft(null); };

  const fmt = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const projectOptions = [
    { value: '', label: 'Inbox (no project)' },
    ...projects.map(p => ({ value: p.id, label: p.title })),
  ];

  // All unique tags across tasks
  const allTags = useMemo(() =>
    [...new Set(tasks.flatMap(t => t.tags || []))].sort(),
    [tasks]
  );

  // Filter logic
  const filtered = tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterTag && !(t.tags || []).includes(filterTag)) return false;
    if (filterProject && t.projectId !== filterProject) return false;
    if (filterContext && t.context !== filterContext) return false;
    switch (filter) {
      case 'inbox':      return !t.done && (!t.projectId || t.project === 'Inbox');
      case 'brain-dump': return !t.done && t.source === 'brain-dump';
      case 'critical':   return !t.done && t.priority === 'critical';
      case 'high':       return !t.done && (t.priority === 'critical' || t.priority === 'high');
      case 'blocked':    return !t.done && isTaskBlocked(t, tasks);
      case 'done':       return t.done;
      default:           return !t.done;
    }
  }).sort((a, b) => {
    // Blocked tasks sink to bottom within their filter group
    const aBlocked = isTaskBlocked(a, tasks);
    const bBlocked = isTaskBlocked(b, tasks);
    if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
    return calculateUrgency(b) - calculateUrgency(a);
  });

  const doneCount    = tasks.filter(t => t.done).length;
  const pendingCount = tasks.filter(t => !t.done).length;
  const inboxCount   = tasks.filter(t => !t.done && (!t.projectId || t.project === 'Inbox')).length;
  const brainCount   = tasks.filter(t => !t.done && t.source === 'brain-dump').length;

  const handleSaveCompletionNote = async () => {
    const noteText = completionNote.text.trim();
    if (noteText) {
      const task = completionNote.task;
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const appended = task.notes
        ? `${task.notes}\n\n✓ Completed ${dateStr}: ${noteText}`
        : `✓ Completed ${dateStr}: ${noteText}`;
      await updateTask(user.uid, task.id, { completionNote: noteText, notes: appended });
      if (completionNote.saveToNotes) {
        await addNote(user.uid, {
          title: task.title,
          body:  `Completed ${dateStr}\n\n${noteText}`,
          tags:  ['task-completion'],
          pinned: false,
        });
      }
    }
    setCompletionNote({ open: false, task: null, text: '', saveToNotes: false });
  };

  const handleToggle = async (task) => {
    if (!task.done) {
      await updateTask(user.uid, task.id, {
        done: true,
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      await scheduleNextRecurrence(user.uid, task);
      setCompletionNote({ open: true, task, text: '' });
    } else {
      await updateTask(user.uid, task.id, { done: false, status: 'pending', completedAt: null });
    }
  };

  const handleDelete = async (task) => {
    if (task.calendarEventId && calendarIntegration?.connected) {
      try {
        const token = await getValidAccessToken(user.uid, calendarIntegration);
        if (token) await deleteEvent(token, task.calendarEventId);
      } catch (err) {
        console.error('Calendar delete error:', err);
      }
    }
    await deleteTask(user.uid, task.id);
  };

  const openNew = () => {
    setForm(emptyForm);
    setEditing(null);
    setBlockerSearch('');
    setShowModal(true);
  };

  const openEdit = (task) => {
    setForm({
      title:            task.title            || '',
      priority:         task.priority         || 'high',
      projectId:        task.projectId        || '',
      goalId:           task.goalId           || '',
      context:          task.context          || 'personal',
      notes:            task.notes            || '',
      estimatedMinutes: task.estimatedMinutes ? String(task.estimatedMinutes) : '',
      tags:             task.tags?.join(', ') || '',
      recurrence:       task.recurrence       || 'none',
      focusType:        task.focusType        || 'deep',
      dueDate:          task.dueDate          || '',
      startDate:        task.startDate        || '',
      blockedBy:        task.blockedBy        || [],
    });
    setEditing(task.id);
    setBlockerSearch('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);

    const linkedProject = projects.find(p => p.id === form.projectId);
    const derivedContext = linkedProject
      ? (CATEGORY_TO_CONTEXT[linkedProject.category] || form.context || 'personal')
      : (form.context || 'personal');
    const taskData = {
      title:            form.title.trim(),
      priority:         form.priority,
      projectId:        form.projectId || null,
      goalId:           form.goalId || null,
      project:          linkedProject ? linkedProject.title : 'Inbox',
      context:          derivedContext,
      notes:            form.notes,
      estimatedMinutes: parseInt(form.estimatedMinutes) || null,
      tags:             parseTags(form.tags),
      recurrence:       form.recurrence || 'none',
      focusType:        form.focusType || 'deep',
      dueDate:          form.dueDate    || null,
      startDate:        form.startDate  || null,
      blockedBy:        form.blockedBy || [],
    };

    if (editing) {
      const existingTask = tasks.find(t => t.id === editing);
      if (existingTask && form.dueDate && existingTask.dueDate && form.dueDate > existingTask.dueDate) {
        taskData.pushCount = (existingTask.pushCount || 0) + 1;
      }
      await updateTask(user.uid, editing, taskData);
    } else {
      await addTask(user.uid, { ...taskData, source: 'manual', status: 'pending' });
    }
    setSaving(false);
    setShowModal(false);
    setForm(emptyForm);
  };

  const sourceLabel = (task) => {
    if (task.source === 'brain-dump')    return { label: 'Brain Dump',    color: tokens.purple };
    if (task.source === 'quick-capture') return { label: 'Quick Capture', color: tokens.blue   };
    if (task.source === 'project')       return { label: 'Project',       color: tokens.green  };
    return null;
  };

  const projectName = (task) => {
    if (task.projectId) {
      const p = projects.find(p => p.id === task.projectId);
      return p ? p.title : task.project || 'Inbox';
    }
    return task.project || 'Inbox';
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* Header */}
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Task Inbox</div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>All Tasks</h1>
          <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>
            {pendingCount} pending · {inboxCount} in inbox · {doneCount} done
          </p>
        </div>
        <Button onClick={openNew}>+ New Task</Button>
      </div>

      {/* Stats */}
      <div className="fade-up stagger-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
        {[
          { label: 'Pending',    val: pendingCount, color: tokens.accent  },
          { label: 'Inbox',      val: inboxCount,   color: tokens.blue    },
          { label: 'Brain Dump', val: brainCount,   color: tokens.purple  },
          { label: 'Done',       val: doneCount,    color: tokens.green   },
        ].map(item => (
          <div key={item.label} style={{ padding: '12px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ fontFamily: fonts.display, fontSize: '24px', fontWeight: 700, color: item.color }}>{item.val}</div>
            <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '2px' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="fade-up stagger-1" style={{ marginBottom: '10px' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks..."
          style={{ width: '100%', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 14px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }}
          onFocus={e => e.target.style.borderColor = tokens.borderFocus}
          onBlur={e => e.target.style.borderColor = tokens.border}
        />
      </div>

      {/* Status Filters */}
      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {STATUS_FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: '99px', background: filter === f ? tokens.accentDim : 'transparent', color: filter === f ? tokens.accent : tokens.textMuted, border: `1px solid ${filter === f ? tokens.accentDim : tokens.border}`, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
            {f}{f === 'inbox' ? ` (${inboxCount})` : f === 'brain-dump' ? ` (${brainCount})` : ''}
          </button>
        ))}
      </div>

      {/* Context filters */}
      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {CONTEXT_OPTIONS.map(opt => {
          const cc = CONTEXT_COLORS[opt.value];
          const active = filterContext === opt.value;
          return (
            <button key={opt.value} onClick={() => setFilterContext(active ? '' : opt.value)}
              style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: '99px', background: active ? cc.bg : 'transparent', color: active ? cc.text : tokens.textMuted, border: `1px solid ${active ? cc.text + '40' : tokens.border}`, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Project + Tag filters */}
      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'center' }}>
        {projects.length > 0 && (
          <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
            style={{ fontSize: '11px', background: filterProject ? tokens.accentDim : tokens.bgCard, border: `1px solid ${filterProject ? tokens.accentDim : tokens.border}`, borderRadius: '99px', padding: '4px 10px', color: filterProject ? tokens.accent : tokens.textMuted, outline: 'none', cursor: 'pointer', fontFamily: fonts.body }}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        )}
        {allTags.map(tag => (
          <button key={tag} onClick={() => setFilterTag(filterTag === tag ? '' : tag)}
            style={{ fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '99px', background: filterTag === tag ? tokens.accentDim : tokens.bgCard, color: filterTag === tag ? tokens.accent : tokens.textMuted, border: `1px solid ${filterTag === tag ? tokens.accentDim : tokens.border}`, cursor: 'pointer', fontFamily: fonts.body }}>
            #{tag}
          </button>
        ))}
        {(filterTag || filterProject || filterContext) && (
          <button onClick={() => { setFilterTag(''); setFilterProject(''); setFilterContext(''); }}
            style={{ fontSize: '10px', color: tokens.textMuted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.body }}>
            Clear ✕
          </button>
        )}
      </div>

      {/* Focus Timer Banner */}
      {focusTask && (
        <div className="fade-up" style={{
          background: timeLeft === 0 ? tokens.green : tokens.accent,
          borderRadius: '12px', padding: '12px 16px', marginBottom: '16px',
          display: 'flex', alignItems: 'center', gap: '14px',
          boxShadow: `0 4px 16px rgba(154,120,48,0.3)`,
        }}>
          <span style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color: '#0C0E12', minWidth: '54px' }}>
            {timeLeft === 0 ? '✓' : fmt(timeLeft ?? focusTask.duration * 60)}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(12,14,18,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {timeLeft === 0 ? 'Session complete!' : 'Focusing on'}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#0C0E12' }}>{focusTask.task.title}</div>
          </div>
          {timeLeft === 0 ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => { handleToggle(focusTask.task); stopFocus(); }}
                style={{ background: '#0C0E12', color: tokens.accent, border: 'none', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body }}>
                Mark Done
              </button>
              <button onClick={stopFocus}
                style={{ background: 'rgba(0,0,0,0.12)', color: '#0C0E12', border: 'none', borderRadius: '8px', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', fontFamily: fonts.body }}>
                Dismiss
              </button>
            </div>
          ) : (
            <button onClick={stopFocus}
              style={{ background: 'rgba(0,0,0,0.15)', color: '#0C0E12', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', fontFamily: fonts.body }}>
              Stop
            </button>
          )}
        </div>
      )}

      {/* Task list */}
      <div className="fade-up stagger-2" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {filtered.length === 0 ? (
          <EmptyState icon="✓" title={filter === 'done' ? 'Nothing completed yet' : 'No tasks here'} subtitle={filter === 'all' ? 'Add a task or do a brain dump to get started.' : `No ${filter} tasks right now.`} action={filter !== 'done' && <Button onClick={openNew} size="sm">+ Add Task</Button>} />
        ) : (
          filtered.map(task => {
            const pc     = priorityColors[task.priority] || priorityColors.low;
            const source = sourceLabel(task);
            return (
              <div key={task.id}
                style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 14px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px', transition: 'all 0.15s', opacity: task.done ? 0.55 : 1 }}
                onMouseEnter={e => e.currentTarget.style.borderColor = tokens.borderHover}
                onMouseLeave={e => e.currentTarget.style.borderColor = tokens.border}
              >
                {/* Checkbox */}
                <div onClick={() => handleToggle(task)}
                  style={{ width: 20, height: 20, borderRadius: '5px', flexShrink: 0, marginTop: '1px', border: `1.5px solid ${task.done ? tokens.green : tokens.border}`, background: task.done ? tokens.greenDim : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '11px', color: tokens.green, transition: 'all 0.15s' }}>
                  {task.done ? '✓' : ''}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: tokens.textPrimary, textDecoration: task.done ? 'line-through' : 'none', marginBottom: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {task.title}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', color: tokens.textMuted }}>{projectName(task)}</span>
                    {task.context && CONTEXT_COLORS[task.context] && (
                      <span style={{ fontSize: '10px', fontWeight: 600, color: CONTEXT_COLORS[task.context].text, background: CONTEXT_COLORS[task.context].bg, padding: '1px 6px', borderRadius: '4px' }}>
                        {task.context}
                      </span>
                    )}
                    {isTaskBlocked(task, tasks) && (
                      <span style={{ fontSize: '10px', fontWeight: 700, color: tokens.amber, background: 'rgba(200,160,50,0.15)', padding: '1px 6px', borderRadius: '4px' }}>
                        ⊘ Blocked
                      </span>
                    )}
                    {source && <span style={{ fontSize: '10px', color: source.color, fontWeight: 600 }}>· {source.label}</span>}
                    <span style={{ fontSize: '10px', color: tokens.textMuted }}>· {timeAgo(task.createdAt)}</span>
                    {task.estimatedMinutes && (
                      <span style={{ fontSize: '10px', color: tokens.textMuted, background: tokens.track, padding: '1px 6px', borderRadius: '4px' }}>
                        {task.estimatedMinutes >= 60 ? `${Math.floor(task.estimatedMinutes/60)}h${task.estimatedMinutes%60 ? ` ${task.estimatedMinutes%60}m` : ''}` : `${task.estimatedMinutes}m`}
                      </span>
                    )}
                    {task.focusType && task.focusType !== 'deep' && (
                      <span style={{ fontSize: '10px', fontWeight: 600, color: FOCUS_TYPE_COLORS[task.focusType]?.text, background: FOCUS_TYPE_COLORS[task.focusType]?.bg, padding: '1px 6px', borderRadius: '4px' }}>
                        {task.focusType === 'shallow' ? 'shallow' : 'admin'}
                      </span>
                    )}
                    {task.dueDate && <span style={{ fontSize: '10px', color: tokens.textMuted }}>· due {task.dueDate}</span>}
                    {isDeferred(task) && <span style={{ fontSize: '10px', fontWeight: 600, color: tokens.blue, background: tokens.blueDim, padding: '1px 6px', borderRadius: '4px' }}>⏸ starts {task.startDate}</span>}
                    {(task.pushCount || 0) >= 1 && <span style={{ fontSize: '10px', fontWeight: 700, color: tokens.red, background: tokens.redDim, padding: '1px 6px', borderRadius: '4px' }}>↻{task.pushCount}</span>}
                    {task.status === 'scheduled' && <span style={{ fontSize: '10px', color: tokens.blue, fontWeight: 600 }}>· Scheduled</span>}
                    {task.recurrence && task.recurrence !== 'none' && <span style={{ fontSize: '10px', color: tokens.green, fontWeight: 600 }}>· ↻ {task.recurrence}</span>}
                  </div>
                  {/* Tags */}
                  {task.tags?.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                      {task.tags.map(tag => (
                        <span key={tag} onClick={() => setFilterTag(tag === filterTag ? '' : tag)}
                          style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, padding: '1px 7px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {task.notes && <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '4px' }}>{task.notes}</div>}

                  {/* Inline date scheduler */}
                  {schedulingTask === task.id && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${tokens.border}` }}>
                      <span style={{ fontSize: '11px', color: tokens.textMuted, whiteSpace: 'nowrap' }}>Schedule for:</span>
                      <input
                        type="date"
                        defaultValue={task.scheduledDate || ''}
                        min={new Date().toISOString().split('T')[0]}
                        autoFocus
                        onChange={async e => {
                          if (e.target.value) {
                            await updateTask(user.uid, task.id, { scheduledDate: e.target.value, status: 'scheduled' });
                          }
                          setSchedulingTask(null);
                        }}
                        style={{ background: tokens.bgInput, border: `1px solid ${tokens.borderFocus}`, borderRadius: '6px', padding: '4px 8px', color: tokens.textPrimary, fontSize: '12px', outline: 'none', fontFamily: fonts.body, colorScheme: tokens.colorScheme }}
                      />
                      <button onClick={() => setSchedulingTask(null)}
                        style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', fontFamily: fonts.body }}>
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {/* Right */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                  <Tag label={task.priority} color={pc.bg} textColor={pc.text} />
                  <div style={{ display: 'flex', gap: '2px' }}>
                    {task.done ? (
                      <button onClick={() => openEdit(task)} style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', padding: '2px 6px', fontFamily: fonts.body }}>View</button>
                    ) : (
                      <>
                        <button
                          onClick={() => startFocus(task)}
                          title={`Focus for ${task.estimatedMinutes || 25} min`}
                          style={{ background: focusTask?.task?.id === task.id ? tokens.accentDim : 'none', border: 'none', color: focusTask?.task?.id === task.id ? tokens.accent : tokens.textMuted, fontSize: '11px', cursor: 'pointer', padding: '2px 6px', fontFamily: fonts.body, borderRadius: '4px' }}>
                          ▶
                        </button>
                        <button
                          onClick={() => setSchedulingTask(s => s === task.id ? null : task.id)}
                          title="Schedule"
                          style={{ background: schedulingTask === task.id ? tokens.accentDim : 'none', border: 'none', color: schedulingTask === task.id ? tokens.accent : tokens.textMuted, fontSize: '11px', cursor: 'pointer', padding: '2px 6px', fontFamily: fonts.body, borderRadius: '4px' }}>
                          ◷
                        </button>
                        <button onClick={() => openEdit(task)} style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', padding: '2px 6px', fontFamily: fonts.body }}>Edit</button>
                      </>
                    )}
                    <button onClick={() => handleDelete(task)} style={{ background: 'none', border: 'none', color: tokens.red, fontSize: '11px', cursor: 'pointer', padding: '2px 6px', opacity: 0.6, fontFamily: fonts.body }}>✕</button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Completion Note Modal */}
      <Modal open={completionNote.open} onClose={() => setCompletionNote({ open: false, task: null, text: '', saveToNotes: false })} title="Task Done ✓">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>
            Optional: capture what you found, decided, or learned while doing this.
          </div>
          <textarea
            value={completionNote.text}
            onChange={e => setCompletionNote(n => ({ ...n, text: e.target.value }))}
            placeholder="e.g. Called vendor — price is $420, need approval from Mike..."
            autoFocus
            rows={4}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSaveCompletionNote(); }}
            style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: tokens.textSecondary }}>
            <input
              type="checkbox"
              checked={completionNote.saveToNotes}
              onChange={e => setCompletionNote(n => ({ ...n, saveToNotes: e.target.checked }))}
              style={{ accentColor: tokens.accent, width: 14, height: 14, cursor: 'pointer' }}
            />
            Also save to Notes for future reference
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => setCompletionNote({ open: false, task: null, text: '', saveToNotes: false })}>Skip</Button>
            <Button onClick={handleSaveCompletionNote}>Save Note</Button>
          </div>
        </div>
      </Modal>

      {/* Task Edit Modal */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setBlockerSearch(''); }} title={editing ? 'Edit Task' : 'New Task'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Task" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="What needs to get done?" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Select label="Priority" value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v }))} options={PRIORITIES} />
            <Select label="Project" value={form.projectId} onChange={v => {
              const proj = projects.find(p => p.id === v);
              const inherited = proj ? (CATEGORY_TO_CONTEXT[proj.category] || form.context) : form.context;
              setForm(f => ({ ...f, projectId: v, context: inherited }));
            }} options={projectOptions} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Context</label>
            <select value={form.context} onChange={e => setForm(f => ({ ...f, context: e.target.value }))}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
              {CONTEXT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          {(goals || []).filter(g => g.status === 'active').length > 0 && (
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Goal (optional)</label>
              <select value={form.goalId} onChange={e => setForm(f => ({ ...f, goalId: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                <option value="">No goal linked</option>
                {(goals || []).filter(g => g.status === 'active').map(g => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </div>
          )}
          <Input label="Tags (comma-separated)" value={form.tags} onChange={v => setForm(f => ({ ...f, tags: v }))} placeholder="e.g. email, client, urgent" />

          {/* Blocked By */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>
              Blocked By
            </label>
            {/* Current blockers as removable chips */}
            {(form.blockedBy || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
                {(form.blockedBy || []).map(id => {
                  const bt = tasks.find(t => t.id === id);
                  return bt ? (
                    <span key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', background: 'rgba(200,160,50,0.15)', color: tokens.amber, border: '1px solid rgba(200,160,50,0.3)', borderRadius: '5px', padding: '2px 8px', fontWeight: 600 }}>
                      ⊘ {bt.title.length > 32 ? bt.title.slice(0, 32) + '…' : bt.title}
                      <button onClick={() => setForm(f => ({ ...f, blockedBy: f.blockedBy.filter(b => b !== id) }))}
                        style={{ background: 'none', border: 'none', color: tokens.amber, cursor: 'pointer', fontSize: '11px', lineHeight: 1, padding: '0 0 0 2px', fontFamily: fonts.body }}>✕</button>
                    </span>
                  ) : null;
                })}
              </div>
            )}
            <input
              value={blockerSearch}
              onChange={e => setBlockerSearch(e.target.value)}
              placeholder="Search for a task that blocks this one…"
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
            />
            {blockerSearch.trim() && (
              <div style={{ marginTop: '4px', border: `1px solid ${tokens.border}`, borderRadius: '8px', overflow: 'hidden', background: tokens.bgCard }}>
                {tasks
                  .filter(t =>
                    !t.done &&
                    t.id !== editing &&
                    t.title.toLowerCase().includes(blockerSearch.toLowerCase()) &&
                    !(form.blockedBy || []).includes(t.id)
                  )
                  .slice(0, 5)
                  .map((t, i, arr) => (
                    <div key={t.id}
                      onMouseDown={() => {
                        setForm(f => ({ ...f, blockedBy: [...(f.blockedBy || []), t.id] }));
                        setBlockerSearch('');
                      }}
                      style={{ padding: '8px 12px', fontSize: '13px', color: tokens.textPrimary, cursor: 'pointer', borderBottom: i < arr.length - 1 ? `1px solid ${tokens.border}` : 'none', display: 'flex', alignItems: 'center', gap: '8px' }}
                      onMouseEnter={e => e.currentTarget.style.background = tokens.bgGlass}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontSize: '10px', color: tokens.textMuted, textTransform: 'capitalize' }}>{t.priority}</span>
                      {t.title}
                    </div>
                  ))
                }
                {tasks.filter(t => !t.done && t.id !== editing && t.title.toLowerCase().includes(blockerSearch.toLowerCase()) && !(form.blockedBy || []).includes(t.id)).length === 0 && (
                  <div style={{ padding: '8px 12px', fontSize: '12px', color: tokens.textMuted }}>No matching tasks</div>
                )}
              </div>
            )}
          </div>

          <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Any context..." multiline rows={4} />
          {editing?.completionNote && (
            <div style={{ padding: '10px 12px', background: `${tokens.greenDim}`, border: `1px solid ${tokens.green}22`, borderRadius: '8px', fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.6 }}>
              <span style={{ fontWeight: 700, color: tokens.green, fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>✓ Completion Note</span>
              {editing.completionNote}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Start Date <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(available from)</span></label>
              <input type="date" value={form.startDate} max={form.dueDate || undefined}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', colorScheme: 'dark' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Due Date</label>
              <input type="date" value={form.dueDate} min={form.startDate || undefined}
                onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', colorScheme: 'dark' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Input label="Est. Minutes" value={form.estimatedMinutes} onChange={v => setForm(f => ({ ...f, estimatedMinutes: v }))} placeholder="30, 60..." type="number" />
            <Select label="Focus Type" value={form.focusType} onChange={v => setForm(f => ({ ...f, focusType: v }))} options={FOCUS_TYPES} />
          </div>
          <Select label="Repeat" value={form.recurrence} onChange={v => setForm(f => ({ ...f, recurrence: v }))} options={RECURRENCE_OPTIONS} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button onClick={() => { setShowModal(false); setBlockerSearch(''); }} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>{editing ? 'Save' : 'Add Task'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
