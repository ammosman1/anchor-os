// src/components/screens/NotesScreen.js
import React, { useState, useMemo } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addNote, updateNote, deleteNote } from '../../lib/db';
import { Button, Modal, Input } from '../ui';

const BLANK_FORM = { title: '', body: '', goalId: '', projectId: '', pinned: false };

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotesScreen() {
  const { user }              = useAuth();
  const { notes, goals, projects } = useData();
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editNote,   setEditNote]   = useState(null);
  const [form,       setForm]       = useState(BLANK_FORM);
  const [saving,     setSaving]     = useState(false);
  const [deleteConf, setDeleteConf] = useState(null);
  const [search,     setSearch]     = useState('');
  const [filterGoal, setFilterGoal] = useState('');

  const activeGoals    = (goals || []).filter(g => g.status === 'active');
  const activeProjects = (projects || []).filter(p => p.status === 'active');

  const openAdd = () => { setEditNote(null); setForm(BLANK_FORM); setModalOpen(true); };
  const openEdit = (n) => {
    setEditNote(n);
    setForm({ title: n.title || '', body: n.body || '', goalId: n.goalId || '', projectId: n.projectId || '', pinned: !!n.pinned });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try {
      const data = {
        title:     form.title.trim(),
        body:      form.body.trim(),
        goalId:    form.goalId    || null,
        projectId: form.projectId || null,
        pinned:    form.pinned,
      };
      if (editNote) {
        await updateNote(user.uid, editNote.id, data);
      } else {
        await addNote(user.uid, data);
      }
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConf) return;
    await deleteNote(user.uid, deleteConf.id);
    setDeleteConf(null);
    setModalOpen(false);
  };

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

  const NoteCard = ({ note }) => {
    const linkedGoal    = activeGoals.find(g => g.id === note.goalId);
    const linkedProject = activeProjects.find(p => p.id === note.projectId);
    return (
      <div
        onClick={() => openEdit(note)}
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
          {linkedGoal && <span style={{ fontSize: '10px', color: tokens.accent }}>◆ {linkedGoal.title}</span>}
          {linkedProject && <span style={{ fontSize: '10px', color: tokens.blue }}>◈ {linkedProject.title}</span>}
          <span style={{ fontSize: '10px', color: tokens.textMuted, marginLeft: 'auto' }}>{fmtDate(note.updatedAt)}</span>
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
        <Button onClick={openAdd}>+ New Note</Button>
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
          <Button onClick={openAdd}>+ Write First Note</Button>
        </div>
      )}

      {/* Pinned section */}
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

      {/* Edit / Add Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editNote ? 'Edit Note' : 'New Note'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input
            label="Title"
            value={form.title}
            onChange={v => setForm(p => ({ ...p, title: v }))}
            placeholder="Note title"
          />
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Content</label>
            <textarea
              value={form.body}
              onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
              placeholder="Write anything — context, ideas, reference material, links…"
              rows={8}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 12px', color: tokens.textPrimary, fontSize: '13px', lineHeight: 1.65, resize: 'vertical', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {activeGoals.length > 0 && (
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Goal (optional)</label>
                <select value={form.goalId} onChange={e => setForm(p => ({ ...p, goalId: e.target.value }))}
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                  <option value="">No goal</option>
                  {activeGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              </div>
            )}
            {activeProjects.length > 0 && (
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Project (optional)</label>
                <select value={form.projectId} onChange={e => setForm(p => ({ ...p, projectId: e.target.value }))}
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                  <option value="">No project</option>
                  {activeProjects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
            )}
          </div>
          {/* Pin toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: tokens.bgGlass, borderRadius: '8px', cursor: 'pointer' }}
            onClick={() => setForm(p => ({ ...p, pinned: !p.pinned }))}>
            <div style={{
              width: 18, height: 18, borderRadius: '4px', border: `2px solid ${form.pinned ? tokens.accent : tokens.border}`,
              background: form.pinned ? tokens.accentDim : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', color: tokens.accent, transition: 'all 0.12s', flexShrink: 0,
            }}>
              {form.pinned ? '✓' : ''}
            </div>
            <span style={{ fontSize: '13px', color: tokens.textSecondary }}>Pin this note — surfaces in AI advisor context</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {editNote && (
                <Button onClick={() => setDeleteConf(editNote)} variant="ghost" style={{ color: tokens.red, borderColor: tokens.red }}>Delete</Button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button onClick={() => setModalOpen(false)} variant="ghost">Cancel</Button>
              <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>
                {editNote ? 'Save' : 'Create Note'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteConf} onClose={() => setDeleteConf(null)} title="Delete Note">
        {deleteConf && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: tokens.textSecondary, lineHeight: 1.6 }}>
              Delete <strong style={{ color: tokens.textPrimary }}>{deleteConf.title}</strong>? This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setDeleteConf(null)} variant="ghost">Cancel</Button>
              <Button onClick={handleDelete} variant="danger">Delete Note</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
