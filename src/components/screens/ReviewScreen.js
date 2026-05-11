// src/components/screens/ReviewScreen.js
import React, { useState, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { callAI, getWeeklyReviewInsight } from '../../lib/ai';
import { saveWeeklyReview, saveProfile, getProfile } from '../../lib/db';
import { Card, Button, Input, SectionLabel, AICard } from '../ui';

const weekKey = (() => {
  const d     = new Date();
  const start = new Date(d.setDate(d.getDate() - d.getDay()));
  return start.toISOString().split('T')[0];
})();

const todayKey = new Date().toDateString();

// ─── Morning Review ───────────────────────────────────────────────────────────
function MorningReview({ tasks, onSave }) {
  const [step,    setStep]    = useState(0);
  const [answers, setAnswers] = useState({ priorities: '', mustWin: '', mindset: '' });
  const [aiText,  setAiText]  = useState('');
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);

  const steps = [
    { field: 'priorities', label: "What are your top 3 priorities today?",  placeholder: "List them out — be specific" },
    { field: 'mustWin',    label: "What's the single must-win today?",       placeholder: "The one thing that makes today a success" },
    { field: 'mindset',    label: "How are you walking into today?",         placeholder: "Energy, mindset, anything worth noting" },
  ];

  const handleNext = async () => {
    if (step < steps.length - 1) { setStep(s => s + 1); return; }
    setLoading(true);
    const text = await callAI({
      messages: [{ role: 'user', content: `Morning review for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.
Top 3 priorities: ${answers.priorities}
Must-win: ${answers.mustWin}
Mindset: ${answers.mindset}
Pending tasks: ${tasks.filter(t => !t.done).length}
Give me a sharp morning game plan. 3 sentences max. Direct, grounding, no fluff.` }],
      maxTokens: 200,
    });
    setAiText(text || 'Clear priorities set. Execute on your must-win first. Everything else is secondary.');
    setLoading(false);
    setDone(true);
    onSave({ type: 'morning', ...answers, aiGamePlan: text, date: todayKey, displayDate: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) });
  };

  const current = steps[step];

  if (done) return (
    <div className="fade-in">
      <AICard text={aiText} loading={loading} label="TODAY'S GAME PLAN" />
      <div style={{ marginTop: '14px', padding: '14px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px' }}>
        <div style={{ fontSize: '13px', color: tokens.textSecondary, marginBottom: '4px' }}><span style={{ color: tokens.accent }}>Must-win: </span>{answers.mustWin}</div>
        <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted }}>Priorities: </span>{answers.priorities}</div>
      </div>
      <Button onClick={() => { setStep(0); setAnswers({ priorities: '', mustWin: '', mindset: '' }); setDone(false); setAiText(''); }} variant="ghost" style={{ marginTop: '12px' }}>← Redo</Button>
    </div>
  );

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: tokens.textMuted }}>Step {step + 1} of {steps.length}</span>
          <span style={{ fontSize: '11px', color: tokens.accent }}>{Math.round(((step + 1) / steps.length) * 100)}%</span>
        </div>
        <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${((step + 1) / steps.length) * 100}%`, background: tokens.accent, borderRadius: 99, transition: 'width 0.4s ease' }} />
        </div>
      </div>
      <div key={step} className="fade-up">
        <h2 style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.textPrimary, marginBottom: '16px', lineHeight: 1.3 }}>{current.label}</h2>
        <textarea autoFocus value={answers[current.field]} onChange={e => setAnswers(a => ({ ...a, [current.field]: e.target.value }))} placeholder={current.placeholder} rows={4}
          style={{ width: '100%', background: tokens.bgCard, border: `1px solid ${tokens.borderFocus}`, borderRadius: '10px', padding: '14px 16px', color: tokens.textPrimary, fontSize: '14px', lineHeight: 1.7, resize: 'none', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
          {step > 0 ? <Button onClick={() => setStep(s => s - 1)} variant="ghost">← Back</Button> : <div />}
          <Button onClick={handleNext} loading={loading} disabled={!answers[current.field].trim()}>
            {step === steps.length - 1 ? 'Generate Game Plan →' : 'Next →'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── EOD Review ───────────────────────────────────────────────────────────────
function EODReview({ tasks, onSave }) {
  const [step,    setStep]    = useState(0);
  const [answers, setAnswers] = useState({ accomplished: '', unfinished: '', reflection: '' });
  const [aiText,  setAiText]  = useState('');
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);

  const doneTasks = tasks.filter(t => t.done);

  const steps = [
    { field: 'accomplished', label: "What did you accomplish today?",             placeholder: `${doneTasks.length} tasks completed. What else happened?` },
    { field: 'unfinished',   label: "What's unfinished and carries to tomorrow?", placeholder: "What needs to move forward?" },
    { field: 'reflection',   label: "How did today feel?",                        placeholder: "Energy, wins, frustrations..." },
  ];

  const handleNext = async () => {
    if (step < steps.length - 1) { setStep(s => s + 1); return; }
    setLoading(true);
    const text = await callAI({
      messages: [{ role: 'user', content: `End of day review for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.
