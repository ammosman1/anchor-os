// src/components/screens/ProjectDetailScreen.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addTask, updateTask, updateProject, saveProfile, getAICache, saveAICache } from '../../lib/db';
import { generateProjectAnalysis, callAI } from '../../lib/ai';
import { buildHolisticContext } from '../../lib/aiContext';
import { calculateMomentum, getMomentumBlurb } from '../../lib/momentum';
import { getProjectNextAction, isTaskBlocked } from '../../lib/tasks';
import { Button, Modal, Input, MomentumBar, Spinner } from '../ui';
import TaskModal from '../TaskModal';
import { usePageContext } from '../../context/PageContext';

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

function momentumColor(m) {
  return m >= 65 ? tokens.green : m >= 35 ? tokens.accent : tokens.red;
}

function daysSince(ts) {
  if (!ts) return null;
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff  = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'today';
  if (diff === 1) return '1d ago';
  return `${diff}d ago`;
}

function formatDue(dateStr) {
  if (!dateStr) return null;
  const d     = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff  = Math.floor((d - today) / (1000 * 60 * 60 * 24));
  if (diff < 0)   return { label: `${Math.abs(diff)}d overdue`, color: tokens.red };
  if (diff === 0) return { label: 'Due today',    color: tokens.amber };
  if (diff === 1) return { label: 'Due tomorrow', color: tokens.accent };
  return { label: `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, color: tokens.textMuted };
}

function SectionLabel({ children, style }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.textMuted, marginBottom: '14px', ...style }}>
      {children}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg, padding: '20px', marginBottom: '12px', ...style }}>
      {children}
    </div>
  );
}

export default function ProjectDetailScreen() {
  const { projectId } = useParams();
  const navigate      = useNavigate();
  const { user, profile, updateProfile } = useAuth();
  const { projects, tasks, goals, brainDumps, brainDumpDigests, notes, weeklyReviews, userProfile, manualCashFlow, debtAccounts, assetAccounts, savingsAnalysis, savingsHistory, habits, habitLogs, dailyReviews, actedOnRecommendations } = useData();
  const { setPageContext } = usePageContext();

  const project      = projects.find(p => p.id === projectId);

  useEffect(() => {
    if (!project) return;
    setPageContext({ type: 'project', id: projectId, title: project.title, data: project });
    return () => setPageContext(null);
  }, [projectId, project?.title]); // eslint-disable-line react-hooks/exhaustive-deps -- setPageContext is stable
  const linkedGoal   = project?.goalId ? goals.find(g => g.id === project.goalId) : null;
  const projectTasks = tasks.filter(t => t.projectId === projectId);
  const doneTasks    = projectTasks.filter(t => t.done);
  const activeTasks  = projectTasks.filter(t => !t.done);

  // Respect saved drag order if present
  const orderedActiveTasks = useMemo(() => {
    if (!project?.taskOrder?.length) return activeTasks;
    const orderMap = new Map(project.taskOrder.map((id, i) => [id, i]));
    return [...activeTasks].sort((a, b) => {
      const ai = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
      const bi = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
      return ai - bi;
    });
  }, [activeTasks, project?.taskOrder]);

  const handleDragStart = (e, taskId) => {
    setDraggedId(taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, taskId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (taskId !== draggedId) setDragOverId(taskId);
  };

  const handleDrop = async (e, targetId) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return; }
    const ids = orderedActiveTasks.map(t => t.id);
    const from = ids.indexOf(draggedId);
    const to   = ids.indexOf(targetId);
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, draggedId);
    setDraggedId(null);
    setDragOverId(null);
    await updateProject(user.uid, projectId, { taskOrder: [...next, ...doneTasks.map(t => t.id)] });
  };

  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); };

  const [analysis,        setAnalysis]        = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // AI feedback
  const [feedbackOpen,   setFeedbackOpen]   = useState(false);
  const [feedbackKey,    setFeedbackKey]     = useState('');
  const [feedbackText,   setFeedbackText]    = useState('');
  const [feedbackSaving, setFeedbackSaving]  = useState(false);

  // Action-to-task modal
  const [addedActions,   setAddedActions]   = useState(new Set());
  const [skippedActions, setSkippedActions] = useState(new Set());
  const [wontDoModal,    setWontDoModal]    = useState({ open: false, action: '', reason: '' });
  const [bulkCreating,   setBulkCreating]   = useState(false);

  // Unified task modal state
  const [taskModalOpen,     setTaskModalOpen]     = useState(false);
  const [taskModalTask,     setTaskModalTask]     = useState(null);
  const [taskModalDefaults, setTaskModalDefaults] = useState({});
  const [taskModalTitle,    setTaskModalTitle]    = useState('Add Task');
  const [taskSaving,        setTaskSaving]        = useState(false);

  // Edit project modal
  const [editOpen,   setEditOpen]   = useState(false);
  const [editForm,   setEditForm]   = useState({});
  const [editSaving, setEditSaving] = useState(false);
  // Task completion note
  const [completionNote, setCompletionNote] = useState({ open: false, task: null, text: '' });

  // Drag-to-reorder
  const [draggedId, setDraggedId]   = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  // Project completion flow
  const [completeOpen,        setCompleteOpen]        = useState(false);
  const [completeRetro,       setCompleteRetro]       = useState('');
  const [completeRetroLoading,setCompleteRetroLoading]= useState(false);
  const [completeLessons,     setCompleteLessons]     = useState('');
  const [completeArchive,     setCompleteArchive]     = useState(true);
  const [completeSaving,      setCompleteSaving]      = useState(false);

  const buildContext = useCallback(() => {
    let calendarDensity = null;
    try {
      const stored = sessionStorage.getItem('calendarDensity');
      if (stored) calendarDensity = JSON.parse(stored);
    } catch {}
    return buildHolisticContext({
      goals,
      tasks,
      projects,
      brainDumps:              brainDumps || [],
      brainDumpDigests:        brainDumpDigests || [],
      weeklyReviews:           weeklyReviews || [],
      userProfile:             userProfile || profile,
      calendarDensity,
      manualCashFlow,
      debtAccounts:            debtAccounts || [],
      assetAccounts:           assetAccounts || [],
      notes:                   notes || [],
      savingsAnalysis,
      savingsHistory,
      habits:                  habits || [],
      habitLogs:               habitLogs || [],
      dailyReviews:            dailyReviews || [],
      actedOnRecommendations:  actedOnRecommendations || [],
    });
  }, [goals, tasks, projects, brainDumps, brainDumpDigests, weeklyReviews, userProfile, profile, manualCashFlow, debtAccounts, assetAccounts, notes, actedOnRecommendations]);

  const { score: mScore, factors: mFactors } = useMemo(() => {
    if (!project) return { score: 50, factors: [] };
    return calculateMomentum(project, projectTasks);
  }, [project, projectTasks]);
  const mBlurb = useMemo(() => getMomentumBlurb(mScore, mFactors), [mScore, mFactors]);

  const dedupedActions = useMemo(() => {
    if (!analysis?.thisWeekActions) return [];
    const dismissed = new Set([
      ...(project?.dismissedActions || []).map(d => d.action),
      ...skippedActions,
    ]);
    return analysis.thisWeekActions.filter(action => {
      if (dismissed.has(action)) return false;
      const actionLower = action.toLowerCase();
      return !activeTasks.some(t => {
        const tLower = t.title.toLowerCase();
        return tLower.includes(actionLower) || actionLower.includes(tLower);
      });
    });
  }, [analysis, activeTasks, project?.dismissedActions, skippedActions]);

  const loadAnalysis = useCallback(async (force = false) => {
    if (!project || analysisLoading) return;

    if (!force) {
      const cached = await getAICache(user.uid, `project-analysis-${projectId}`, 6);
      if (cached) {
        try { setAnalysis(JSON.parse(cached)); return; } catch {}
      }
    }
    setAnalysisLoading(true);
    try {
      const holisticContext = buildContext();
      const result = await generateProjectAnalysis({
        project,
        linkedTasks:     projectTasks,
        completedTasks:  doneTasks,
        linkedGoal,
        holisticContext,
        momentumScore:   mScore,
      });
      if (result) {
        setAnalysis(result);
        await saveAICache(user.uid, `project-analysis-${projectId}`, JSON.stringify(result));
      }
    } catch (err) {
      console.error('Project analysis error:', err);
    } finally {
      setAnalysisLoading(false);
    }
  }, [project, projectId, user, projectTasks, doneTasks, linkedGoal, buildContext, mScore]); // eslint-disable-line react-hooks/exhaustive-deps -- analysisLoading intentionally omitted; including it would create a stale closure cycle

  useEffect(() => {
    if (project) loadAnalysis();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps -- loadAnalysis is a useCallback; adding it as a dep would cause infinite re-renders as its reference changes

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim()) return;
    setFeedbackSaving(true);
    try {
      const existing = userProfile?.aiFeedback || profile?.aiFeedback || {};
      const newFeedback = { ...existing, [feedbackKey]: feedbackText.trim() };
      await saveProfile(user.uid, { aiFeedback: newFeedback });
      await updateProfile({ aiFeedback: newFeedback });
      setFeedbackOpen(false);
      setFeedbackText('');
      // Re-generate with correction injected
      await loadAnalysis(true);
    } catch (err) {
      console.error('Feedback save error:', err);
    } finally {
      setFeedbackSaving(false);
    }
  };

  const openActionModal = (action) => {
    setTaskModalTask(null);
    setTaskModalDefaults({ projectId, title: action, _source: 'project-action' });
    setTaskModalTitle('Create Task from Action');
    setTaskModalOpen(true);
  };

  const handleBulkCreate = async () => {
    if (!dedupedActions.length || bulkCreating) return;
    setBulkCreating(true);
    try {
      const remaining = dedupedActions.filter(a => !addedActions.has(a));
      await Promise.all(remaining.map(action =>
        addTask(user.uid, {
          title:     action,
          priority:  'high',
          project:   project?.title || 'Inbox',
          projectId: projectId,
          source:    'project-action',
          status:    'pending',
        })
      ));
      setAddedActions(new Set(dedupedActions));
    } finally {
      setBulkCreating(false);
    }
  };

  const handleWontDo = async () => {
    const { action, reason } = wontDoModal;
    if (!action) return;
    const existing = project.dismissedActions || [];
    const newDismissed = [...existing, { action, reason: reason.trim(), date: new Date().toISOString().slice(0, 10) }];
    setSkippedActions(prev => new Set([...prev, action]));
    setWontDoModal({ open: false, action: '', reason: '' });
    await updateProject(user.uid, projectId, { dismissedActions: newDismissed });
  };

  const openAddTask = () => {
    setTaskModalTask(null);
    setTaskModalDefaults({ projectId });
    setTaskModalTitle('Add Task to Project');
    setTaskModalOpen(true);
  };

  const handleTaskModalSave = async (formData) => {
    setTaskSaving(true);
    try {
      await addTask(user.uid, {
        title:            formData.title,
        priority:         formData.priority,
        focusType:        formData.focusType || null,
        context:          formData.context || null,
        projectId:        formData.projectId || projectId,
        goalId:           formData.goalId || null,
        estimatedMinutes: formData.estimatedMinutes ? Number(formData.estimatedMinutes) : null,
        startDate:        formData.startDate || null,
        dueDate:          formData.dueDate || null,
        notes:            formData.notes || '',
        tags:             formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : null,
        recurrence:       formData.recurrence !== 'none' ? formData.recurrence : null,
        blockedBy:        formData.blockedBy || [],
        source:           formData._source || 'project',
        status:           'pending',
      });
      if (formData._source === 'project-action') {
        setAddedActions(prev => new Set([...prev, formData.title]));
      }
      setTaskModalOpen(false);
      setTaskModalTask(null);
    } finally {
      setTaskSaving(false);
    }
  };

  const openEdit = () => {
    setEditForm({
      title:    project.title    || '',
      category: project.category || 'work',
      status:   project.status   || 'active',
      blockers: project.blockers || '',
      notes:    project.notes    || '',
      goalId:   project.goalId   || '',
      context:  project.context  || '',
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editForm.title.trim()) return;
    setEditSaving(true);
    try {
      const updates = {
        title:    editForm.title.trim(),
        category: editForm.category || 'work',
        status:   editForm.status   || 'active',
        blockers: editForm.blockers || '',
        notes:    editForm.notes    || '',
        goalId:   editForm.goalId   || null,
        context:  editForm.context  || null,
      };
      if (project.status === 'stalled' && editForm.status === 'active') {
        updates.deferCount = (project.deferCount || 0) + 1;
      }
      await updateProject(user.uid, projectId, updates);
      setEditOpen(false);
    } catch (err) {
      console.error('Edit project error:', err);
      alert('Failed to save. Please try again.');
    } finally {
      setEditSaving(false);
    }
  };

  const openCompleteFlow = async () => {
    setCompleteRetro('');
    setCompleteLessons('');
    setCompleteArchive(true);
    setCompleteOpen(true);
    setCompleteRetroLoading(true);
    try {
      const createdMs = project.createdAt?.toDate?.().getTime() ?? (project.createdAt ? new Date(project.createdAt).getTime() : null);
      const weeksSpent = createdMs ? Math.max(1, Math.round((Date.now() - createdMs) / (7 * 24 * 60 * 60 * 1000))) : null;
      const notes = doneTasks.filter(t => t.completionNote).map(t => t.completionNote).slice(0, 6).join('; ');
      const prompt = [
        `Project "${project.title}" (${project.category}) just completed.`,
        weeksSpent ? `Duration: ~${weeksSpent} week${weeksSpent !== 1 ? 's' : ''}.` : '',
        `Tasks: ${doneTasks.length} done${activeTasks.length > 0 ? `, ${activeTasks.length} remaining open` : ''}.`,
        notes ? `Key notes from tasks: ${notes}` : '',
        linkedGoal ? `Linked goal: "${linkedGoal.title}".` : '',
        `Momentum at close: ${mScore}%.`,
        '',
        'Write a 2-sentence project retrospective. Sentence 1: what was accomplished. Sentence 2: one specific insight from the work. Be direct, no preamble.',
      ].filter(Boolean).join(' ');
      const retro = await callAI({ messages: [{ role: 'user', content: prompt }], maxTokens: 150 });
      setCompleteRetro(retro || '');
    } catch {
      setCompleteRetro('');
    } finally {
      setCompleteRetroLoading(false);
    }
  };

  const handleCompleteConfirm = async () => {
    setCompleteSaving(true);
    try {
      await updateProject(user.uid, projectId, {
        status:         'complete',
        completedAt:    new Date().toISOString(),
        retrospective:  completeRetro,
        lessonsLearned: completeLessons.trim() || null,
      });
      if (completeArchive && activeTasks.length > 0) {
        await Promise.all(activeTasks.map(t =>
          updateTask(user.uid, t.id, { done: true, status: 'dropped', completedAt: new Date().toISOString() })
        ));
      }
      setCompleteOpen(false);
    } catch (err) {
      console.error('Complete project error:', err);
    } finally {
      setCompleteSaving(false);
    }
  };

  const handleSaveCompletionNote = async () => {
    if (completionNote.text.trim()) {
      await updateTask(user.uid, completionNote.task.id, { completionNote: completionNote.text.trim() });
    }
    setCompletionNote({ open: false, task: null, text: '' });
  };

  const handleToggleTask = async (task) => {
    const isDone = !task.done;
    await updateTask(user.uid, task.id, {
      done:        isDone,
      status:      isDone ? 'completed' : 'pending',
      completedAt: isDone ? new Date().toISOString() : null,
    });
    // Bump project activity so stall detection and momentum recalculate correctly
    await updateProject(user.uid, projectId, {});
    if (isDone) setCompletionNote({ open: true, task, text: '' });
  };

  if (!project) {
    return (
      <div style={{ maxWidth: 720, margin: '60px auto', textAlign: 'center', padding: '0 20px' }}>
        <div style={{ fontSize: '13px', color: tokens.textMuted, marginBottom: '16px' }}>Project not found.</div>
        <Button onClick={() => navigate('/projects')} variant="ghost">← Back to Projects</Button>
      </div>
    );
  }

  const statusColors = {
    active:   { bg: 'rgba(109,191,158,0.15)', text: tokens.green  },
    planning: { bg: tokens.accentDim,         text: tokens.accent },
    stalled:  { bg: tokens.redDim,            text: tokens.red    },
    paused:   { bg: tokens.bgGlass,           text: tokens.textMuted },
    complete: { bg: tokens.greenDim,          text: tokens.green  },
  };
  // DataContext handles stall/reactivation; this is a display-only fallback for the rare
  // case where Firestore hasn't caught up yet (no write side effect here).
  const displayStatus = (project.status === 'stalled' && mScore > 50) ? 'active' : project.status;
  const sc = statusColors[displayStatus] || statusColors.paused;

  const thumbBtnStyle = (active) => ({
    background: active ? tokens.accentDim : 'transparent',
    border: `1px solid ${active ? tokens.accent : tokens.border}`,
    borderRadius: '6px',
    padding: '4px 10px',
    fontSize: '12px',
    cursor: 'pointer',
    color: active ? tokens.accent : tokens.textMuted,
    fontFamily: fonts.body,
    transition: 'all 0.12s',
  });

  const remainingActions = dedupedActions.filter(a => !addedActions.has(a));
  const taskProgress = projectTasks.length > 0
    ? Math.round((doneTasks.length / projectTasks.length) * 100) : 0;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: '40px' }}>

      {/* Back */}
      <button onClick={() => navigate('/projects')}
        style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: '13px', fontFamily: fonts.body, padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: '5px' }}>
        ← Projects
      </button>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '5px', background: sc.bg, color: sc.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {displayStatus}
          </span>
          <span style={{ fontSize: '11px', color: tokens.textMuted }}>{project.category}</span>
          {linkedGoal && (
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '5px', background: 'rgba(91,143,212,0.15)', color: '#5B8FD4', cursor: 'pointer' }}
              onClick={() => navigate(`/goals/${linkedGoal.id}`)}>
              ↗ {linkedGoal.title}
            </span>
          )}
          <span style={{ fontSize: '11px', color: tokens.textMuted }}>· Updated {daysSince(project.updatedAt) || 'just now'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>
            {project.title}
          </h1>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0, marginTop: '4px' }}>
            {project.status !== 'complete' && (
              <Button variant="ghost" size="sm" onClick={openCompleteFlow} style={{ color: tokens.green, borderColor: `${tokens.green}40` }}>✓ Complete</Button>
            )}
            <Button variant="ghost" size="sm" onClick={openEdit}>Edit</Button>
          </div>
        </div>
        {project.notes && (
          <div style={{ fontSize: '14px', color: tokens.textSecondary, lineHeight: 1.55 }}>
            {project.notes}
          </div>
        )}
      </div>

      {/* ── COMPLETED PROJECT VIEW ── */}
      {project.status === 'complete' && (
        <>
          {/* Completion header */}
          <Card style={{ background: `linear-gradient(135deg, ${tokens.greenDim} 0%, ${tokens.bgCard} 100%)`, borderColor: `${tokens.green}40` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
              <div style={{ width: 44, height: 44, borderRadius: '12px', background: tokens.greenDim, border: `2px solid ${tokens.green}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>✓</div>
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.green, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '2px' }}>Project Complete</div>
                <div style={{ fontSize: '13px', color: tokens.textSecondary }}>
                  {project.completedAt ? `Finished ${new Date(project.completedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : 'Marked complete'}
                  {(() => {
                    const createdMs = project.createdAt?.toDate?.().getTime() ?? (project.createdAt ? new Date(project.createdAt).getTime() : null);
                    const completedMs = project.completedAt ? new Date(project.completedAt).getTime() : null;
                    if (!createdMs || !completedMs) return null;
                    const weeks = Math.max(1, Math.round((completedMs - createdMs) / (7 * 24 * 60 * 60 * 1000)));
                    return ` · ${weeks} week${weeks !== 1 ? 's' : ''}`;
                  })()}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {[
                { label: 'Tasks Done', val: doneTasks.length, color: tokens.green },
                { label: 'Total Tasks', val: projectTasks.length, color: tokens.textSecondary },
                { label: 'Category', val: project.category || '—', color: tokens.accent },
              ].map(s => (
                <div key={s.label} style={{ padding: '10px 16px', background: tokens.bgCard, borderRadius: '8px', border: `1px solid ${tokens.border}`, textAlign: 'center', minWidth: '80px' }}>
                  <div style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '2px' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Retrospective */}
          {(project.retrospective || project.lessonsLearned) && (
            <Card>
              <SectionLabel>Retrospective</SectionLabel>
              {project.retrospective && (
                <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.65, marginBottom: project.lessonsLearned ? '14px' : 0 }}>
                  {project.retrospective}
                </div>
              )}
              {project.lessonsLearned && (
                <div style={{ padding: '10px 14px', background: tokens.accentDim, borderRadius: '8px', border: `1px solid ${tokens.accent}30` }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Lessons Learned</div>
                  <div style={{ fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.55 }}>{project.lessonsLearned}</div>
                </div>
              )}
            </Card>
          )}

          {/* Completed task list */}
          <Card>
            <SectionLabel>{doneTasks.length} Tasks Completed</SectionLabel>
            {doneTasks.length === 0 && (
              <div style={{ fontSize: '13px', color: tokens.textMuted }}>No tasks recorded.</div>
            )}
            {doneTasks.map((task, i) => (
              <div key={task.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 0', borderBottom: i < doneTasks.length - 1 ? `1px solid ${tokens.border}` : 'none', opacity: 0.7 }}>
                <div style={{ width: 16, height: 16, borderRadius: '4px', flexShrink: 0, marginTop: '2px', border: `1.5px solid ${tokens.green}`, background: tokens.greenDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: tokens.green }}>✓</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: tokens.textPrimary, textDecoration: 'line-through' }}>{task.title}</div>
                  {task.completionNote && (
                    <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px', fontStyle: 'italic' }}>{task.completionNote}</div>
                  )}
                </div>
              </div>
            ))}
            {linkedGoal && (
              <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: `1px solid ${tokens.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '12px', color: tokens.textMuted }}>Contributed to goal:</div>
                <button onClick={() => navigate(`/goals/${linkedGoal.id}`)}
                  style={{ background: 'rgba(91,143,212,0.12)', color: '#5B8FD4', border: 'none', borderRadius: '6px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}>
                  ↗ {linkedGoal.title}
                </button>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── ACTIVE PROJECT CARDS (hidden when complete) ── */}
      {project.status !== 'complete' && <>

      {/* ── Momentum Card ── */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <SectionLabel style={{ marginBottom: 0 }}>Momentum</SectionLabel>
          <span style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: momentumColor(mScore) }}>
            {mScore}%
          </span>
        </div>
        <MomentumBar value={mScore} color={momentumColor(mScore)} height={5} />

        {/* Blurb */}
        <div style={{ fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.55, marginTop: '10px' }}>
          {mBlurb}
        </div>

        {/* Factor breakdown */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
          {mFactors.map((f, i) => (
            <span key={i} style={{
              fontSize: '11px', fontWeight: 600, padding: '3px 9px', borderRadius: '99px',
              background: f.delta > 0 ? tokens.greenDim : f.delta < 0 ? tokens.redDim : tokens.bgGlass,
              color:      f.delta > 0 ? tokens.green   : f.delta < 0 ? tokens.red    : tokens.textMuted,
              border:     `1px solid ${f.delta > 0 ? tokens.green + '30' : f.delta < 0 ? tokens.red + '30' : tokens.border}`,
            }}>
              {f.icon} {f.label}
            </span>
          ))}
        </div>

        {(() => {
          const nextActions = getProjectNextAction(projectId, tasks);
          const hasNext = nextActions.length > 0;
          if (!hasNext && !project.blockers) return null;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: hasNext && project.blockers ? '1fr 1fr' : '1fr', gap: '8px', marginTop: '14px' }}>
              {hasNext && (
                <div style={{ padding: '10px 12px', background: tokens.accentGlow, borderRadius: '8px', borderLeft: `2px solid ${tokens.accent}` }}>
                  <div style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, marginBottom: '3px' }}>NEXT ACTION</div>
                  {nextActions.map((a, i) => (
                    <div key={i} style={{ fontSize: '12px', color: tokens.textPrimary, marginTop: i > 0 ? '4px' : 0 }}>
                      {a.title}
                      {a.dueDate && <span style={{ fontSize: '10px', color: tokens.textMuted, marginLeft: '6px' }}>due {a.dueDate}</span>}
                    </div>
                  ))}
                </div>
              )}
              {project.blockers && (
                <div style={{ padding: '10px 12px', background: tokens.redDim, borderRadius: '8px', borderLeft: `2px solid ${tokens.red}` }}>
                  <div style={{ fontSize: '10px', color: tokens.red, fontWeight: 700, marginBottom: '3px' }}>BLOCKER</div>
                  <div style={{ fontSize: '12px', color: tokens.textPrimary }}>{project.blockers}</div>
                </div>
              )}
            </div>
          );
        })()}

        {projectTasks.length > 0 && (
          <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${tokens.border}` }}>
            <MomentumBar value={taskProgress} color={tokens.green} height={4} />
            <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '4px' }}>
              {doneTasks.length}/{projectTasks.length} tasks complete
            </div>
          </div>
        )}
      </Card>

      {/* ── AI Analysis Card ── */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <SectionLabel style={{ marginBottom: 0 }}>Anchor Analysis</SectionLabel>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {analysis && (
              <>
                <button style={thumbBtnStyle(false)} title="This is accurate"
                  onClick={() => {}}>👍</button>
                <button style={thumbBtnStyle(false)} title="Give feedback"
                  onClick={() => { setFeedbackKey(`projectAnalysis_${projectId}`); setFeedbackOpen(true); }}>👎</button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={() => loadAnalysis(true)} loading={analysisLoading}>
              {analysis ? '↻' : '✦ Run'}
            </Button>
          </div>
        </div>

        {analysisLoading && !analysis && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: tokens.textMuted, fontSize: '13px' }}>
            <Spinner size={14} /> Analyzing project trajectory…
          </div>
        )}

        {analysis && (
          <div>
            {analysis.statusStatement && (
              <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.65, marginBottom: '12px' }}>
                {analysis.statusStatement}
              </div>
            )}
            {analysis.momentumAdvice && (
              <div style={{ padding: '10px 14px', background: tokens.accentDim, borderRadius: '8px', border: `1px solid rgba(200,169,110,0.2)`, marginBottom: '12px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Momentum Advice</div>
                <div style={{ fontSize: '12px', color: tokens.textSecondary }}>{analysis.momentumAdvice}</div>
              </div>
            )}
            {analysis.topRisks?.length > 0 && (
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '8px' }}>Top Risks</div>
                {analysis.topRisks.map((risk, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: tokens.textMuted, padding: '4px 0', lineHeight: 1.45 }}>
                    <span style={{ color: tokens.red, flexShrink: 0 }}>⚑</span> {risk}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!analysis && !analysisLoading && (
          <div style={{ fontSize: '13px', color: tokens.textMuted }}>
            <span style={{ color: tokens.accent, cursor: 'pointer' }} onClick={() => loadAnalysis(true)}>Run analysis →</span>
          </div>
        )}
      </Card>

      {/* ── This Week Card ── */}
      {(analysisLoading || analysis) && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <SectionLabel style={{ marginBottom: 0 }}>This Week</SectionLabel>
            {analysis && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button style={thumbBtnStyle(false)} title="This is accurate" onClick={() => {}}>👍</button>
                <button style={thumbBtnStyle(false)} title="Give feedback"
                  onClick={() => { setFeedbackKey(`projectWeek_${projectId}`); setFeedbackOpen(true); }}>👎</button>
              </div>
            )}
          </div>

          {analysisLoading && !analysis && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: tokens.textMuted, fontSize: '13px' }}>
              <Spinner size={14} /> Analyzing…
            </div>
          )}

          {analysis && (
            <>
              {dedupedActions.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary }}>Required Actions</div>
                    {remainingActions.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={handleBulkCreate} loading={bulkCreating}>
                        + Create All ({remainingActions.length})
                      </Button>
                    )}
                  </div>
                  {dedupedActions.map((action, i) => {
                    const added = addedActions.has(action);
                    return (
                      <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: i < dedupedActions.length - 1 ? `1px solid ${tokens.border}` : 'none', alignItems: 'center' }}>
                        <span style={{ color: added ? tokens.green : tokens.accent, fontWeight: 700, fontSize: '12px', flexShrink: 0, minWidth: '16px' }}>
                          {added ? '✓' : `${i + 1}.`}
                        </span>
                        <span style={{ fontSize: '13px', color: added ? tokens.textMuted : tokens.textSecondary, lineHeight: 1.5, flex: 1, textDecoration: added ? 'line-through' : 'none' }}>
                          {action}
                        </span>
                        {!added && (
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <button
                              onClick={() => openActionModal(action)}
                              style={{ background: tokens.accentDim, border: `1px solid rgba(200,169,110,0.2)`, borderRadius: '5px', padding: '3px 10px', fontSize: '11px', fontWeight: 600, color: tokens.accent, cursor: 'pointer', fontFamily: fonts.body }}>
                              + Task
                            </button>
                            <button
                              onClick={() => setWontDoModal({ open: true, action, reason: '' })}
                              style={{ background: 'transparent', border: `1px solid ${tokens.border}`, borderRadius: '5px', padding: '3px 8px', fontSize: '11px', fontWeight: 500, color: tokens.textMuted, cursor: 'pointer', fontFamily: fonts.body }}>
                              Won't Do
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {analysis.whatToIgnore && (
                <div style={{ padding: '10px 14px', background: 'rgba(200,169,110,0.08)', borderRadius: '8px', border: `1px solid rgba(200,169,110,0.2)`, marginBottom: '14px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.amber, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Ignore This Week</div>
                  <div style={{ fontSize: '12px', color: tokens.textSecondary }}>{analysis.whatToIgnore}</div>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* ── Task List Card ── */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <SectionLabel style={{ marginBottom: 0 }}>Tasks · {doneTasks.length}/{projectTasks.length} done</SectionLabel>
          <Button size="sm" variant="ghost" onClick={openAddTask}>+ Add Task</Button>
        </div>

        {projectTasks.length === 0 && (
          <div style={{ fontSize: '13px', color: tokens.textMuted, textAlign: 'center', padding: '20px 0' }}>
            No tasks yet. Add one above or use Required Actions to create them.
          </div>
        )}

        {/* Active tasks — drag to reorder */}
        {orderedActiveTasks.map((task, i) => {
          const due        = formatDue(task.dueDate);
          const isDragging = draggedId === task.id;
          const isDragOver = dragOverId === task.id && draggedId !== task.id;
          return (
            <div
              key={task.id}
              draggable
              onDragStart={e => handleDragStart(e, task.id)}
              onDragOver={e => handleDragOver(e, task.id)}
              onDrop={e => handleDrop(e, task.id)}
              onDragEnd={handleDragEnd}
              style={{
                display: 'flex', gap: '8px', alignItems: 'flex-start',
                padding: '9px 0',
                borderBottom: i < orderedActiveTasks.length - 1 || doneTasks.length > 0 ? `1px solid ${tokens.border}` : 'none',
                background: isDragOver ? tokens.accentDim : 'transparent',
                borderRadius: isDragOver ? '6px' : 0,
                opacity: isDragging ? 0.35 : 1,
                transition: 'opacity 0.12s, background 0.1s',
              }}
            >
              {/* Drag handle */}
              <div style={{ color: tokens.textMuted, fontSize: '13px', cursor: 'grab', paddingTop: '2px', flexShrink: 0, opacity: 0.35, userSelect: 'none' }}>⠿</div>
              {/* Checkbox */}
              <div
                onClick={() => handleToggleTask(task)}
                style={{ width: 18, height: 18, borderRadius: '4px', flexShrink: 0, marginTop: '2px', border: `1.5px solid ${tokens.border}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.green; e.currentTarget.style.background = 'rgba(109,191,158,0.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.background = 'transparent'; }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.4 }}>{task.title}</div>
                <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ textTransform: 'capitalize' }}>{task.priority}</span>
                  {task.estimatedMinutes && <span>⏱ {task.estimatedMinutes}m</span>}
                  {due && <span style={{ color: due.color, fontWeight: 600 }}>{due.label}</span>}
                  {isTaskBlocked(task, tasks) && (
                    <span style={{ fontSize: '10px', fontWeight: 700, color: tokens.amber, background: 'rgba(200,160,50,0.15)', padding: '1px 6px', borderRadius: '4px' }}>⊘ Blocked</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Completed tasks */}
        {doneTasks.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '6px', paddingTop: '4px' }}>
              {doneTasks.length} completed
            </div>
            {doneTasks.slice(0, 4).map(task => (
              <div key={task.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '6px 0', opacity: 0.5 }}>
                <div style={{ width: 18, height: 18, borderRadius: '4px', flexShrink: 0, border: `1.5px solid ${tokens.green}`, background: 'rgba(109,191,158,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: tokens.green }}>✓</div>
                <div style={{ fontSize: '13px', color: tokens.textPrimary, textDecoration: 'line-through' }}>{task.title}</div>
              </div>
            ))}
            {doneTasks.length > 4 && (
              <div style={{ fontSize: '11px', color: tokens.textMuted, paddingLeft: '28px' }}>+{doneTasks.length - 4} more</div>
            )}
          </div>
        )}
      </Card>

      </> /* end active-only section */}

      {/* Unified Task Modal */}
      <TaskModal
        open={taskModalOpen}
        onClose={() => { setTaskModalOpen(false); setTaskModalTask(null); }}
        onSave={handleTaskModalSave}
        task={taskModalTask}
        defaultValues={taskModalDefaults}
        modalTitle={taskModalTitle}
        saving={taskSaving}
      />

      {/* ── Edit Project Modal ── */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Project">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Project Title" value={editForm.title || ''} onChange={v => setEditForm(f => ({ ...f, title: v }))} placeholder="e.g. Half Bath Remodel" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Category</label>
              <select value={editForm.category || 'work'} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Status</label>
              <select value={editForm.status || 'active'} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Linked Goal</label>
              <select value={editForm.goalId || ''} onChange={e => setEditForm(f => ({ ...f, goalId: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                <option value="">No linked goal</option>
                {(goals || []).filter(g => g.status === 'active').map(g => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Context</label>
              <select value={editForm.context || ''} onChange={e => setEditForm(f => ({ ...f, context: e.target.value }))}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                <option value="">No context</option>
                <option value="wells-fargo">Wells Fargo</option>
                <option value="personal">Personal</option>
                <option value="side-business">Side Business</option>
                <option value="home-family">Home/Family</option>
                <option value="financial">Financial Recovery</option>
              </select>
            </div>
          </div>
          <Input label="Blockers" value={editForm.blockers || ''} onChange={v => setEditForm(f => ({ ...f, blockers: v }))} placeholder="What's in the way?" />
          <Input label="Notes"       value={editForm.notes      || ''} onChange={v => setEditForm(f => ({ ...f, notes: v }))}      placeholder="Context, links, thoughts..." multiline rows={3} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSave} loading={editSaving} disabled={!editForm.title?.trim()}>Save Changes</Button>
          </div>
        </div>
      </Modal>

      {/* ── Won't Do Modal ── */}
      <Modal open={wontDoModal.open} onClose={() => setWontDoModal({ open: false, action: '', reason: '' })} title="Won't Do">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.5, padding: '10px 12px', background: tokens.bgGlass, borderRadius: '7px', border: `1px solid ${tokens.border}` }}>
            "{wontDoModal.action}"
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Why not? <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <textarea
              value={wontDoModal.reason}
              onChange={e => setWontDoModal(m => ({ ...m, reason: e.target.value }))}
              placeholder="e.g. Not relevant right now, already handled another way..."
              autoFocus
              rows={2}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleWontDo(); }}
            />
          </div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, lineHeight: 1.5 }}>
            This action will be removed from your list and the AI won't resurface it.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => setWontDoModal({ open: false, action: '', reason: '' })}>Cancel</Button>
            <Button onClick={handleWontDo}>Dismiss Action</Button>
          </div>
        </div>
      </Modal>

      {/* ── Completion Note Modal ── */}
      <Modal open={completionNote.open} onClose={() => setCompletionNote({ open: false, task: null, text: '' })} title="Task Done ✓">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>
            Optional: capture what you found, decided, or learned while doing this.
          </div>
          <textarea
            value={completionNote.text}
            onChange={e => setCompletionNote(n => ({ ...n, text: e.target.value }))}
            placeholder="e.g. Called vendor — price is $420, need approval from Mike..."
            autoFocus
            rows={3}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSaveCompletionNote(); }}
            style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => setCompletionNote({ open: false, task: null, text: '' })}>Skip</Button>
            <Button onClick={handleSaveCompletionNote}>Save Note</Button>
          </div>
        </div>
      </Modal>

      {/* ── Project Completion Flow ── */}
      <Modal open={completeOpen} onClose={() => setCompleteOpen(false)} title="Complete Project">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* AI Retrospective */}
          <div style={{ background: tokens.accentGlow, border: `1px solid ${tokens.accentDim}`, borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.1em', marginBottom: '8px' }}>AI RETROSPECTIVE</div>
            {completeRetroLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: tokens.textMuted, fontSize: '13px' }}>
                <Spinner size={13} /> Generating retrospective…
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.6 }}>
                {completeRetro || 'No retrospective generated.'}
              </div>
            )}
          </div>

          {/* Stats summary */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 1, padding: '10px', background: tokens.bgCardHover, borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: tokens.green, fontFamily: fonts.display }}>{doneTasks.length}</div>
              <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '2px' }}>tasks done</div>
            </div>
            {activeTasks.length > 0 && (
              <div style={{ flex: 1, padding: '10px', background: tokens.bgCardHover, borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: tokens.textSecondary, fontFamily: fonts.display }}>{activeTasks.length}</div>
                <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '2px' }}>still open</div>
              </div>
            )}
          </div>

          {/* Lessons learned */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>
              What would you do differently? <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </label>
            <textarea
              value={completeLessons}
              onChange={e => setCompleteLessons(e.target.value)}
              placeholder="Learnings, things to avoid next time, process improvements..."
              rows={3}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
            />
          </div>

          {/* Archive open tasks toggle */}
          {activeTasks.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={completeArchive}
                onChange={e => setCompleteArchive(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: tokens.accent, cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{ fontSize: '13px', color: tokens.textSecondary }}>
                Drop {activeTasks.length} open task{activeTasks.length !== 1 ? 's' : ''} — remove from active views
              </span>
            </label>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => setCompleteOpen(false)}>Cancel</Button>
            <Button onClick={handleCompleteConfirm} loading={completeSaving} style={{ background: tokens.green, color: '#0C0E12' }}>
              Mark Complete
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── AI Feedback Modal ── */}
      <Modal open={feedbackOpen} onClose={() => { setFeedbackOpen(false); setFeedbackText(''); }} title="Give AI Feedback">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>
            What's wrong with this analysis? Be specific — this will be saved as a hard constraint and the analysis will regenerate.
          </div>
          <textarea
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            placeholder="e.g. This project can't start until the vendor contract is signed..."
            autoFocus
            rows={4}
            style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => { setFeedbackOpen(false); setFeedbackText(''); }}>Cancel</Button>
            <Button onClick={handleFeedbackSubmit} loading={feedbackSaving} disabled={!feedbackText.trim()}>Save & Regenerate</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

