// src/components/screens/ProjectsScreen.js
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addProject, updateProject, deleteProject } from '../../lib/db';
import { calculateMomentum } from '../../lib/momentum';
import { Button, Input, Select, MomentumBar, Tag, Modal, EmptyState, statusColors } from '../ui';

// ─── Projects List View ───────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'work',     label: 'Work'     },
  { value: 'finance',  label: 'Finance'  },
  { value: 'health',   label: 'Health'   },
  { value: 'home',     label: 'Home'     },
  { value: 'creative', label: 'Creative' },
  { value: 'personal', label: 'Personal' },
  { value: 'business', label: 'Business' },
];

const CONTEXT_OPTIONS = [
  { value: '',               label: 'No context'         },
  { value: 'wells-fargo',    label: 'Wells Fargo'        },
  { value: 'personal',       label: 'Personal'           },
  { value: 'side-business',  label: 'Side Business'      },
  { value: 'home-family',    label: 'Home/Family'        },
  { value: 'financial',      label: 'Financial Recovery' },
];

const STATUSES = [
  { value: 'active',   label: 'Active'   },
  { value: 'planning', label: 'Planning' },
  { value: 'stalled',  label: 'Stalled'  },
  { value: 'paused',   label: 'Paused'   },
  { value: 'complete', label: 'Complete' },
];

const emptyForm = { title: '', category: 'work', status: 'active', momentum: 50, nextAction: '', blockers: '', notes: '', sentiment: 'focused', goalId: '', context: '' };

function momentumColor(m) { return m >= 65 ? tokens.green : m >= 35 ? tokens.accent : tokens.red; }

function daysSince(ts) {
  if (!ts) return null;
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'today';
  if (diff === 1) return '1d ago';
  return `${diff}d ago`;
}

