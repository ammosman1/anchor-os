// src/components/screens/TasksScreen.js
import React, { useState } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addTask, updateTask, deleteTask } from '../../lib/db';
import { Card, Button, Input, Select, SectionLabel, Tag, Modal, EmptyState, priorityColors } from '../ui';

const PRIORITIES = [
  { value: 'critical', label: '🔴 Critical' },
  { value: 'high',     label: '🟠 High'     },
  { value: 'medium',   label: '🟡 Medium'   },
  { value: 'low',      label: '⚪ Low'      },
];

const FILTERS = ['all', 'inbox', 'brain-dump', 'critical', 'high', 'done'];

const emptyForm = { title: '', priority: 'high', projectId: '', notes: '' };

function timeAgo(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff  = Math.floor((Date.now() - date.getTime()) / (1000 * 60));
  if (diff < 1)    return 'just now';
  if (diff < 60)   return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

export default function TasksScreen() {
  const { user }                        = useAuth();
  const { tasks, projects }             = useData();
  const [filter,    setFilter]          = useState('all');
  const [showModal, setShowModal]       = useState(false);
  const [form,      setForm]            = useState(emptyForm);
  const [saving,    setSaving]          = useState(false);
  const [editing,   setEditing]         = useState(null);
  const [search,    setSearch]          = useState('');

  // Build project options — include id so we can link properly
  const projectOptions = [
    { value: '',    label: 'Inbox (no project)' },
    ...projects.map(p => ({ value: p.id, label: p.title })),
  ];

  // Filter logic
  const filtered = tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    switch (filter) {
      case 'inbox':      return !t.done && (!t.projectId || t.project === 'Inbox');
      case 'brain-dump': return !t.done && t.source === 'brain-dump';
      case 'critical':   return !t.done && t.priority === 'critical';
      case 'high':       return !t.done && (t.priority === 'critical' || t.priority === 'high');
      case 'done':       return t.done;
      default:           return !t.done;
    }
  }).sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
  });

  const doneCount    = tasks.filter(t => t.done).length;
  const pendingCount = tasks.filter(t => !t.done).length;
  const inboxCount   = tasks.filter(t => !t.done && (!t.projectId || t.project === 'Inbox')).length;
  const brainCount   = tasks.filter(t => !t.done && t.source === 'brain-dump').length;

  const handleToggle = async (task) => {
    await updateTask(user.uid, task.id, { done: !task.done });
  };

  const handleDelete = async (taskId) => {
    await deleteTask(user.uid, taskId);
  };

  const openNew = () => {
    setForm(emptyForm);
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (task) => {
    setForm({
      title:     task.title     || '',
      priority:  task.priority  || 'high',
      projectId: task.projectId || '',
      notes:     task.notes     || '',
    });
    setEditing(task.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);

    // Resolve project name from projectId
    const linkedProject = projects.find(p => p.id === form.projectId);
    const taskData = {
      title:     form.title.trim(),
      priority:  form.priority,
      projectId: form.projectId || null,
      project:   linkedProject ? linkedProject.title : 'Inbox',
      notes:     form.notes,
    };

    if (editing) {
      await updateTask(user.uid, editing, taskData);
    } else {
      await addTask(user.uid, { ...taskData, source: 'manual' });
    }
    setSaving(false);
    setShowModal(false);
    setForm(emptyForm);
  };

  const sourceLabel = (task) => {
    if (task.source === 'brain-dump')    return { label: 'Brain Dump',     color: tokens.purple };
    if (task.source === 'quick-capture') return { label: 'Quick Capture',  color: tokens.blue   };
    if (task.source === 'project')       return { label: 'Project',        color: tokens.green  };
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

      {/* Filters */}
      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: '99px', background: filter === f ? tokens.accentDim : 'transparent', color: filter === f ? tokens.accent : tokens.textMuted, border: `1px solid ${filter === f ? 'rgba(200,169,110,0.2)' : tokens.border}`, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
            {f}{f === 'inbox' ? ` (${inboxCount})` : f === 'brain-dump' ? ` (${brainCount})` : ''}
          </button>
        ))}
      </div>

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
                    {source && <span style={{ fontSize: '10px', color: source.color, fontWeight: 600 }}>· {source.label}</span>}
                    <span style={{ fontSize: '10px', color: tokens.textMuted }}>· {timeAgo(task.createdAt)}</span>
                  </div>
                  {task.notes && <div style={{ fontSize: '12px', color: tokens.textMuted, marginTop: '4px' }}>{task.notes}</div>}
                </div>

                {/* Right */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                  <Tag label={task.priority} color={pc.bg} textColor={pc.text} />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {!task.done && <button onClick={() => openEdit(task)} style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', padding: '2px 6px', fontFamily: fonts.body }}>Edit</button>}
                    <button onClick={() => handleDelete(task.id)} style={{ background: 'none', border: 'none', color: tokens.red, fontSize: '11px', cursor: 'pointer', padding: '2px 6px', opacity: 0.6, fontFamily: fonts.body }}>✕</button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Task' : 'New Task'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Task" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="What needs to get done?" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Select label="Priority" value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v }))} options={PRIORITIES} />
            <Select label="Project" value={form.projectId} onChange={v => setForm(f => ({ ...f, projectId: v }))} options={projectOptions} />
          </div>
          <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Any context..." multiline rows={2} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button onClick={() => setShowModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>{editing ? 'Save' : 'Add Task'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
