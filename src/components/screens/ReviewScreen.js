// src/components/screens/ReviewScreen.js
import React, { useState, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { callAI, getWeeklyReviewInsight } from '../../lib/ai';
import { saveWeeklyReview, saveProfile, getProfile, addTask } from '../../lib/db';
import { Card, Button, Input, SectionLabel, AICard } from '../ui';

const weekKey  = (() => { const d = new Date(); const s = new Date(d.setDate(d.getDate() - d.getDay())); return s.toISOString().split('T')[0]; })();
const todayKey = new Date().toDateString();

// ─── Stats Bar ────────────────────────────────────────────────────────────────
function StatsBar({ tasks, projects, totalDebt }) {
  const today       = new Date().toDateString();
  const doneTodayCount   = tasks.filter(t => { if (!t.done) return false; const d = t.updatedAt?.toDate?.() || new Date(0); return d.toDateString() === today; }).length;
  const addedTodayCount  = tasks.filter(t => { const d = t.createdAt?.toDate?.() || new Date(0); return d.toDateString() === today; }).length;
  const overdueCount     = tasks.filter(t => { if (t.done || !t.dueDate) return false; return new Date(t.dueDate + 'T00:00:00') < new Date(); }).length;
  const activeCount      = projects.filter(p => p.status === 'active').length;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
      {[
        { label: 'Done Today',    val: doneTodayCount,  color: tokens.green  },
        { label: 'Added Today',   val: addedTodayCount, color: tokens.blue   },
        { label: 'Overdue',       val: overdueCount,    color: overdueCount > 0 ? tokens.red : tokens.textMuted },
        { label: 'Active Projects', val: activeCount,   color: tokens.accent },
      ].map(item => (
        <div key={item.label} style={{ padding: '10px 12px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px', textAlign: 'center' }}>
          <div style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color: item.color }}>{item.val}</div>
          <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '2px', lineHeight: 1.3 }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Task Generator from Review ───────────────────────────────────────────────
async function generateTasksFromReview(uid, reviewText, callAIFn, projects) {
  const raw = await callAIFn({
    messages: [{ role: 'user', content: `From this review content, extract clear action items that should become tasks. Return ONLY valid JSON array, no markdown:
[{"title":"task title","priority":"high|medium|low","project":"project name or Inbox"}]
Max 5 tasks. Only include genuinely actionable items.

REVIEW CONTENT:
${reviewText}` }],
    maxTokens: 400,
    systemExtra: `Existing projects: ${projects.map(p => p.title).join(', ') || 'none'}. Return ONLY a JSON array.`,
  });

  try {
    const clean = (raw || '[]').replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return [];
  }
}

// ─── Morning Review ───────────────────────────────────────────────────────────
function MorningReview({ tasks, projects, totalDebt, onSave }) {
  const { user }  = useAuth();
  const [step,    setStep]    = useState(0);
  const [answers, setAnswers] = useState({ priorities: '', mustWin: '', mindset: '' });
  const [aiText,  setAiText]  = useState('');
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [addedTasks,     setAddedTasks]     = useState([]);

  const steps = [
    { field: 'priorities', label: "What are your top 3 priorities today?",  placeholder: "Be specific — what actually needs to move today?" },
    { field: 'mustWin',    label: "What's the one must-win?",               placeholder: "The single thing that makes today a success" },
    { field: 'mindset',    label: "How are you walking into today?",        placeholder: "Energy, mindset, anything worth noting" },
  ];

  const handleNext = async () => {
    if (step < steps.length - 1) { setStep(s => s + 1); return; }
    setLoading(true);
    const reviewText = `Priorities: ${answers.priorities}\nMust-win: ${answers.mustWin}\nMindset: ${answers.mindset}`;
    const [text, suggestedTaskList] = await Promise.all([
      callAI({ messages: [{ role: 'user', content: `Morning review ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.\n${reviewText}\nPending tasks: ${tasks.filter(t => !t.done).length}. Give me a sharp game plan. 3 sentences max.` }], maxTokens: 200 }),
      generateTasksFromReview(user?.uid, reviewText, callAI, projects),
    ]);
    setAiText(text || 'Clear priorities set. Execute your must-win first.');
    setSuggestedTasks(suggestedTaskList);
    setLoading(false);
    setDone(true);
    onSave({ type: 'morning', ...answers, aiGamePlan: text, date: todayKey, displayDate: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) });
  };

  const addSuggestedTask = async (task) => {
    const linkedProject = projects.find(p => p.title.toLowerCase() === task.project?.toLowerCase());
    await addTask(user.uid, { title: task.title, priority: task.priority || 'medium', project: linkedProject?.title || 'Inbox', projectId: linkedProject?.id || null, source: 'review' });
    setAddedTasks(prev => [...prev, task.title]);
  };

  const current = steps[step];

  if (done) return (
    <div className="fade-in">
      <AICard text={aiText} label="TODAY'S GAME PLAN" />
      <div style={{ marginTop: '12px', padding: '14px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px' }}>
        <div style={{ fontSize: '13px', color: tokens.textSecondary, marginBottom: '4px' }}><span style={{ color: tokens.accent }}>Must-win: </span>{answers.mustWin}</div>
        <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted }}>Priorities: </span>{answers.priorities}</div>
      </div>
      {suggestedTasks.length > 0 && (
        <div style={{ marginTop: '12px', padding: '14px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px' }}>
          <div style={{ fontSize: '11px', color: tokens.accent, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '10px' }}>✦ TASKS FROM THIS REVIEW</div>
          {suggestedTasks.map((task, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: i < suggestedTasks.length - 1 ? '8px' : 0 }}>
              <div>
                <div style={{ fontSize: '13px', color: tokens.textPrimary }}>{task.title}</div>
                <div style={{ fontSize: '10px', color: tokens.textMuted }}>{task.project || 'Inbox'} · {task.priority}</div>
              </div>
              {addedTasks.includes(task.title)
                ? <span style={{ fontSize: '11px', color: tokens.green }}>✓ Added</span>
                : <button onClick={() => addSuggestedTask(task)} style={{ fontSize: '11px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '4px', padding: '3px 10px', cursor: 'pointer', fontFamily: fonts.body }}>+ Add</button>
              }
            </div>
          ))}
        </div>
      )}
      <Button onClick={() => { setStep(0); setAnswers({ priorities: '', mustWin: '', mindset: '' }); setDone(false); setAiText(''); setSuggestedTasks([]); setAddedTasks([]); }} variant="ghost" style={{ marginTop: '12px' }}>← Redo</Button>
    </div>
  );

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: tokens.textMuted }}>Step {step + 1} of {steps.length}</span>
          <span style={{ fontSize: '11px', color: tokens.accent }}>{Math.round(((step + 1) / steps.length) * 100)}%</span>
        </div>
        <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${((step + 1) / steps.length) * 100}%`, background: tokens.accent, borderRadius: 99, transition: 'width 0.4s ease' }} />
        </div>
      </div>
      <div key={step} className="fade-up">
        <h2 style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.textPrimary, marginBottom: '14px', lineHeight: 1.3 }}>{current.label}</h2>
        <textarea autoFocus value={answers[current.field]} onChange={e => setAnswers(a => ({ ...a, [current.field]: e.target.value }))} placeholder={current.placeholder} rows={4}
          style={{ width: '100%', background: tokens.bgCard, border: `1px solid ${tokens.borderFocus}`, borderRadius: '10px', padding: '14px 16px', color: tokens.textPrimary, fontSize: '14px', lineHeight: 1.7, resize: 'none', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' }}>
          {step > 0 ? <Button onClick={() => setStep(s => s - 1)} variant="ghost">← Back</Button> : <div />}
          <Button onClick={handleNext} loading={loading} disabled={!answers[current.field].trim()}>{step === steps.length - 1 ? 'Generate Game Plan →' : 'Next →'}</Button>
        </div>
      </div>
    </div>
  );
}

// ─── EOD Review ───────────────────────────────────────────────────────────────
function EODReview({ tasks, projects, onSave }) {
  const { user }  = useAuth();
  const [step,    setStep]    = useState(0);
  const [answers, setAnswers] = useState({ accomplished: '', unfinished: '', reflection: '' });
  const [aiText,  setAiText]  = useState('');
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [addedTasks,     setAddedTasks]     = useState([]);

  const doneTasks  = tasks.filter(t => { if (!t.done) return false; const d = t.updatedAt?.toDate?.() || new Date(0); return d.toDateString() === new Date().toDateString(); });
  const overdueTasks = tasks.filter(t => { if (t.done || !t.dueDate) return false; return new Date(t.dueDate + 'T00:00:00') < new Date(); });

  const steps = [
    { field: 'accomplished', label: "What did you accomplish today?",             placeholder: `${doneTasks.length} tasks completed. What else happened worth noting?` },
    { field: 'unfinished',   label: "What's unfinished and carries to tomorrow?", placeholder: "What needs to move forward?" },
    { field: 'reflection',   label: "How did today feel?",                        placeholder: "Energy, wins, frustrations, anything worth noting..." },
  ];

  const handleNext = async () => {
    if (step < steps.length - 1) { setStep(s => s + 1); return; }
    setLoading(true);
    const reviewText = `Accomplished: ${answers.accomplished}\nUnfinished: ${answers.unfinished}\nReflection: ${answers.reflection}`;
    const [text, suggestedTaskList] = await Promise.all([
      callAI({ messages: [{ role: 'user', content: `EOD review ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.\n${reviewText}\nCompleted today: ${doneTasks.length} tasks. Overdue: ${overdueTasks.length}. Brief honest reflection and one focus for tomorrow. 3 sentences max.` }], maxTokens: 200 }),
      generateTasksFromReview(user?.uid, reviewText, callAI, projects),
    ]);
    setAiText(text || 'Solid day. Carry unfinished items forward with intention.');
    setSuggestedTasks(suggestedTaskList);
    setLoading(false);
    setDone(true);
    onSave({ type: 'eod', ...answers, aiReflection: text, date: todayKey, displayDate: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }), tasksCompleted: doneTasks.length, tasksOverdue: overdueTasks.length });
  };

  const addSuggestedTask = async (task) => {
    const linkedProject = projects.find(p => p.title.toLowerCase() === task.project?.toLowerCase());
    await addTask(user.uid, { title: task.title, priority: task.priority || 'medium', project: linkedProject?.title || 'Inbox', projectId: linkedProject?.id || null, source: 'review' });
    setAddedTasks(prev => [...prev, task.title]);
  };

  const current = steps[step];

  if (done) return (
    <div className="fade-in">
      <AICard text={aiText} label="EOD REFLECTION" />
      <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div style={{ padding: '12px', background: tokens.greenDim, borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: tokens.green }}>{doneTasks.length}</div>
          <div style={{ fontSize: '11px', color: tokens.textMuted }}>Completed Today</div>
        </div>
        <div style={{ padding: '12px', background: overdueTasks.length > 0 ? tokens.redDim : tokens.greenDim, borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontFamily: fonts.display, fontSize: '28px', fontWeight: 700, color: overdueTasks.length > 0 ? tokens.red : tokens.green }}>{overdueTasks.length}</div>
          <div style={{ fontSize: '11px', color: tokens.textMuted }}>Overdue</div>
        </div>
      </div>
      {answers.unfinished && <div style={{ marginTop: '10px', padding: '10px 14px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '8px', fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.amber }}>Carries forward: </span>{answers.unfinished}</div>}
      {suggestedTasks.length > 0 && (
        <div style={{ marginTop: '12px', padding: '14px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px' }}>
          <div style={{ fontSize: '11px', color: tokens.accent, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '10px' }}>✦ TASKS FROM THIS REVIEW</div>
          {suggestedTasks.map((task, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: i < suggestedTasks.length - 1 ? '8px' : 0 }}>
              <div>
                <div style={{ fontSize: '13px', color: tokens.textPrimary }}>{task.title}</div>
                <div style={{ fontSize: '10px', color: tokens.textMuted }}>{task.project || 'Inbox'} · {task.priority}</div>
              </div>
              {addedTasks.includes(task.title)
                ? <span style={{ fontSize: '11px', color: tokens.green }}>✓ Added</span>
                : <button onClick={() => addSuggestedTask(task)} style={{ fontSize: '11px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '4px', padding: '3px 10px', cursor: 'pointer', fontFamily: fonts.body }}>+ Add</button>
              }
            </div>
          ))}
        </div>
      )}
      <Button onClick={() => { setStep(0); setAnswers({ accomplished: '', unfinished: '', reflection: '' }); setDone(false); setAiText(''); setSuggestedTasks([]); setAddedTasks([]); }} variant="ghost" style={{ marginTop: '12px' }}>← Redo</Button>
    </div>
  );

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: tokens.textMuted }}>Step {step + 1} of {steps.length}</span>
          <span style={{ fontSize: '11px', color: tokens.accent }}>{Math.round(((step + 1) / steps.length) * 100)}%</span>
        </div>
        <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${((step + 1) / steps.length) * 100}%`, background: tokens.accent, borderRadius: 99, transition: 'width 0.4s ease' }} />
        </div>
      </div>
      {/* Quick stats before answering */}
      {step === 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <div style={{ padding: '8px 12px', background: tokens.greenDim, borderRadius: '8px', fontSize: '12px', color: tokens.green }}>✓ {doneTasks.length} completed today</div>
          {overdueTasks.length > 0 && <div style={{ padding: '8px 12px', background: tokens.redDim, borderRadius: '8px', fontSize: '12px', color: tokens.red }}>⚑ {overdueTasks.length} overdue</div>}
        </div>
      )}
      <div key={step} className="fade-up">
        <h2 style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: tokens.textPrimary, marginBottom: '14px', lineHeight: 1.3 }}>{current.label}</h2>
        <textarea autoFocus value={answers[current.field]} onChange={e => setAnswers(a => ({ ...a, [current.field]: e.target.value }))} placeholder={current.placeholder} rows={4}
          style={{ width: '100%', background: tokens.bgCard, border: `1px solid ${tokens.borderFocus}`, borderRadius: '10px', padding: '14px 16px', color: tokens.textPrimary, fontSize: '14px', lineHeight: 1.7, resize: 'none', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' }}>
          {step > 0 ? <Button onClick={() => setStep(s => s - 1)} variant="ghost">← Back</Button> : <div />}
          <Button onClick={handleNext} loading={loading} disabled={!answers[current.field].trim()}>{step === steps.length - 1 ? 'Generate Reflection →' : 'Next →'}</Button>
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
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [addedTasks,     setAddedTasks]     = useState([]);

  const doneTasks   = tasks.filter(t => t.done);
  const stalledProj = projects.filter(p => p.status === 'stalled');

  const generateInsight = async () => {
    setAiLoading(true);
    const reviewText = `Wins: ${form.wins}\nBottlenecks: ${form.bottlenecks}\nNotes: ${form.notes}`;
    const [text, suggestedTaskList] = await Promise.all([
      getWeeklyReviewInsight({ wins: form.wins.split('\n').filter(Boolean), bottlenecks: form.bottlenecks.split('\n').filter(Boolean), energyScore: form.energyScore, executionScore: form.executionScore }),
      generateTasksFromReview(user?.uid, reviewText, callAI, projects),
    ]);
    setAiText(text || 'Solid data for the week.');
    setSuggestedTasks(suggestedTaskList);
    setAiLoading(false);
  };

  const addSuggestedTask = async (task) => {
    const linkedProject = projects.find(p => p.title.toLowerCase() === task.project?.toLowerCase());
    await addTask(user.uid, { title: task.title, priority: task.priority || 'medium', project: linkedProject?.title || 'Inbox', projectId: linkedProject?.id || null, source: 'review' });
    setAddedTasks(prev => [...prev, task.title]);
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
            {stalledProj.length === 0 ? <div style={{ fontSize: '12px', color: tokens.green }}>✓ Nothing stalled</div> : stalledProj.map(p => <div key={p.id} style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '5px', display: 'flex', gap: '6px' }}><span style={{ color: tokens.red }}>⚑</span>{p.title}</div>)}
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
        <Input label="Bottlenecks (one per line)" value={form.bottlenecks} onChange={v => setForm(f => ({ ...f, bottlenecks: v }))} placeholder="Contractor unresolved" multiline rows={3} />
        <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Anything worth capturing..." multiline rows={2} />
      </div>
      {aiText ? (
        <div style={{ marginBottom: '14px' }}>
          <AICard text={aiText} loading={aiLoading} onRefresh={generateInsight} label="EXECUTIVE SUMMARY" />
          {suggestedTasks.length > 0 && (
            <div style={{ marginTop: '12px', padding: '14px 16px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '10px' }}>
              <div style={{ fontSize: '11px', color: tokens.accent, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '10px' }}>✦ TASKS FROM THIS REVIEW</div>
              {suggestedTasks.map((task, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: i < suggestedTasks.length - 1 ? '8px' : 0 }}>
                  <div>
                    <div style={{ fontSize: '13px', color: tokens.textPrimary }}>{task.title}</div>
                    <div style={{ fontSize: '10px', color: tokens.textMuted }}>{task.project || 'Inbox'} · {task.priority}</div>
                  </div>
                  {addedTasks.includes(task.title)
                    ? <span style={{ fontSize: '11px', color: tokens.green }}>✓ Added</span>
                    : <button onClick={() => addSuggestedTask(task)} style={{ fontSize: '11px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '4px', padding: '3px 10px', cursor: 'pointer', fontFamily: fonts.body }}>+ Add</button>
                  }
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button onClick={generateInsight} disabled={aiLoading}
          style={{ width: '100%', padding: '16px', background: 'transparent', border: `1px dashed rgba(200,169,110,0.3)`, borderRadius: '12px', cursor: 'pointer', color: tokens.accent, fontSize: '14px', fontWeight: 600, fontFamily: fonts.body, marginBottom: '14px' }}
          onMouseEnter={e => e.target.style.background = tokens.accentDim}
          onMouseLeave={e => e.target.style.background = 'transparent'}
        >{aiLoading ? 'Generating...' : '✦ Generate AI Executive Summary'}</button>
      )}
      <Button onClick={handleSave} disabled={saved}>{saved ? '✓ Saved' : 'Save Weekly Review'}</Button>
    </div>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────
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
      const reviews = [];
      Object.entries(prof).forEach(([key, val]) => {
        if (key.startsWith('review_morning_') || key.startsWith('review_eod_')) reviews.push({ id: key, ...val });
      });
      reviews.sort((a, b) => new Date(b.date) - new Date(a.date));
      setDailyReviews(reviews);
      setLoading(false);
    };
    load();
  }, [user]);

  const typeLabel = (type) => type === 'morning' ? { label: '☀ Morning', color: tokens.accent } : { label: '🌙 End of Day', color: tokens.blue };

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: tokens.textMuted }}>Loading...</div>;

  const hasAny = dailyReviews.length > 0 || weeklyReviews.length > 0;
  if (!hasAny) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>◷</div>
      <div style={{ fontFamily: fonts.display, fontSize: '16px', color: tokens.textSecondary, marginBottom: '6px' }}>No reviews yet</div>
      <div style={{ fontSize: '13px', color: tokens.textMuted }}>Complete a morning, EOD, or weekly review to see history here.</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {dailyReviews.length > 0 && (
        <>
          <div style={{ fontSize: '11px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>Daily Reviews</div>
          {dailyReviews.map(review => {
            const tl = typeLabel(review.type);
            const isExpanded = expanded === review.id;
            return (
              <div key={review.id} onClick={() => setExpanded(isExpanded ? null : review.id)}
                style={{ background: isExpanded ? 'rgba(200,169,110,0.05)' : tokens.bgCard, border: `1px solid ${isExpanded ? 'rgba(200,169,110,0.2)' : tokens.border}`, borderRadius: '10px', padding: '14px 16px', cursor: 'pointer', transition: 'all 0.18s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: tl.color, background: `${tl.color}20`, padding: '2px 8px', borderRadius: '4px' }}>{tl.label}</span>
                    <span style={{ fontSize: '13px', color: tokens.textPrimary }}>{review.displayDate || review.date}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {review.tasksCompleted !== undefined && <span style={{ fontSize: '11px', color: tokens.green }}>✓ {review.tasksCompleted}</span>}
                    <span style={{ fontSize: '12px', color: tokens.textMuted }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${tokens.border}`, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {review.type === 'morning' && (<>
                      {review.mustWin    && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.accent, fontWeight: 600 }}>Must-win: </span>{review.mustWin}</div>}
                      {review.priorities && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted, fontWeight: 600 }}>Priorities: </span>{review.priorities}</div>}
                      {review.mindset    && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted, fontWeight: 600 }}>Mindset: </span>{review.mindset}</div>}
                      {review.aiGamePlan && <div style={{ padding: '10px 12px', background: tokens.accentDim, borderRadius: '8px', fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.6 }}><span style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, display: 'block', marginBottom: '4px' }}>✦ GAME PLAN</span>{review.aiGamePlan}</div>}
                    </>)}
                    {review.type === 'eod' && (<>
                      {review.tasksCompleted !== undefined && <div style={{ fontSize: '13px', color: tokens.green, fontWeight: 600 }}>✓ {review.tasksCompleted} tasks completed · {review.tasksOverdue || 0} overdue</div>}
                      {review.accomplished && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted, fontWeight: 600 }}>Accomplished: </span>{review.accomplished}</div>}
                      {review.unfinished   && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.amber, fontWeight: 600 }}>Carries forward: </span>{review.unfinished}</div>}
                      {review.aiReflection && <div style={{ padding: '10px 12px', background: tokens.blueDim, borderRadius: '8px', fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.6 }}><span style={{ fontSize: '10px', color: tokens.blue, fontWeight: 700, display: 'block', marginBottom: '4px' }}>✦ REFLECTION</span>{review.aiReflection}</div>}
                    </>)}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {weeklyReviews.length > 0 && (
        <>
          <div style={{ fontSize: '11px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>Weekly Reviews</div>
          {weeklyReviews.map(review => {
            const isExpanded = expanded === review.id;
            return (
              <div key={review.id} onClick={() => setExpanded(isExpanded ? null : review.id)}
                style={{ background: isExpanded ? 'rgba(200,169,110,0.05)' : tokens.bgCard, border: `1px solid ${isExpanded ? 'rgba(200,169,110,0.2)' : tokens.border}`, borderRadius: '10px', padding: '14px 16px', cursor: 'pointer', transition: 'all 0.18s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: tokens.purple, background: tokens.purpleDim, padding: '2px 8px', borderRadius: '4px' }}>◷ Weekly</span>
                    <span style={{ fontSize: '13px', color: tokens.textPrimary }}>Week of {review.displayDate || review.weekKey}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {review.energyScore    && <span style={{ fontSize: '11px', color: tokens.green }}>⚡{review.energyScore}</span>}
                    {review.executionScore && <span style={{ fontSize: '11px', color: tokens.blue }}>◈{review.executionScore}</span>}
                    <span style={{ fontSize: '12px', color: tokens.textMuted }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${tokens.border}`, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {review.wins        && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.green, fontWeight: 600 }}>Wins: </span>{review.wins}</div>}
                    {review.bottlenecks && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.red, fontWeight: 600 }}>Bottlenecks: </span>{review.bottlenecks}</div>}
                    {review.notes       && <div style={{ fontSize: '13px', color: tokens.textSecondary }}><span style={{ color: tokens.textMuted, fontWeight: 600 }}>Notes: </span>{review.notes}</div>}
                    {review.aiInsight   && <div style={{ padding: '10px 12px', background: tokens.accentDim, borderRadius: '8px', fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.6 }}><span style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, display: 'block', marginBottom: '4px' }}>✦ AI SUMMARY</span>{review.aiInsight}</div>}
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

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ReviewScreen() {
  const { user } = useAuth();
  const { tasks, projects, totalDebt } = useData();
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
      <div className="fade-up" style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Review Engine</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Reviews</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>Morning · End of Day · Weekly · History</p>
      </div>

      {/* Live stats bar */}
      <div className="fade-up stagger-1">
        <StatsBar tasks={tasks} projects={projects} totalDebt={totalDebt} />
      </div>

      {/* Tabs */}
      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', marginBottom: '20px', background: tokens.bgCard, padding: '6px', borderRadius: '12px', border: `1px solid ${tokens.border}` }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '10px 6px', borderRadius: '8px', border: 'none', background: activeTab === tab.id ? tokens.accentDim : 'transparent', color: activeTab === tab.id ? tokens.accent : tokens.textSecondary, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
            <span style={{ fontSize: '14px' }}>{tab.label}</span>
            <span style={{ fontSize: '10px', fontWeight: activeTab === tab.id ? 700 : 400 }}>{tab.sublabel}</span>
          </button>
        ))}
      </div>

      <div className="fade-up stagger-2">
        {activeTab === 'morning' && <MorningReview tasks={tasks} projects={projects} totalDebt={totalDebt} onSave={handleSaveDailyReview} />}
        {activeTab === 'eod'     && <EODReview tasks={tasks} projects={projects} onSave={handleSaveDailyReview} />}
        {activeTab === 'weekly'  && <WeeklyReview tasks={tasks} projects={projects} />}
        {activeTab === 'history' && <ReviewHistory />}
      </div>
    </div>
  );
}