Accomplished: ${answers.accomplished}
Tasks completed: ${doneTasks.length}
Unfinished: ${answers.unfinished}
Reflection: ${answers.reflection}
Give me a brief honest EOD reflection and one key focus for tomorrow. 3 sentences max.` }],
      maxTokens: 200,
    });
    setAiText(text || 'Solid day. Carry the unfinished items forward with intention. Rest and reset.');
    setLoading(false);
    setDone(true);
    onSave({ type: 'eod', ...answers, aiReflection: text, date: todayKey, displayDate: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }), tasksCompleted: doneTasks.length });
  };

  const current = steps[step];

  if (done) return (
    <div className="fade-in">
      <AICard text={aiText} loading={loading} label="EOD REFLECTION" />
      <div style={{ marginTop: '14px', padding: '14px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.08em' }}>TASKS COMPLETED</div>
          <div style={{ fontFamily: fonts.display, fontSize: '24px', fontWeight: 700, color: tokens.green }}>{doneTasks.length}</div>
        </div>
        {answers.unfinished && <div style={{ marginTop: '10px', fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.amber }}>Carries forward: </span>{answers.unfinished}</div>}
      </div>
      <Button onClick={() => { setStep(0); setAnswers({ accomplished: '', unfinished: '', reflection: '' }); setDone(false); setAiText(''); }} variant="ghost" style={{ marginTop: '12px' }}>← Redo</Button>
    </div>
  );

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: tokens.textMuted }}>Step {step + 1} of {steps.length}</span>
          <span style={{ fontSize: '11px', color: tokens.accent }}>{Math.round(((step + 1) / steps.length) * 100)}%</span>
        </div>
        <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${((step + 1) / steps.length) * 100}%`, background: tokens.accent, borderRadius: 99, transition: 'width 0.4s ease' }} />
        </div>
      </div>
      <div key={step} className="fade-up">
        <h2 style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.textPrimary, marginBottom: '16px', lineHeight: 1.3 }}>{current.label}</h2>
        <textarea autoFocus value={answers[current.field]} onChange={e => setAnswers(a => ({ ...a, [current.field]: e.target.value }))} placeholder={current.placeholder} rows={4}
          style={{ width: '100%', background: tokens.bgCard, border: `1px solid ${tokens.borderFocus}`, borderRadius: '10px', padding: '14px 16px', color: tokens.textPrimary, fontSize: '14px', lineHeight: 1.7, resize: 'none', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
          {step > 0 ? <Button onClick={() => setStep(s => s - 1)} variant="ghost">← Back</Button> : <div />}
          <Button onClick={handleNext} loading={loading} disabled={!answers[current.field].trim()}>
            {step === steps.length - 1 ? 'Generate Reflection →' : 'Next →'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Weekly Review ─────────────────────────────────────────────────────────────
function WeeklyReview({ tasks, projects }) {
  const { user } = useAuth();
  const [form,      setForm]      = useState({ wins: '', bottlenecks: '', energyScore: 65, executionScore: 70, notes: '' });
  const [aiText,    setAiText]    = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [saved,     setSaved]     = useState(false);

  const doneTasks   = tasks.filter(t => t.done);
  const stalledProj = projects.filter(p => p.status === 'stalled');

  const generateInsight = async () => {
    setAiLoading(true);
    const text = await getWeeklyReviewInsight({
      wins:           form.wins.split('\n').filter(Boolean),
      bottlenecks:    form.bottlenecks.split('\n').filter(Boolean),
      energyScore:    form.energyScore,
      executionScore: form.executionScore,
    });
    setAiText(text || 'Solid week. Reflect on what moved and what stalled.');
    setAiLoading(false);
  };

  const handleSave = async () => {
    await saveWeeklyReview(user.uid, weekKey, { ...form, aiInsight: aiText, weekKey, displayDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) });
    setSaved(true);
  };

  return (
    <div>
      {(doneTasks.length > 0 || stalledProj.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
          <Card>
            <SectionLabel>Completed Tasks</SectionLabel>
            {doneTasks.slice(0, 4).map(t => <div key={t.id} style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '5px', display: 'flex', gap: '6px' }}><span style={{ color: tokens.green }}>✓</span>{t.title}</div>)}
            {doneTasks.length > 4 && <div style={{ fontSize: '11px', color: tokens.textMuted }}>+{doneTasks.length - 4} more</div>}
          </Card>
          <Card>
            <SectionLabel>Stalled Projects</SectionLabel>
            {stalledProj.length === 0
              ? <div style={{ fontSize: '12px', color: tokens.green }}>✓ Nothing stalled</div>
              : stalledProj.map(p => <div key={p.id} style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '5px', display: 'flex', gap: '6px' }}><span style={{ color: tokens.red }}>⚑</span>{p.title}</div>)}
          </Card>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
        {[{ label: 'Energy Score', field: 'energyScore', color: tokens.green }, { label: 'Execution Score', field: 'executionScore', color: tokens.blue }].map(item => (
          <Card key={item.field}>
            <SectionLabel>{item.label}</SectionLabel>
            <div style={{ fontFamily: fonts.display, fontSize: '36px', fontWeight: 700, color: item.color, lineHeight: 1, marginBottom: '10px' }}>{form[item.field]}</div>
            <input type="range" min={0} max={100} value={form[item.field]} onChange={e => setForm(f => ({ ...f, [item.field]: Number(e.target.value) }))} style={{ width: '100%', accentColor: item.color }} />
          </Card>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '14px' }}>
        <Input label="Key Wins (one per line)" value={form.wins} onChange={v => setForm(f => ({ ...f, wins: v }))} placeholder="Sent proposal&#10;Ran 4x this week" multiline rows={4} />
        <Input label="Bottlenecks (one per line)" value={form.bottlenecks} onChange={v => setForm(f => ({ ...f, bottlenecks: v }))} placeholder="Contractor still unresolved" multiline rows={3} />
        <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Anything worth capturing..." multiline rows={2} />
      </div>

      {aiText
        ? <div style={{ marginBottom: '14px' }}><AICard text={aiText} loading={aiLoading} onRefresh={generateInsight} label="EXECUTIVE SUMMARY" /></div>
        : <button onClick={generateInsight} disabled={aiLoading}
            style={{ width: '100%', padding: '16px', background: 'transparent', border: `1px dashed rgba(200,169,110,0.3)`, borderRadius: '12px', cursor: 'pointer', color: tokens.accent, fontSize: '14px', fontWeight: 600, fontFamily: fonts.body, marginBottom: '14px' }}
            onMouseEnter={e => e.target.style.background = tokens.accentDim}
            onMouseLeave={e => e.target.style.background = 'transparent'}
          >{aiLoading ? 'Generating...' : '✦ Generate AI Executive Summary'}</button>
      }

      <Button onClick={handleSave} disabled={saved}>{saved ? '✓ Saved' : 'Save Weekly Review'}</Button>
    </div>
  );
}

// ─── History Tab ──────────────────────────────────────────────────────────────
function ReviewHistory() {
  const { user } = useAuth();
  const { weeklyReviews } = useData();
  const [dailyReviews, setDailyReviews] = useState([]);
  const [expanded,     setExpanded]     = useState(null);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const prof = await getProfile(user.uid);
      if (!prof) { setLoading(false); return; }

      // Extract morning and EOD reviews from profile keys
      const reviews = [];
      Object.entries(prof).forEach(([key, val]) => {
        if (key.startsWith('review_morning_') || key.startsWith('review_eod_')) {
          reviews.push({ id: key, ...val });
        }
      });

      // Sort newest first
      reviews.sort((a, b) => new Date(b.date) - new Date(a.date));
      setDailyReviews(reviews);
      setLoading(false);
    };
    load();
  }, [user]);

  const typeLabel = (type) => type === 'morning' ? { label: '☀ Morning', color: tokens.accent } : { label: '🌙 End of Day', color: tokens.blue };

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: tokens.textMuted }}>Loading history...</div>;

  const hasAny = dailyReviews.length > 0 || weeklyReviews.length > 0;

  if (!hasAny) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>◷</div>
      <div style={{ fontFamily: fonts.display, fontSize: '16px', color: tokens.textSecondary, marginBottom: '6px' }}>No reviews yet</div>
      <div style={{ fontSize: '13px', color: tokens.textMuted }}>Complete a morning, EOD, or weekly review and it will appear here.</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

      {/* Daily reviews */}
      {dailyReviews.length > 0 && (
        <>
          <div style={{ fontSize: '11px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>Daily Reviews</div>
          {dailyReviews.map(review => {
            const tl         = typeLabel(review.type);
            const isExpanded = expanded === review.id;
            return (
              <div key={review.id}
                onClick={() => setExpanded(isExpanded ? null : review.id)}
                style={{ background: isExpanded ? 'rgba(200,169,110,0.05)' : tokens.bgCard, border: `1px solid ${isExpanded ? 'rgba(200,169,110,0.2)' : tokens.border}`, borderRadius: '10px', padding: '14px 16px', cursor: 'pointer', transition: 'all 0.18s' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: tl.color, background: `${tl.color}20`, padding: '2px 8px', borderRadius: '4px' }}>{tl.label}</span>
                    <span style={{ fontSize: '13px', color: tokens.textPrimary }}>{review.displayDate || review.date}</span>
                  </div>
                  <span style={{ fontSize: '12px', color: tokens.textMuted }}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${tokens.border}`, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {review.type === 'morning' && (
                      <>
                        {review.mustWin    && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.accent, fontWeight: 600 }}>Must-win: </span>{review.mustWin}</div>}
                        {review.priorities && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted, fontWeight: 600 }}>Priorities: </span>{review.priorities}</div>}
                        {review.mindset    && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted, fontWeight: 600 }}>Mindset: </span>{review.mindset}</div>}
                        {review.aiGamePlan && <div style={{ padding: '12px', background: tokens.accentDim, borderRadius: '8px', fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.6 }}><span style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, display: 'block', marginBottom: '6px' }}>✦ GAME PLAN</span>{review.aiGamePlan}</div>}
                      </>
                    )}
                    {review.type === 'eod' && (
                      <>
                        {review.tasksCompleted !== undefined && <div style={{ fontSize: '13px', color: tokens.green, fontWeight: 600 }}>✓ {review.tasksCompleted} tasks completed</div>}
                        {review.accomplished && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted, fontWeight: 600 }}>Accomplished: </span>{review.accomplished}</div>}
                        {review.unfinished   && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.amber, fontWeight: 600 }}>Carries forward: </span>{review.unfinished}</div>}
                        {review.reflection   && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted, fontWeight: 600 }}>Reflection: </span>{review.reflection}</div>}
                        {review.aiReflection && <div style={{ padding: '12px', background: tokens.blueDim, borderRadius: '8px', fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.6 }}><span style={{ fontSize: '10px', color: tokens.blue, fontWeight: 700, display: 'block', marginBottom: '6px' }}>✦ REFLECTION</span>{review.aiReflection}</div>}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Weekly reviews */}
      {weeklyReviews.length > 0 && (
        <>
          <div style={{ fontSize: '11px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>Weekly Reviews</div>
          {weeklyReviews.map(review => {
            const isExpanded = expanded === review.id;
            return (
              <div key={review.id}
                onClick={() => setExpanded(isExpanded ? null : review.id)}
                style={{ background: isExpanded ? 'rgba(200,169,110,0.05)' : tokens.bgCard, border: `1px solid ${isExpanded ? 'rgba(200,169,110,0.2)' : tokens.border}`, borderRadius: '10px', padding: '14px 16px', cursor: 'pointer', transition: 'all 0.18s' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: tokens.purple, background: tokens.purpleDim, padding: '2px 8px', borderRadius: '4px' }}>◷ Weekly</span>
                    <span style={{ fontSize: '13px', color: tokens.textPrimary }}>Week of {review.displayDate || review.weekKey}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    {review.energyScore    && <span style={{ fontSize: '11px', color: tokens.green }}>Energy {review.energyScore}</span>}
                    {review.executionScore && <span style={{ fontSize: '11px', color: tokens.blue }}>Exec {review.executionScore}</span>}
                    <span style={{ fontSize: '12px', color: tokens.textMuted }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${tokens.border}`, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {review.wins        && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.green, fontWeight: 600 }}>Wins: </span>{review.wins}</div>}
                    {review.bottlenecks && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.red, fontWeight: 600 }}>Bottlenecks: </span>{review.bottlenecks}</div>}
                    {review.notes       && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted, fontWeight: 600 }}>Notes: </span>{review.notes}</div>}
                    {review.aiInsight   && <div style={{ padding: '12px', background: tokens.accentDim, borderRadius: '8px', fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.6 }}><span style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, display: 'block', marginBottom: '6px' }}>✦ AI SUMMARY</span>{review.aiInsight}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── Main Review Screen ───────────────────────────────────────────────────────
export default function ReviewScreen() {
  const { user } = useAuth();
  const { tasks, projects } = useData();
  const [activeTab, setActiveTab] = useState('morning');

  const tabs = [
    { id: 'morning', label: '☀',  sublabel: 'Morning'    },
    { id: 'eod',     label: '🌙', sublabel: 'End of Day' },
    { id: 'weekly',  label: '◷',  sublabel: 'Weekly'     },
    { id: 'history', label: '📋', sublabel: 'History'    },
  ];

  const handleSaveDailyReview = async (data) => {
    if (!user) return;
    const key = `review_${data.type}_${data.date.replace(/ /g, '_')}`;
    await saveProfile(user.uid, { [key]: data });
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="fade-up" style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Review Engine</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Reviews</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>Morning · End of Day · Weekly · History</p>
      </div>

      {/* Tabs */}
      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '8px', marginBottom: '24px', background: tokens.bgCard, padding: '6px', borderRadius: '12px', border: `1px solid ${tokens.border}` }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '10px 6px', borderRadius: '8px', border: 'none', background: activeTab === tab.id ? tokens.accentDim : 'transparent', color: activeTab === tab.id ? tokens.accent : tokens.textSecondary, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
            <span style={{ fontSize: '14px' }}>{tab.label}</span>
            <span style={{ fontSize: '10px', fontWeight: activeTab === tab.id ? 700 : 400 }}>{tab.sublabel}</span>
          </button>
        ))}
      </div>

      <div className="fade-up stagger-2">
        {activeTab === 'morning' && <MorningReview tasks={tasks} onSave={handleSaveDailyReview} />}
        {activeTab === 'eod'     && <EODReview tasks={tasks} onSave={handleSaveDailyReview} />}
        {activeTab === 'weekly'  && <WeeklyReview tasks={tasks} projects={projects} />}
        {activeTab === 'history' && <ReviewHistory />}
      </div>
    </div>
  );
}