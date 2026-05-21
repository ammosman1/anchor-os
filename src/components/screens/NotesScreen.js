// src/components/screens/NotesScreen.js
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addNote, updateNote, deleteNote } from '../../lib/db';
import { Button } from '../ui';
import { fmtRelativeDate } from '../../lib/dates';

const BLANK_FORM = { title: '', body: '', goalId: '', projectId: '', pinned: false };

// ─── NoteDetail — full-page editor ───────────────────────────────────────────

function NoteDetail({ note, goals, projects, user, onBack, onDeleted }) {
  const isNew = !note;
  const [form, setForm] = useState(
    note
      ? { title: note.title || '', body: note.body || '', goalId: note.goalId || '', projectId: note.projectId || '', pinned: !!note.pinned }
      : BLANK_FORM
  );
  const [saving, setSaving]       = useState(false);
  const [saved,  setSaved]        = useState(false);
  const [delConf, setDelConf]     = useState(false);
  const [showMeta, setShowMeta]   = useState(false);
  const saveTimer = useRef(null);
  const noteIdRef = useRef(note?.id || null);
  const titleRef  = useRef(null);
  const bodyRef   = useRef(null);

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
    else        bodyRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(async (data) => {
    setSaving(true);
    try {
      if (noteIdRef.current) {
        await updateNote(user.uid, noteIdRef.current, data);
      } else if (data.title.trim()) {
        const ref = await addNote(user.uid, data);
        noteIdRef.current = ref.id;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {}
    setSaving(false);
  }, [user.uid]);

  const scheduleAutoSave = useCallback((nextForm) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(nextForm), 900);
  }, [persist]);

  const update = (field, value) => {
    const next = { ...form, [field]: value };
    setForm(next);
    scheduleAutoSave(next);
  };

  // flush on unmount
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const handleBack = async () => {
    clearTimeout(saveTimer.current);
    if (form.title.trim()) await persist(form);
    onBack();
  };

  const handleDelete = async () => {
    if (noteIdRef.current) {
      await deleteNote(user.uid, noteIdRef.current);
      onDeleted();
    } else {
      onBack();
    }
  };

  const activeGoals    = goals.filter(g => g.status === 'active');
  const activeProjects = projects.filter(p => p.status === 'active');
  const linkedGoal    = activeGoals.find(g => g.id === form.goalId);
  const linkedProject = activeProjects.find(p => p.id === form.projectId);

  const wordCount = form.body.trim() ? form.body.trim().split(/\s+/).length : 0;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 120px)' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <button
          onClick={handleBack}
          style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: '13px', fontFamily: fonts.body, display: 'flex', alignItems: 'center', gap: '5px', padding: 0 }}
        >
          ← Notes
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {saving && <span style={{ fontSize: '11px', color: tokens.textMuted }}>Saving…</span>}
          {saved  && <span style={{ fontSize: '11px', color: tokens.green }}>✓ Saved</span>}
          <button
            onClick={() => update('pinned', !form.pinned)}
            style={{ background: form.pinned ? tokens.accentDim : 'transparent', border: `1px solid ${form.pinned ? tokens.accent : tokens.border}`, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: form.pinned ? tokens.accent : tokens.textMuted, cursor: 'pointer', fontFamily: fonts.body, fontWeight: 600 }}
          >
            {form.pinned ? '📌 Pinned' : 'Pin'}
          </button>
          <button
            onClick={() => setShowMeta(v => !v)}
            style={{ background: showMeta ? tokens.bgCardHover : 'transparent', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: tokens.textMuted, cursor: 'pointer', fontFamily: fonts.body }}
          >
            {showMeta ? 'Hide ▲' : 'Links ▼'}
          </button>
          {!isNew && (
            <button
              onClick={() => setDelConf(true)}
              style={{ background: 'transparent', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: tokens.red, cursor: 'pointer', fontFamily: fonts.body, opacity: 0.7 }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Metadata strip */}
      {showMeta && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', padding: '12px 14px', background: tokens.bgCard, borderRadius: '10px', border: `1px solid ${tokens.border}`, flexWrap: 'wrap' }}>
          {activeGoals.length > 0 && (
            <div style={{ flex: '1 1 180px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted, marginBottom: '5px' }}>Goal</div>
              <select value={form.goalId} onChange={e => update('goalId', e.target.value)}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '7px', padding: '7px 9px', color: tokens.textPrimary, fontSize: '12px', fontFamily: fonts.body, outline: 'none' }}>
                <option value="">No goal</option>
                {activeGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </div>
          )}
          {activeProjects.length > 0 && (
            <div style={{ flex: '1 1 180px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.textMuted, marginBottom: '5px' }}>Project</div>
              <select value={form.projectId} onChange={e => update('projectId', e.target.value)}
                style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '7px', padding: '7px 9px', color: tokens.textPrimary, fontSize: '12px', fontFamily: fonts.body, outline: 'none' }}>
                <option value="">No project</option>
                {activeProjects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Context tags */}
      {(linkedGoal || linkedProject) && !showMeta && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          {linkedGoal    && <span style={{ fontSize: '11px', color: tokens.accent, background: tokens.accentDim, padding: '2px 8px', borderRadius: '5px' }}>◆ {linkedGoal.title}</span>}
          {linkedProject && <span style={{ fontSize: '11px', color: tokens.blue, background: tokens.blueDim || 'rgba(91,143,212,0.12)', padding: '2px 8px', borderRadius: '5px' }}>◈ {linkedProject.title}</span>}
        </div>
      )}

      {/* Title */}
      <input
        ref={titleRef}
        value={form.title}
        onChange={e => update('title', e.target.value)}
        placeholder="Untitled note"
        style={{
          width: '100%', background: 'transparent', border: 'none', outline: 'none',
          fontFamily: fonts.display, fontSize: '28px', fontWeight: 700,
          color: tokens.textPrimary, letterSpacing: '-0.02em', lineHeight: 1.25,
          marginBottom: '16px', boxSizing: 'border-box', padding: 0,
        }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); bodyRef.current?.focus(); } }}
      />

      {/* Body */}
      <textarea
        ref={bodyRef}
        value={form.body}
        onChange={e => update('body', e.target.value)}
        placeholder="Start writing…"
        style={{
          flex: 1, width: '100%', background: 'transparent', border: 'none', outline: 'none',
          fontFamily: fonts.body, fontSize: '15px', color: tokens.textSecondary,
          lineHeight: 1.75, resize: 'none', boxSizing: 'border-box', padding: 0,
          minHeight: '400px',
        }}
      />

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px', borderTop: `1px solid ${tokens.border}`, marginTop: '16px' }}>
        <span style={{ fontSize: '11px', color: tokens.textMuted }}>
          {wordCount > 0 ? `${wordCount} word${wordCount !== 1 ? 's' : ''}` : ''}
        </span>
        <span style={{ fontSize: '11px', color: tokens.textMuted }}>
          {form.pinned && '📌 pinned · '}auto-saves as you type
        </span>
      </div>

      {/* Delete confirm */}
      {delConf && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', padding: '24px', maxWidth: '360px', width: '100%' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '8px' }}>Delete this note?</div>
            <div style={{ fontSize: '13px', color: tokens.textMuted, marginBottom: '20px' }}>"{form.title || 'Untitled'}" will be permanently deleted.</div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setDelConf(false)}>Cancel</Button>
              <button onClick={handleDelete} style={{ background: tokens.red, border: 'none', borderRadius: '8px', padding: '9px 18px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Notes list ───────────────────────────────────────────────────────────────

export default function NotesScreen() {
  const { user }              = useAuth();
  const { notes, goals, projects } = useData();
  const [view,       setView]       = useState('list'); // 'list' | 'detail'
  const [activeNote, setActiveNote] = useState(null);   // null = new note
  const [search,     setSearch]     = useState('');
  const [filterGoal, setFilterGoal] = useState('');

  const activeGoals    = (goals || []).filter(g => g.status === 'active');
  const activeProjects = (projects || []).filter(p => p.status === 'active');

  const openNote = (note) => { setActiveNote(note); setView('detail'); };
  const openNew  = ()     => { setActiveNote(null); setView('detail'); };

  const filteredNotes = useMemo(() => {
    return (notes || []).filter(n => {
      if (filterGoal && n.goalId !== filterGoal) return false;
      if (search) {
        const q = search.toLowerCase();
        return n.title?.toLowerCase().includes(q) || n.body?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [notes, search, filterGoal]);

  const pinnedNotes = filteredNotes.filter(n => n.pinned);
  const otherNotes  = filteredNotes.filter(n => !n.pinned);

  if (view === 'detail') {
    return (
      <NoteDetail
        note={activeNote}
        goals={goals || []}
        projects={projects || []}
        user={user}
        onBack={() => setView('list')}
        onDeleted={() => setView('list')}
      />
    );
  }

  const NoteCard = ({ note }) => {
    const linkedGoal    = activeGoals.find(g => g.id === note.goalId);
    const linkedProject = activeProjects.find(p => p.id === note.projectId);
    return (
      <div
        onClick={() => openNote(note)}
        style={{
          background: tokens.bgCard, border: `1px solid ${note.pinned ? tokens.accent : tokens.border}`,
          borderRadius: '10px', padding: '14px 16px', cursor: 'pointer',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          position: 'relative',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.borderHover; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = note.pinned ? tokens.accent : tokens.border; e.currentTarget.style.boxShadow = 'none'; }}
      >
        {note.pinned && (
          <div style={{ position: 'absolute', top: 8, right: 10, fontSize: '11px', color: tokens.accent, opacity: 0.8 }}>📌</div>
        )}
        <div style={{ fontSize: '14px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '6px', lineHeight: 1.3, paddingRight: note.pinned ? '20px' : 0 }}>
          {note.title}
        </div>
        {note.body && (
          <div style={{ fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.55, marginBottom: '8px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
            {note.body}
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {linkedGoal    && <span style={{ fontSize: '10px', color: tokens.accent }}>◆ {linkedGoal.title}</span>}
          {linkedProject && <span style={{ fontSize: '10px', color: tokens.blue }}>◈ {linkedProject.title}</span>}
          <span style={{ fontSize: '10px', color: tokens.textMuted, marginLeft: 'auto' }}>{fmtRelativeDate(note.updatedAt)}</span>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, margin: 0, letterSpacing: '-0.02em' }}>Notes</h1>
          {notes.length > 0 && <div style={{ fontSize: '13px', color: tokens.textMuted, marginTop: '4px' }}>{notes.length} note{notes.length !== 1 ? 's' : ''}</div>}
        </div>
        <Button onClick={openNew}>+ New Note</Button>
      </div>

      {/* Search + filter */}
      {notes.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: '160px', padding: '7px 11px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '8px', color: tokens.textPrimary, fontSize: '13px', fontFamily: fonts.body, outline: 'none' }}
          />
          {activeGoals.length > 0 && (
            <select value={filterGoal} onChange={e => setFilterGoal(e.target.value)}
              style={{ padding: '7px 11px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '8px', color: filterGoal ? tokens.textPrimary : tokens.textMuted, fontSize: '13px', fontFamily: fonts.body, outline: 'none', cursor: 'pointer' }}>
              <option value="">All goals</option>
              {activeGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          )}
        </div>
      )}

      {/* Empty state */}
      {notes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: tokens.textMuted }}>
          <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.4 }}>▤</div>
          <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: tokens.textSecondary }}>No notes yet</div>
          <div style={{ fontSize: '13px', marginBottom: '20px', lineHeight: 1.6 }}>
            Capture thoughts, context, and reference material. Pinned notes feed into your AI advisor's context.
          </div>
          <Button onClick={openNew}>+ Write First Note</Button>
        </div>
      )}

      {/* Pinned */}
      {pinnedNotes.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.accent, marginBottom: '8px' }}>Pinned</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
            {pinnedNotes.map(n => <NoteCard key={n.id} note={n} />)}
          </div>
        </div>
      )}

      {/* Other notes */}
      {otherNotes.length > 0 && (
        <div>
          {pinnedNotes.length > 0 && (
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.textMuted, marginBottom: '8px' }}>All Notes</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
            {otherNotes.map(n => <NoteCard key={n.id} note={n} />)}
          </div>
        </div>
      )}

      {/* No results */}
      {notes.length > 0 && filteredNotes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: tokens.textMuted, fontSize: '13px' }}>No notes match your search.</div>
      )}
    </div>
  );
}
