// src/components/screens/TasksScreen.js
import React, { useState, useMemo } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addTask, updateTask, deleteTask } from '../../lib/db';
import { getValidAccessToken, deleteEvent } from '../../lib/calendar';
import { Card, Button, Input, Select, SectionLabel, Tag, Modal, EmptyState, priorityColors } from '../ui';

const PRIORITIES = [
  { value: 'critical', label: '🔴 Critical' },
  { value: 'high',     label: '🟠 High'     },
  { value: 'medium',   label: '🟡 Medium'   },
  { value: 'low',      label: '⚪ Low'      },
];

const STATUS_FILTERS = ['all', 'inbox', 'brain-dump', 'critical', 'high', 'done'];

const emptyForm = { title: '', priority: 'high', projectId: '', notes: '', estimatedMinutes: '', tags: '' };

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
  const { tasks, projects, calendarIntegration } = useData();
  const [filter,     setFilter]         = useState('all');
  const [filterTag,  setFilterTag]      = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [showModal,  setShowModal]      = useState(false);
  const [form,       setForm]           = useState(emptyForm);
  const [saving,     setSaving]         = useState(false);
  const [editing,    setEditing]        = useState(null);
  const [search,     setSearch]         = useState('');

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
    if (!task.done) {
      await updateTask(user.uid, task.id, {
        done: true,
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
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
    setShowModal(true);
  };

  const openEdit = (task) => {
    setForm({
      title:            task.title            || '',
      priority:         task.priority         || 'high',
      projectId:        task.projectId        || '',
      notes:            task.notes            || '',
      estimatedMinutes: task.estimatedMinutes ? String(task.estimatedMinutes) : '',
      tags:             task.tags?.join(', ') || '',
    });
    setEditing(task.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);

    const linkedProject = projects.find(p => p.id === form.projectId);
    const taskData = {
      title:            form.title.trim(),
      priority:         form.priority,
      projectId:        form.projectId || null,
      project:          linkedProject ? linkedProject.title : 'Inbox',
      notes:            form.notes,
      estimatedMinutes: parseInt(form.estimatedMinutes) || null,
      tags:             parseTags(form.tags),
    };

    if (editing) {
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
        {(filterTag || filterProject) && (
          <button onClick={() => { setFilterTag(''); setFilterProject(''); }}
            style={{ fontSize: '10px', color: tokens.textMuted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: fonts.body }}>
            Clear ✕
          </button>
        )}
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
                    {task.estimatedMinutes && (
                      <span style={{ fontSize: '10px', color: tokens.textMuted, background: tokens.track, padding: '1px 6px', borderRadius: '4px' }}>
                        {task.estimatedMinutes >= 60 ? `${Math.floor(task.estimatedMinutes/60)}h${task.estimatedMinutes%60 ? ` ${task.estimatedMinutes%60}m` : ''}` : `${task.estimatedMinutes}m`}
                      </span>
                    )}
                    {task.status === 'scheduled' && <span style={{ fontSize: '10px', color: tokens.blue, fontWeight: 600 }}>· Scheduled</span>}
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
                </div>

                {/* Right */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                  <Tag label={task.priority} color={pc.bg} textColor={pc.text} />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {!task.done && <button onClick={() => openEdit(task)} style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', padding: '2px 6px', fontFamily: fonts.body }}>Edit</button>}
                    <button onClick={() => handleDelete(task)} style={{ background: 'none', border: 'none', color: tokens.red, fontSize: '11px', cursor: 'pointer', padding: '2px 6px', opacity: 0.6, fontFamily: fonts.body }}>✕</button>
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
          <Input label="Tags (comma-separated)" value={form.tags} onChange={v => setForm(f => ({ ...f, tags: v }))} placeholder="e.g. email, client, urgent" />
          <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Any context..." multiline rows={2} />
          <Input label="Estimated Time (minutes)" value={form.estimatedMinutes} onChange={v => setForm(f => ({ ...f, estimatedMinutes: v }))} placeholder="e.g. 30, 60, 90" type="number" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button onClick={() => setShowModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>{editing ? 'Save' : 'Add Task'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
