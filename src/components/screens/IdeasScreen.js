// src/components/screens/IdeasScreen.js
import React, { useState } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { evaluateIdea } from '../../lib/ai';
import { addIdea } from '../../lib/db';
import { EmptyState, Button, Input, Select, Modal } from '../ui';

const IDEA_STATUSES = [
  { value: 'explore', label: 'Explore' },
  { value: 'test',    label: 'Test'    },
  { value: 'active',  label: 'Active'  },
  { value: 'later',   label: 'Later'   },
  { value: 'no',      label: 'No'      },
];

const emptyI = { title: '', notes: '', tags: '', status: 'explore' };

export default function IdeasScreen() {
  const { user } = useAuth();
  const { ideas } = useData();
  const [selected,  setSelected]  = useState(null);
  const [aiScores,  setAiScores]  = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form, setForm] = useState(emptyI);

  const handleEvaluate = async (idea) => {
    setLoadingId(idea.id);
    const result = await evaluateIdea({ ...idea, tags: idea.tags || [] });
    if (result) setAiScores(prev => ({ ...prev, [idea.id]: result }));
    setLoadingId(null);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    await addIdea(user.uid, { ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) });
    setSaving(false);
    setShowModal(false);
    setForm(emptyI);
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
        <Button onClick={() => setShowModal(true)}>+ New Idea</Button>
      </div>

      <div className="fade-up stagger-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
        {ideas.length === 0 ? (
          <EmptyState icon="◇" title="No ideas captured yet" subtitle="Add ideas to evaluate their fit, effort, and timing." action={<Button onClick={() => setShowModal(true)}>+ First Idea</Button>} />
        ) : (
          ideas.map(idea => {
            const isSelected = selected?.id === idea.id;
            const score      = aiScores[idea.id];
            return (
              <div key={idea.id} onClick={() => setSelected(isSelected ? null : idea)}
                style={{ background: isSelected ? 'rgba(200,169,110,0.05)' : tokens.bgCard, border: `1px solid ${isSelected ? 'rgba(200,169,110,0.2)' : tokens.border}`, borderRadius: '12px', padding: '16px 18px', cursor: 'pointer', transition: 'all 0.18s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: tokens.textPrimary, flex: 1, paddingRight: '8px' }}>{idea.title}</div>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: statusColor(idea.status), textTransform: 'uppercase', letterSpacing: '0.06em' }}>{idea.status}</span>
                </div>
                {idea.tags?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                    {idea.tags.map(t => <span key={t} style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, padding: '1px 7px', borderRadius: '4px', fontWeight: 600 }}>{t}</span>)}
                  </div>
                )}
                {idea.notes && <div style={{ fontSize: '12px', color: tokens.textMuted, lineHeight: 1.6, marginBottom: '10px' }}>{idea.notes}</div>}

                {isSelected && (
                  <div style={{ paddingTop: '12px', borderTop: `1px solid ${tokens.border}` }}>
                    {score ? (
                      <div style={{ background: tokens.accentDim, borderRadius: '8px', padding: '12px' }}>
                        <div style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, marginBottom: '8px' }}>✦ AI EVALUATION</div>
                        <div style={{ fontSize: '13px', color: tokens.textPrimary, marginBottom: '6px' }}>{score.verdict}</div>
                        <div style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '8px' }}>Test: {score.tinyTest}</div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <span style={{ fontSize: '10px', color: tokens.blue, background: tokens.blueDim, padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>Fit: {score.fitScore}%</span>
                          <span style={{ fontSize: '10px', color: statusColor(score.timing), background: tokens.accentDim, padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>{score.timing}</span>
                        </div>
                        {score.timingReason && <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '6px' }}>{score.timingReason}</div>}
                      </div>
                    ) : (
                      <Button onClick={(e) => { e.stopPropagation(); handleEvaluate(idea); }} loading={loadingId === idea.id} variant="accent" size="sm" style={{ width: '100%', justifyContent: 'center' }}>
                        ✦ AI Evaluate
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Capture an Idea">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Idea Title" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="AI-powered onboarding SaaS" />
          <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Context, market observation, rough economics..." multiline rows={3} />
          <Input label="Tags (comma separated)" value={form.tags} onChange={v => setForm(f => ({ ...f, tags: v }))} placeholder="SaaS, AI, passive income" />
          <Select label="Status" value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))} options={IDEA_STATUSES} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button onClick={() => setShowModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleSave} loading={saving} disabled={!form.title.trim()}>Save Idea</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
