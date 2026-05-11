// src/components/screens/ProjectsScreen.js
import React, { useState } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { getProjectAdvice } from '../../lib/ai';
import { addProject, updateProject, deleteProject, addTask } from '../../lib/db';
import { Card, Button, Input, Select, SectionLabel, MomentumBar, Tag, Modal, AICard, EmptyState, statusColors } from '../ui';

const CATEGORIES = [
  { value: 'work',      label: 'Work'      },
  { value: 'finance',   label: 'Finance'   },
  { value: 'health',    label: 'Health'    },
  { value: 'home',      label: 'Home'      },
  { value: 'creative',  label: 'Creative'  },
  { value: 'personal',  label: 'Personal'  },
  { value: 'business',  label: 'Business'  },
];

const STATUSES = [
  { value: 'active',   label: 'Active'   },
  { value: 'planning', label: 'Planning' },
  { value: 'stalled',  label: 'Stalled'  },
  { value: 'paused',   label: 'Paused'   },
  { value: 'complete', label: 'Complete' },
];

const emptyForm = {
  title: '', category: 'work', status: 'active',
  momentum: 50, nextAction: '', blockers: '', notes: '',
  sentiment: 'focused',
};

function momentumColor(m) {
  return m >= 65 ? tokens.green : m >= 35 ? tokens.accent : tokens.red;
}

function daysSince(ts) {
  if (!ts) return null;
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'today';
  if (diff === 1) return '1d ago';
  return `${diff}d ago`;
}

