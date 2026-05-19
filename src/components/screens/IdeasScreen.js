// src/components/screens/IdeasScreen.js
import React, { useState } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { evaluateIdea } from '../../lib/ai';
import { addIdea, updateIdea, deleteIdea } from '../../lib/db';
import { EmptyState, Button, Input, Select, Modal } from '../ui';

const IDEA_STATUSES = [
  { value: 'explore', label: 'Explore' },
  { value: 'test',    label: 'Test'    },
  { value: 'active',  label: 'Active'  },
  { value: 'later',   label: 'Later'   },
  { value: 'no',      label: 'No'      },
];

const BLANK = { title: '', notes: '', tags: '', status: 'explore' };

function ideaToForm(idea) {
  return {
    title:  idea.title  || '',
    notes:  idea.notes  || '',
    tags:   Array.isArray(idea.tags) ? idea.tags.join(', ') : (idea.tags || ''),
    status: idea.status || 'explore',
  };
}

export default function IdeasScreen() {
  const { user } = useAuth();
  const { ideas } = useData();
  const [aiScores,  setAiScores]  = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editIdea,  setEditIdea]  = useState(null);
  const [form,      setForm]      = useState(BLANK);
  const [saving,    setSaving]    = useState(false);
  const [deleteConf, setDeleteConf] = useState(null);

  const openAdd = () => { setEditIdea(null); setForm(BLANK); setModalOpen(true); };
  const openEdit = (idea) => { setEditIdea(idea); setForm(ideaToForm(idea)); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditIdea(null); };

  const handleSave = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    const data = {
      title:  form.title.trim(),
      notes:  form.notes.trim(),
      tags:   form.tags.split(',').map(t => t.trim()).filter(Boolean),
      status: form.status,
    };
    if (editIdea) {
      await updateIdea(user.uid, editIdea.id, data);
    } else {
      await addIdea(user.uid, data);
    }
    setSaving(false);
    closeModal();
  };

  const handleDelete = async () => {
    if (!deleteConf) return;
    await deleteIdea(user.uid, deleteConf.id);
    setDeleteConf(null);
    setModalOpen(false);
  };

  const handleEvaluate = async (idea, e) => {
    e.stopPropagation();
    setLoadingId(idea.id);
    const result = await evaluateIdea({ ...idea, tags: idea.tags || [] });
    if (result) setAiScores(prev => ({ ...prev, [idea.id]: result }));
    setLoadingId(null);
  };

  const statusColor = (s) => ({ active: tokens.green, test: tokens.blue, explore: tokens.accent, later: tokens.textMuted, no: tokens.red })[s] || tokens.textMuted;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
        <div>
          <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Idea Vault</div>
          <h1 style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Idea Vault</h1>
          <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '6px' }}>Capture, evaluate, and surface the right ideas at the right time.</p>
        </div>
        <Button onClick={openAdd}>+ New Idea</Button>
      </div>

      <div className="fade-up stagger-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
        {ideas.length === 0 ? (
          <EmptyState icon="◇" title="No ideas captured yet" subtitle="Add ideas to evaluate their fit, effort, and timing." action={<Button onClick={openAdd}>+ First Idea</Button>} />
        ) : (
          ideas.map(idea => {
            const score = aiScores[idea.id];
            return (
              <div
                key={idea.id}
                onClick={() => openEdit(idea)}
                style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', padding: '16px 18px', cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.borderHover; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: tokens.textPrimary, flex: 1, paddingRight: '8px' }}>{idea.title}</div>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: statusColor(idea.status), textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>{idea.status}</span>
                </div>
                {idea.tags?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                    {idea.tags.map(t => <span key={t} style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, padding: '1px 7px', borderRadius: '4px', fontWeight: 600 }}>{t}</span>)}
                  </div>
                )}
                {idea.notes && <div style={{ fontSize: '12px', color: tokens.textMuted, lineHeight: 1.6, marginBottom: '10px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{idea.notes}</div>}

                {/* AI score preview if already evaluated */}
                {score && (
                  <div style={{ paddingTop: '10px', borderTop: `1px solid ${tokens.border}` }}>
                    <div style={{ background: tokens.accentDim, borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, marginBottom: '6px' }}>✦ AI EVALUATION</div>
                      <div style={{ fontSize: '12px', color: tokens.textPrimary, marginBottom: '6px' }}>{score.verdict}</div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <span style={{ fontSize: '10px', color: tokens.blue, background: tokens.blueDim, padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>Fit: {score.fitScore}%</span>
                        <span style={{ fontSize: '10px', color: statusColor(score.timing), background: tokens.accentDim, padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>{score.timing}</span>
                      </div>
                    </div>
                  </div>
                )}

                {!score && (
                  <div style={{ marginTop: '8px' }}>
                    <button
                      onClick={(e) => handleEvaluate(idea, e)}
                      disabled={loadingId === idea.id}
                      style={{ fontSize: '11px', color: tokens.accent, background: 'none', border: `1px solid ${tokens.accent}`, borderRadius: '6px', padding: '3px 10px', cursor: 'pointer', fontFamily: fonts.body, opacity: loadingId === idea.id ? 0.5 : 1 }}
                    >
                      {loadingId === idea.id ? 'Evaluating…' : '✦ AI Evaluate'}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal open={modalOpen} onClose={closeModal} title={editIdea ? 'Edit Idea' : 'Capture an Idea'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Idea Title" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="AI-powered onboarding SaaS" />
          <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Context, market observation, rough economics..." multiline rows={3} />
          <Input label="Tags (comma separated)" value={form.tags} onChange={v => setForm(f => ({ ...f, tags: v }))} placeholder="SaaS, AI, passive income" />
          <Select label="Status" value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))} options={IDEA_STATUSES} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {editIdea && (
                <Button onClick={() => setDeleteConf(editIdea)} variant="ghost" style={{ color: tokens.red, borderColor: tokens.red }}>Delete</Button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button onClick={closeModal} variant="ghost">Cancel</Button>
              <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>
                {editIdea ? 'Save' : 'Save Idea'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteConf} onClose={() => setDeleteConf(null)} title="Delete Idea">
        {deleteConf && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: tokens.textSecondary, lineHeight: 1.6 }}>
              Delete <strong style={{ color: tokens.textPrimary }}>{deleteConf.title}</strong>? This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setDeleteConf(null)} variant="ghost">Cancel</Button>
              <Button onClick={handleDelete} variant="danger">Delete Idea</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
