// src/components/screens/ProjectsScreen.js
import React, { useState } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getProjectAdvice } from '../../lib/ai';
import { addProject, updateProject, deleteProject, addTask, updateTask } from '../../lib/db';
import { Card, Button, Input, Select, SectionLabel, MomentumBar, Tag, Modal, AICard, EmptyState, statusColors, priorityColors } from '../ui';

const CATEGORIES = [
  { value: 'work',     label: 'Work'     },
  { value: 'finance',  label: 'Finance'  },
  { value: 'health',   label: 'Health'   },
  { value: 'home',     label: 'Home'     },
  { value: 'creative', label: 'Creative' },
  { value: 'personal', label: 'Personal' },
  { value: 'business', label: 'Business' },
];

const STATUSES = [
  { value: 'active',   label: 'Active'   },
  { value: 'planning', label: 'Planning' },
  { value: 'stalled',  label: 'Stalled'  },
  { value: 'paused',   label: 'Paused'   },
  { value: 'complete', label: 'Complete' },
];

const PRIORITIES = [
  { value: 'critical', label: '🔴 Critical' },
  { value: 'high',     label: '🟠 High'     },
  { value: 'medium',   label: '🟡 Medium'   },
  { value: 'low',      label: '⚪ Low'      },
];

const emptyForm = { title: '', category: 'work', status: 'active', momentum: 50, nextAction: '', blockers: '', notes: '', sentiment: 'focused' };
const emptyTask = { title: '', priority: 'medium', dueDate: '', notes: '' };

function momentumColor(m) { return m >= 65 ? tokens.green : m >= 35 ? tokens.accent : tokens.red; }

function daysSince(ts) {
  if (!ts) return null;
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'today';
  if (diff === 1) return '1d ago';
  return `${diff}d ago`;
}