// ─── Projects List View ───────────────────────────────────────────────────────
export default function ProjectsScreen() {
  const { user } = useAuth();
  const { projects, tasks, goals } = useData();
  const navigate = useNavigate();
  const [showModal,     setShowModal]     = useState(false);
  const [form,          setForm]          = useState(emptyForm);
  const [editing,       setEditing]       = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [filterStatus,  setFilterStatus]  = useState('all');
  const [filterContext, setFilterContext] = useState('');

  const openNew  = () => { setForm(emptyForm); setEditing(null); setShowModal(true); };
  const openEdit = (p, e) => {
    e.stopPropagation();
    setForm({ title: p.title || '', category: p.category || 'work', status: p.status || 'active', momentum: p.momentum || 50, nextAction: p.nextAction || '', blockers: p.blockers || '', notes: p.notes || '', sentiment: p.sentiment || 'focused', goalId: p.goalId || '', context: p.context || '' });
    setEditing(p.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const clean = {
        title:      form.title.trim(),
        category:   form.category || 'work',
        status:     form.status   || 'active',
        nextAction: form.nextAction || '',
        blockers:   form.blockers   || '',
        notes:      form.notes      || '',
        sentiment:  form.sentiment  || 'focused',
        goalId:     form.goalId     || null,
        context:    form.context    || null,
      };
      if (editing) {
        const existingProject = projects.find(p => p.id === editing);
        if (existingProject?.status === 'stalled' && clean.status === 'active') {
          clean.deferCount = (existingProject.deferCount || 0) + 1;
        }
        await updateProject(user.uid, editing, clean);
      } else {
        await addProject(user.uid, clean);
      }
      setShowModal(false);
    } catch (err) {
      console.error('Save project error:', err);
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this project?')) return;
    await deleteProject(user.uid, id);
  };

  const stalledProjects = useMemo(() => projects.filter(p => {
    if (p.status === 'complete' || p.status === 'paused') return false;
    const projectTasks = tasks.filter(t => t.projectId === p.id);
    const { score: mScore } = calculateMomentum(p, projectTasks);
    if (mScore > 50) return false;
    let lastMs = p.updatedAt?.toMillis?.() ?? (p.updatedAt ? new Date(p.updatedAt).getTime() : 0);
    for (const t of projectTasks) {
      const tMs = Math.max(
        t.completedAt  ? new Date(t.completedAt).getTime()                           : 0,
        t.updatedAt?.toMillis?.() ?? (t.updatedAt ? new Date(t.updatedAt).getTime() : 0),
      );
      if (tMs > lastMs) lastMs = tMs;
    }
    return lastMs > 0 && (Date.now() - lastMs) > 5 * 24 * 60 * 60 * 1000;
  }), [projects, tasks]);

  const filtered = projects
    .filter(p => filterStatus === 'all' || p.status === filterStatus)
    .filter(p => !filterContext || p.context === filterContext);

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

      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {['all', 'active', 'planning', 'stalled', 'paused', 'complete'].map(f => (
          <button key={f} onClick={() => setFilterStatus(f)}
            style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: '99px', background: filterStatus === f ? tokens.accentDim : 'transparent', color: filterStatus === f ? tokens.accent : tokens.textMuted, border: `1px solid ${filterStatus === f ? 'rgba(200,169,110,0.2)' : tokens.border}`, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
            {f}
          </button>
        ))}
      </div>

      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {CONTEXT_OPTIONS.map(opt => (
          <button key={opt.value} onClick={() => setFilterContext(filterContext === opt.value ? '' : opt.value)}
            style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: '99px', background: filterContext === opt.value ? 'rgba(91,143,212,0.15)' : 'transparent', color: filterContext === opt.value ? '#5B8FD4' : tokens.textMuted, border: `1px solid ${filterContext === opt.value ? 'rgba(91,143,212,0.3)' : tokens.border}`, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
            {opt.value === '' ? 'All Contexts' : opt.label}
          </button>
        ))}
      </div>

      <div className="fade-up stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
        {filtered.length === 0 ? (
          <EmptyState icon="◈" title="No projects yet" subtitle="Add your first project to start tracking." action={<Button onClick={openNew}>+ New Project</Button>} />
        ) : (
          filtered.map(p => {
            const projectTasks    = tasks.filter(t => t.projectId === p.id);
            const doneCount       = projectTasks.filter(t => t.done).length;
            const totalCount      = projectTasks.length;
            const linkedGoal      = p.goalId ? goals.find(g => g.id === p.goalId) : null;
            const { score: mScore } = calculateMomentum(p, projectTasks);
            const displayStatus   = (p.status === 'stalled' && mScore > 50) ? 'active' : p.status;
            const sc              = statusColors[displayStatus] || statusColors.paused;
            return (
              <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', padding: '16px 18px', cursor: 'pointer', transition: 'all 0.18s ease' }}
                onMouseEnter={e => { e.currentTarget.style.background = tokens.bgCardHover; e.currentTarget.style.borderColor = tokens.borderHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = tokens.bgCard; e.currentTarget.style.borderColor = tokens.border; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ flex: 1, paddingRight: '10px' }}>
                    <div style={{ fontWeight: 600, color: tokens.textPrimary, fontSize: '14px', marginBottom: '3px' }}>{p.title}</div>
                    <div style={{ fontSize: '11px', color: tokens.textMuted }}>{p.category} · {daysSince(p.updatedAt) || 'new'}</div>
                  </div>
                  <Tag label={displayStatus} color={sc.bg} textColor={sc.text} />
                </div>
                {(linkedGoal || p.context) && (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                    {linkedGoal && <span style={{ fontSize: '10px', color: '#5B8FD4', fontWeight: 600 }}>↗ {linkedGoal.title}</span>}
                    {p.context && <span style={{ fontSize: '10px', color: '#5B8FD4', background: 'rgba(91,143,212,0.12)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>{CONTEXT_OPTIONS.find(c => c.value === p.context)?.label || p.context}</span>}
                  </div>
                )}

                <MomentumBar value={mScore} color={momentumColor(mScore)} />

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                  <span style={{ fontSize: '11px', color: tokens.textMuted }}>{mScore}% momentum</span>
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
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Linked Goal</label>
            <select value={form.goalId} onChange={e => setForm(f => ({ ...f, goalId: e.target.value }))}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
              <option value="">No linked goal</option>
              {(goals || []).filter(g => g.status === 'active').map(g => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Context</label>
            <select value={form.context} onChange={e => setForm(f => ({ ...f, context: e.target.value }))}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
              {CONTEXT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
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