export default function ProjectsScreen() {
  const { user } = useAuth();
  const { projects, tasks } = useData();
  const [selected,    setSelected]    = useState(null);
  const [aiRec,       setAiRec]       = useState(null);
  const [aiLoading,   setAiLoading]   = useState(false);
  const [showModal,   setShowModal]   = useState(false);
  const [form,        setForm]        = useState(emptyForm);
  const [editing,     setEditing]     = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [newTask,     setNewTask]     = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const openProject = async (project) => {
    setSelected(project);
    setAiRec(null);
    setAiLoading(true);
    const rec = await getProjectAdvice({
      ...project,
      lastActive: daysSince(project.updatedAt),
    });
    setAiRec(rec);
    setAiLoading(false);
  };

  const openNew = () => {
    setForm(emptyForm);
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (project) => {
    setForm({
      title:      project.title      || '',
      category:   project.category   || 'work',
      status:     project.status     || 'active',
      momentum:   project.momentum   || 50,
      nextAction: project.nextAction || '',
      blockers:   project.blockers   || '',
      notes:      project.notes      || '',
      sentiment:  project.sentiment  || 'focused',
    });
    setEditing(project.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    if (editing) {
      await updateProject(user.uid, editing, form);
      if (selected?.id === editing) setSelected({ ...selected, ...form });
    } else {
      await addProject(user.uid, form);
    }
    setSaving(false);
    setShowModal(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this project?')) return;
    await deleteProject(user.uid, id);
    if (selected?.id === id) setSelected(null);
  };

  const handleAddTask = async () => {
    if (!newTask.trim() || !selected) return;
    await addTask(user.uid, {
      title: newTask.trim(),
      project: selected.title,
      projectId: selected.id,
      priority: 'medium',
      energy: 'medium',
    });
    setNewTask('');
  };

  const projectTasks = selected ? tasks.filter(t => t.projectId === selected.id) : [];

  const filtered = filterStatus === 'all'
    ? projects
    : projects.filter(p => p.status === filterStatus);

  const stalledProjects = projects.filter(p => {
    if (p.status !== 'active') return false;
    const last = p.updatedAt?.toDate?.() || new Date(0);
    return (Date.now() - last.getTime()) > 5 * 24 * 60 * 60 * 1000;
  });

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Project Operating System</div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Projects</h1>
          <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>
            {projects.filter(p => p.status === 'active').length} active · {stalledProjects.length} stalled · {projects.filter(p => p.status === 'complete').length} complete
          </p>
        </div>
        <Button onClick={openNew} size="md">+ New Project</Button>
      </div>

      {/* Stalled alert */}
      {stalledProjects.length > 0 && (
        <div className="fade-up stagger-1" style={{ background: tokens.redDim, border: `1px solid rgba(212,122,107,0.2)`, borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ color: tokens.red }}>⚑</span>
          <span style={{ fontSize: '13px', color: tokens.textSecondary }}>
            {stalledProjects.length} project{stalledProjects.length > 1 ? 's' : ''} haven't moved in 5+ days: {stalledProjects.map(p => p.title).join(', ')}
          </span>
        </div>
      )}

      {/* Filter */}
      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {['all', 'active', 'planning', 'stalled', 'paused', 'complete'].map(f => (
          <button
            key={f}
            onClick={() => setFilterStatus(f)}
            style={{
              fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '4px 12px', borderRadius: '99px',
              background: filterStatus === f ? tokens.accentDim : 'transparent',
              color: filterStatus === f ? tokens.accent : tokens.textMuted,
              border: `1px solid ${filterStatus === f ? 'rgba(200,169,110,0.2)' : tokens.border}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="fade-up stagger-2" style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '14px' }}>

        {/* Project list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.length === 0 ? (
            <EmptyState
              icon="◈"
              title="No projects yet"
              subtitle="Add your first project to start tracking momentum."
              action={<Button onClick={openNew}>+ New Project</Button>}
            />
          ) : (
            filtered.map(p => {
              const isSelected = selected?.id === p.id;
              const sc = statusColors[p.status] || statusColors.paused;
              return (
                <div
                  key={p.id}
                  onClick={() => openProject(p)}
                  style={{
                    background: isSelected ? 'rgba(200,169,110,0.06)' : tokens.bgCard,
                    border: `1px solid ${isSelected ? 'rgba(200,169,110,0.22)' : tokens.border}`,
                    borderRadius: '12px', padding: '16px 18px',
                    cursor: 'pointer', transition: 'all 0.18s ease',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = tokens.bgCardHover; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = tokens.bgCard; }}
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
                    <div style={{ fontSize: '11px', color: tokens.textMuted }}>{p.momentum || 0}% momentum</div>
                    {p.sentiment && <div style={{ fontSize: '11px', color: tokens.textMuted, fontStyle: 'italic' }}>{p.sentiment}</div>}
                  </div>

                  {p.nextAction && (
                    <div style={{ marginTop: '10px', fontSize: '12px', color: tokens.textSecondary, padding: '7px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', borderLeft: `2px solid ${tokens.accent}` }}>
                      → {p.nextAction}
                    </div>
                  )}
                  {p.blockers && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: tokens.red, display: 'flex', gap: '4px' }}>
                      <span>⚑</span> {p.blockers}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ position: 'sticky', top: '20px', alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>PROJECT DETAIL</div>
                  <h2 style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: tokens.textPrimary }}>{selected.title}</h2>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <Button onClick={() => openEdit(selected)} variant="ghost" size="sm">Edit</Button>
                  <Button onClick={() => handleDelete(selected.id)} variant="danger" size="sm">Delete</Button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                {[
                  { label: 'Status',    val: selected.status   },
                  { label: 'Category',  val: selected.category },
                  { label: 'Momentum',  val: `${selected.momentum || 0}%` },
                  { label: 'Sentiment', val: selected.sentiment || '—' },
                ].map(item => (
                  <div key={item.label} style={{ padding: '10px 12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                    <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '3px' }}>{item.label}</div>
                    <div style={{ fontSize: '13px', color: tokens.textPrimary, fontWeight: 500 }}>{item.val}</div>
                  </div>
                ))}
              </div>

              {selected.nextAction && (
                <div style={{ marginBottom: '10px', padding: '10px 12px', background: tokens.accentGlow, borderRadius: '8px', borderLeft: `2px solid ${tokens.accent}` }}>
                  <div style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, marginBottom: '3px' }}>NEXT ACTION</div>
                  <div style={{ fontSize: '13px', color: tokens.textPrimary }}>{selected.nextAction}</div>
                </div>
              )}

              {selected.blockers && (
                <div style={{ marginBottom: '10px', padding: '10px 12px', background: tokens.redDim, borderRadius: '8px', borderLeft: `2px solid ${tokens.red}` }}>
                  <div style={{ fontSize: '10px', color: tokens.red, fontWeight: 700, marginBottom: '3px' }}>BLOCKER</div>
                  <div style={{ fontSize: '13px', color: tokens.textPrimary }}>{selected.blockers}</div>
                </div>
              )}

              {selected.notes && (
                <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>{selected.notes}</div>
              )}
            </Card>

            {/* AI Rec */}
            <AICard text={aiRec || ''} loading={aiLoading} label="ANCHOR ANALYSIS" />

            {/* Tasks */}
            <Card>
              <SectionLabel>Project Tasks</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                {projectTasks.length === 0 ? (
                  <div style={{ fontSize: '12px', color: tokens.textMuted }}>No tasks linked yet.</div>
                ) : (
                  projectTasks.slice(0, 5).map(t => (
                    <div key={t.id} style={{ fontSize: '13px', color: t.done ? tokens.textMuted : tokens.textPrimary, textDecoration: t.done ? 'line-through' : 'none', display: 'flex', gap: '6px' }}>
                      <span style={{ color: t.done ? tokens.green : tokens.textMuted }}>{t.done ? '✓' : '·'}</span>
                      {t.title}
                    </div>
                  ))
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  value={newTask}
                  onChange={e => setNewTask(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                  placeholder="Add task..."
                  style={{ flex: 1, background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '7px 10px', color: tokens.textPrimary, fontSize: '12px', outline: 'none', fontFamily: fonts.body }}
                />
                <Button onClick={handleAddTask} size="sm" disabled={!newTask.trim()}>+</Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* New/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Project' : 'New Project'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input label="Project Title" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="e.g. Q3 Revenue Push" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Select label="Category" value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={CATEGORIES} />
            <Select label="Status" value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))} options={STATUSES} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, marginBottom: '8px' }}>
              Momentum: {form.momentum}%
            </div>
            <input type="range" min={0} max={100} value={form.momentum} onChange={e => setForm(f => ({ ...f, momentum: Number(e.target.value) }))} style={{ width: '100%', accentColor: tokens.accent }} />
          </div>
          <Input label="Next Action" value={form.nextAction} onChange={v => setForm(f => ({ ...f, nextAction: v }))} placeholder="What's the immediate next step?" />
          <Input label="Blockers" value={form.blockers} onChange={v => setForm(f => ({ ...f, blockers: v }))} placeholder="What's in the way?" />
          <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Context, links, thoughts..." multiline rows={3} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button onClick={() => setShowModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>
              {editing ? 'Save Changes' : 'Create Project'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