function formatDue(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.floor((d - today) / (1000*60*60*24));
  if (diff < 0)  return { label: `${Math.abs(diff)}d overdue`, color: tokens.red };
  if (diff === 0) return { label: 'Due today', color: tokens.amber };
  if (diff === 1) return { label: 'Due tomorrow', color: tokens.accent };
  return { label: `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, color: tokens.textMuted };
}

// ─── Project Detail View ──────────────────────────────────────────────────────
function ProjectDetail({ project, onBack, tasks, userId }) {
  const [aiRec,      setAiRec]      = useState(null);
  const [aiLoading,  setAiLoading]  = useState(false);
  const [newTask,    setNewTask]     = useState(emptyTask);
  const [addingTask, setAddingTask]  = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editing,    setEditing]    = useState(null); // editing task id
  const [editForm,   setEditForm]   = useState(emptyTask);

  const projectTasks = tasks.filter(t => t.projectId === project.id);
  const doneTasks    = projectTasks.filter(t => t.done);
  const pendingTasks = projectTasks.filter(t => !t.done);
  const sc = statusColors[project.status] || statusColors.paused;

  const fetchAI = async () => {
    setAiLoading(true);
    const rec = await getProjectAdvice({ ...project, lastActive: daysSince(project.updatedAt) });
    setAiRec(rec);
    setAiLoading(false);
  };

  React.useEffect(() => { fetchAI(); }, []); // eslint-disable-line

  const handleAddTask = async () => {
    if (!newTask.title.trim()) return;
    setAddingTask(true);
    await addTask(userId, {
      title:     newTask.title.trim(),
      priority:  newTask.priority,
      dueDate:   newTask.dueDate,
      notes:     newTask.notes,
      project:   project.title,
      projectId: project.id,
      source:    'project',
    });
    setNewTask(emptyTask);
    setShowTaskForm(false);
    setAddingTask(false);
  };

  const handleToggle = async (task) => {
    await updateTask(userId, task.id, { done: !task.done });
  };

  const handleEditTask = async () => {
    if (!editForm.title.trim() || !editing) return;
    await updateTask(userId, editing, { title: editForm.title, priority: editForm.priority, dueDate: editForm.dueDate, notes: editForm.notes });
    setEditing(null);
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* Back + header */}
      <div className="fade-up" style={{ marginBottom: '20px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '13px', cursor: 'pointer', padding: '0 0 12px', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: fonts.body }}>
          ← All Projects
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h1 style={{ fontFamily: fonts.display, fontSize: '24px', fontWeight: 700, color: tokens.textPrimary, margin: 0, letterSpacing: '-0.02em' }}>{project.title}</h1>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' }}>
              <Tag label={project.status} color={sc.bg} textColor={sc.text} />
              <span style={{ fontSize: '11px', color: tokens.textMuted }}>{project.category}</span>
              <span style={{ fontSize: '11px', color: tokens.textMuted }}>· Updated {daysSince(project.updatedAt) || 'just now'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Momentum */}
      <div className="fade-up stagger-1" style={{ marginBottom: '14px' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>Momentum</SectionLabel>
            <span style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color: momentumColor(project.momentum || 0) }}>{project.momentum || 0}%</span>
          </div>
          <MomentumBar value={project.momentum || 0} color={momentumColor(project.momentum || 0)} height={5} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px' }}>
            {project.nextAction && (
              <div style={{ padding: '10px 12px', background: tokens.accentGlow, borderRadius: '8px', borderLeft: `2px solid ${tokens.accent}` }}>
                <div style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, marginBottom: '3px' }}>NEXT ACTION</div>
                <div style={{ fontSize: '12px', color: tokens.textPrimary }}>{project.nextAction}</div>
              </div>
            )}
            {project.blockers && (
              <div style={{ padding: '10px 12px', background: tokens.redDim, borderRadius: '8px', borderLeft: `2px solid ${tokens.red}` }}>
                <div style={{ fontSize: '10px', color: tokens.red, fontWeight: 700, marginBottom: '3px' }}>BLOCKER</div>
                <div style={{ fontSize: '12px', color: tokens.textPrimary }}>{project.blockers}</div>
              </div>
            )}
          </div>
          {project.notes && <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6, marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${tokens.border}` }}>{project.notes}</div>}
        </Card>
      </div>

      {/* AI */}
      <div className="fade-up stagger-2" style={{ marginBottom: '14px' }}>
        <AICard text={aiRec || ''} loading={aiLoading} onRefresh={fetchAI} label="ANCHOR ANALYSIS" />
      </div>

      {/* Tasks */}
      <div className="fade-up stagger-3">
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>Tasks ({pendingTasks.length} pending · {doneTasks.length} done)</SectionLabel>
            <Button onClick={() => setShowTaskForm(!showTaskForm)} variant="accent" size="sm">+ Add Task</Button>
          </div>

          {/* Add task form */}
          {showTaskForm && (
            <div style={{ marginBottom: '14px', padding: '14px', background: tokens.bgGlass, borderRadius: '10px', border: `1px solid ${tokens.border}` }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Input value={newTask.title} onChange={v => setNewTask(t => ({ ...t, title: v }))} placeholder="Task title..." />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <Select value={newTask.priority} onChange={v => setNewTask(t => ({ ...t, priority: v }))} options={PRIORITIES} label="Priority" />
                  <Input label="Due Date" value={newTask.dueDate} onChange={v => setNewTask(t => ({ ...t, dueDate: v }))} type="date" />
                </div>
                <Input value={newTask.notes} onChange={v => setNewTask(t => ({ ...t, notes: v }))} placeholder="Notes (optional)" />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button onClick={handleAddTask} loading={addingTask} disabled={!newTask.title.trim()} size="sm">Add Task</Button>
                  <Button onClick={() => setShowTaskForm(false)} variant="ghost" size="sm">Cancel</Button>
                </div>
              </div>
            </div>
          )}

          {/* Pending tasks */}
          {pendingTasks.length === 0 && doneTasks.length === 0 ? (
            <div style={{ fontSize: '13px', color: tokens.textMuted, textAlign: 'center', padding: '20px 0' }}>No tasks yet. Add the first one above.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {pendingTasks.map(task => {
                const due = formatDue(task.dueDate);
                const pc  = priorityColors[task.priority] || priorityColors.low;
                const isEditing = editing === task.id;
                return (
                  <div key={task.id} style={{ padding: '10px 12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <Input value={editForm.title} onChange={v => setEditForm(f => ({ ...f, title: v }))} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <Select value={editForm.priority} onChange={v => setEditForm(f => ({ ...f, priority: v }))} options={PRIORITIES} label="Priority" />
                          <Input label="Due Date" value={editForm.dueDate} onChange={v => setEditForm(f => ({ ...f, dueDate: v }))} type="date" />
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <Button onClick={handleEditTask} size="sm">Save</Button>
                          <Button onClick={() => setEditing(null)} variant="ghost" size="sm">Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        {/* Checkbox */}
                        <div onClick={() => handleToggle(task)} style={{ width: 18, height: 18, borderRadius: '4px', flexShrink: 0, marginTop: '2px', border: `1.5px solid ${tokens.border}`, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '10px', color: tokens.green }}>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 500, color: tokens.textPrimary }}>{task.title}</div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
                            <Tag label={task.priority} color={pc.bg} textColor={pc.text} />
                            {due && <span style={{ fontSize: '10px', color: due.color, fontWeight: 600 }}>{due.label}</span>}
                            {task.notes && <span style={{ fontSize: '11px', color: tokens.textMuted }}>{task.notes}</span>}
                          </div>
                        </div>
                        <button onClick={() => { setEditing(task.id); setEditForm({ title: task.title, priority: task.priority || 'medium', dueDate: task.dueDate || '', notes: task.notes || '' }); }} style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', padding: '2px 6px', fontFamily: fonts.body }}>Edit</button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Done tasks */}
              {doneTasks.length > 0 && (
                <>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.08em', marginTop: '8px', marginBottom: '4px' }}>COMPLETED</div>
                  {doneTasks.map(task => (
                    <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'transparent', borderRadius: '8px', opacity: 0.5 }}>
                      <div onClick={() => handleToggle(task)} style={{ width: 18, height: 18, borderRadius: '4px', flexShrink: 0, border: `1.5px solid ${tokens.green}`, background: tokens.greenDim, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '10px', color: tokens.green }}>✓</div>
                      <div style={{ fontSize: '13px', color: tokens.textMuted, textDecoration: 'line-through' }}>{task.title}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Projects List View ───────────────────────────────────────────────────────
export default function ProjectsScreen() {
  const { user } = useAuth();
  const { projects, tasks } = useData();
  const [selected,     setSelected]     = useState(null);
  const [showModal,    setShowModal]    = useState(false);
  const [form,         setForm]         = useState(emptyForm);
  const [editing,      setEditing]      = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');

  // If a project is selected show detail view
  if (selected) {
    return (
      <ProjectDetail
        project={selected}
        tasks={tasks}
        userId={user.uid}
        onBack={() => setSelected(null)}
      />
    );
  }

  const openNew  = () => { setForm(emptyForm); setEditing(null); setShowModal(true); };
  const openEdit = (p, e) => {
    e.stopPropagation();
    setForm({ title: p.title || '', category: p.category || 'work', status: p.status || 'active', momentum: p.momentum || 50, nextAction: p.nextAction || '', blockers: p.blockers || '', notes: p.notes || '', sentiment: p.sentiment || 'focused' });
    setEditing(p.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    if (editing) { await updateProject(user.uid, editing, form); }
    else          { await addProject(user.uid, form); }
    setSaving(false);
    setShowModal(false);
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this project?')) return;
    await deleteProject(user.uid, id);
  };

  const stalledProjects = projects.filter(p => {
    if (p.status !== 'active') return false;
    const last = p.updatedAt?.toDate?.() || new Date(0);
    return (Date.now() - last.getTime()) > 5 * 24 * 60 * 60 * 1000;
  });

  const filtered = filterStatus === 'all' ? projects : projects.filter(p => p.status === filterStatus);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Project Operating System</div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Projects</h1>
          <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>
            {projects.filter(p => p.status === 'active').length} active · {stalledProjects.length} stalled · {projects.filter(p => p.status === 'complete').length} complete
          </p>
        </div>
        <Button onClick={openNew}>+ New Project</Button>
      </div>

      {stalledProjects.length > 0 && (
        <div className="fade-up stagger-1" style={{ background: tokens.redDim, border: `1px solid rgba(212,122,107,0.2)`, borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ color: tokens.red }}>⚑</span>
          <span style={{ fontSize: '13px', color: tokens.textSecondary }}>{stalledProjects.length} project{stalledProjects.length > 1 ? 's' : ''} stalled 5+ days: {stalledProjects.map(p => p.title).join(', ')}</span>
        </div>
      )}

      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {['all', 'active', 'planning', 'stalled', 'paused', 'complete'].map(f => (
          <button key={f} onClick={() => setFilterStatus(f)}
            style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: '99px', background: filterStatus === f ? tokens.accentDim : 'transparent', color: filterStatus === f ? tokens.accent : tokens.textMuted, border: `1px solid ${filterStatus === f ? 'rgba(200,169,110,0.2)' : tokens.border}`, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
            {f}
          </button>
        ))}
      </div>

      <div className="fade-up stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
        {filtered.length === 0 ? (
          <EmptyState icon="◈" title="No projects yet" subtitle="Add your first project to start tracking." action={<Button onClick={openNew}>+ New Project</Button>} />
        ) : (
          filtered.map(p => {
            const sc           = statusColors[p.status] || statusColors.paused;
            const projectTasks = tasks.filter(t => t.projectId === p.id);
            const doneCount    = projectTasks.filter(t => t.done).length;
            const totalCount   = projectTasks.length;
            return (
              <div key={p.id} onClick={() => setSelected(p)}
                style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', padding: '16px 18px', cursor: 'pointer', transition: 'all 0.18s ease' }}
                onMouseEnter={e => { e.currentTarget.style.background = tokens.bgCardHover; e.currentTarget.style.borderColor = tokens.borderHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = tokens.bgCard; e.currentTarget.style.borderColor = tokens.border; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ flex: 1, paddingRight: '10px' }}>
                    <div style={{ fontWeight: 600, color: tokens.textPrimary, fontSize: '14px', marginBottom: '3px' }}>{p.title}</div>
                    <div style={{ fontSize: '11px', color: tokens.textMuted }}>{p.category} · {daysSince(p.updatedAt) || 'new'}</div>
                  </div>
                  <Tag label={p.status} color={sc.bg} textColor={sc.text} />
                </div>

                <MomentumBar value={p.momentum || 0} color={momentumColor(p.momentum || 0)} />

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                  <span style={{ fontSize: '11px', color: tokens.textMuted }}>{p.momentum || 0}% momentum</span>
                  {totalCount > 0 && <span style={{ fontSize: '11px', color: tokens.textMuted }}>{doneCount}/{totalCount} tasks</span>}
                </div>

                {p.nextAction && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: tokens.textSecondary, padding: '7px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', borderLeft: `2px solid ${tokens.accent}` }}>
                    → {p.nextAction}
                  </div>
                )}
                {p.blockers && <div style={{ marginTop: '6px', fontSize: '11px', color: tokens.red }}>⚑ {p.blockers}</div>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '10px' }}>
                  <button onClick={(e) => openEdit(p, e)} style={{ background: 'none', border: `1px solid ${tokens.border}`, color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', padding: '3px 10px', borderRadius: '6px', fontFamily: fonts.body }}>Edit</button>
                  <button onClick={(e) => handleDelete(p.id, e)} style={{ background: 'none', border: `1px solid rgba(212,122,107,0.2)`, color: tokens.red, fontSize: '11px', cursor: 'pointer', padding: '3px 10px', borderRadius: '6px', fontFamily: fonts.body }}>Delete</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Project' : 'New Project'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Project Title" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="e.g. Half Bath Remodel" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Select label="Category" value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={CATEGORIES} />
            <Select label="Status"   value={form.status}   onChange={v => setForm(f => ({ ...f, status: v }))}   options={STATUSES} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, marginBottom: '8px' }}>Momentum: {form.momentum}%</div>
            <input type="range" min={0} max={100} value={form.momentum} onChange={e => setForm(f => ({ ...f, momentum: Number(e.target.value) }))} style={{ width: '100%', accentColor: tokens.accent }} />
          </div>
          <Input label="Next Action" value={form.nextAction} onChange={v => setForm(f => ({ ...f, nextAction: v }))} placeholder="What's the immediate next step?" />
          <Input label="Blockers"    value={form.blockers}   onChange={v => setForm(f => ({ ...f, blockers: v }))}   placeholder="What's in the way?" />
          <Input label="Notes"       value={form.notes}      onChange={v => setForm(f => ({ ...f, notes: v }))}      placeholder="Context, links, thoughts..." multiline rows={3} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button onClick={() => setShowModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>{editing ? 'Save Changes' : 'Create Project'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}