// src/components/screens/BrainDumpScreen.js
import React, { useState, useRef, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { callAI } from '../../lib/ai';
import { saveBrainDump, addTask, addProject, updateTask } from '../../lib/db';
import { getValidAccessToken, getEvents, getFreeSlots, createEvent, formatEventTime } from '../../lib/calendar';
import { Card, Button, SectionLabel, Tag, AICard } from '../ui';

// ─── Focus type badge ─────────────────────────────────────────────────────────

const focusStyles = {
  deep:   { bg: tokens.blueDim,   text: tokens.blue   },
  medium: { bg: tokens.amberDim,  text: tokens.amber  },
  quick:  { bg: tokens.greenDim,  text: tokens.green  },
};

// ─── Schedule block row ───────────────────────────────────────────────────────

function ScheduleBlock({ block, removed, onToggle }) {
  const fc = focusStyles[block.focusType] || focusStyles.medium;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '12px',
      padding: '12px 14px', marginBottom: '6px',
      background: removed ? tokens.bgGlass : tokens.bgCard,
      border: `1px solid ${removed ? 'rgba(255,255,255,0.04)' : tokens.border}`,
      borderRadius: tokens.radiusMd, opacity: removed ? 0.38 : 1,
      transition: 'all 0.15s',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '3px' }}>
          {formatEventTime(block.start)} – {formatEventTime(block.end)} · {block.durationMinutes}m
        </div>
        <div style={{
          fontSize: '14px', fontWeight: 600, color: tokens.textPrimary, lineHeight: 1.35,
          textDecoration: removed ? 'line-through' : 'none',
        }}>
          {block.taskTitle}
        </div>
        {block.reason && (
          <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '3px', lineHeight: 1.4 }}>
            {block.reason}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, paddingTop: '2px' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: fc.text, background: fc.bg, padding: '2px 8px', borderRadius: '4px', letterSpacing: '0.04em' }}>
          {block.focusType}
        </span>
        <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: removed ? tokens.green : tokens.red, opacity: 0.7, padding: '0 2px', fontFamily: fonts.body, lineHeight: 1 }}>
          {removed ? '+' : '✕'}
        </button>
      </div>
    </div>
  );
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({ brainDumps }) {
  const [expanded, setExpanded] = useState(null);

  if (brainDumps.length === 0) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>◎</div>
      <div style={{ fontFamily: fonts.display, fontSize: '16px', color: tokens.textSecondary, marginBottom: '6px' }}>No brain dumps yet</div>
      <div style={{ fontSize: '13px', color: tokens.textMuted }}>Do your first brain dump and it will appear here.</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {brainDumps.map(dump => {
        const isExpanded  = expanded === dump.id;
        const date        = dump.createdAt?.toDate?.() || new Date();
        const dateStr     = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const summary     = dump.result?.summary || dump.result?.mostUrgent || 'Brain dump captured';
        const actionCount = dump.result?.actionItems?.length || 0;
        const categories  = Object.entries(dump.result?.categories || {}).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([k]) => k);

        return (
          <div key={dump.id}
            onClick={() => setExpanded(isExpanded ? null : dump.id)}
            style={{ background: isExpanded ? 'rgba(200,169,110,0.05)' : tokens.bgCard, border: `1px solid ${isExpanded ? 'rgba(200,169,110,0.2)' : tokens.border}`, borderRadius: '10px', padding: '14px 16px', cursor: 'pointer', transition: 'all 0.18s' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, paddingRight: '10px' }}>
                <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '4px' }}>{dateStr}</div>
                <div style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.5 }}>{summary}</div>
                {categories.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                    {categories.slice(0, 4).map(cat => (
                      <span key={cat} style={{ fontSize: '10px', color: tokens.textMuted, background: 'rgba(255,255,255,0.06)', padding: '1px 7px', borderRadius: '4px' }}>{cat}</span>
                    ))}
                    {actionCount > 0 && <span style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, padding: '1px 7px', borderRadius: '4px' }}>{actionCount} actions</span>}
                  </div>
                )}
              </div>
              <span style={{ fontSize: '12px', color: tokens.textMuted, flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
            </div>

            {isExpanded && (
              <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${tokens.border}` }}>
                {dump.rawText && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>RAW DUMP</div>
                    <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: tokens.bgGlass, padding: '10px 12px', borderRadius: '8px' }}>{dump.rawText}</div>
                  </div>
                )}
                {dump.result?.actionItems?.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '10px', color: tokens.accent, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>ACTION ITEMS</div>
                    {dump.result.actionItems.map((item, i) => (
                      <div key={i} style={{ fontSize: '13px', color: tokens.textPrimary, marginBottom: '4px', display: 'flex', gap: '6px' }}>
                        <span style={{ color: tokens.accent }}>→</span>{item}
                      </div>
                    ))}
                  </div>
                )}
                {Object.entries(dump.result?.categories || {}).filter(([, v]) => Array.isArray(v) && v.length > 0).length > 0 && (
                  <div>
                    <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>CATEGORIZED</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
                      {Object.entries(dump.result.categories).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([cat, items]) => (
                        <div key={cat} style={{ padding: '10px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.textMuted, marginBottom: '6px' }}>{cat.toUpperCase()}</div>
                          {items.map((item, i) => <div key={i} style={{ fontSize: '11px', color: tokens.textSecondary, marginBottom: '3px' }}>· {item}</div>)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Category priority weights for sorting ────────────────────────────────────
const CAT_WEIGHT = { Work: 8, Money: 8, Health: 6, Family: 5, Home: 4, Ideas: 3, Emotional: 2, Later: 1 };

// ─── Main component ───────────────────────────────────────────────────────────

export default function BrainDumpScreen() {
  const { user }                                    = useAuth();
  const { projects, brainDumps, weeklyReviews, calendarIntegration } = useData();

  // Dump state
  const [activeTab,   setActiveTab]   = useState('dump');
  const [text,        setText]        = useState('');
  const [processing,  setProcessing]  = useState(false);
  const [result,      setResult]      = useState(null);
  const [recording,   setRecording]   = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [tasksSent,   setTasksSent]   = useState([]);
  const [created,     setCreated]     = useState({ projects: [], tasks: [] });
  const [createdTaskRefs, setCreatedTaskRefs] = useState([]); // [{ title, id, priority, estimatedMinutes }]

  // Schedule state
  const [scheduling,        setScheduling]        = useState(false);
  const [schedule,          setSchedule]          = useState(null);   // null = not built yet, [] = no slots found
  const [scheduleError,     setScheduleError]     = useState('');
  const [removedItems,      setRemovedItems]      = useState(new Set());
  const [confirming,        setConfirming]        = useState(false);
  const [scheduleConfirmed, setScheduleConfirmed] = useState(false);
  const [confirmedCount,    setConfirmedCount]    = useState(0);
  const [scheduleDates,     setScheduleDates]     = useState({ today: '', tomorrow: '' });

  const recognitionRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const r          = new SR();
      r.continuous     = true;
      r.interimResults = true;
      r.lang           = 'en-US';
      r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; setText(t); };
      r.onend = () => setRecording(false);
      recognitionRef.current = r;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) { alert('Voice input not supported. Try Chrome.'); return; }
    if (recording) { recognitionRef.current.stop(); setRecording(false); }
    else           { setText(''); recognitionRef.current.start(); setRecording(true); }
  };

  // ─── Process brain dump ────────────────────────────────────────────────────

  const handleProcess = async () => {
    if (!text.trim()) return;
    setProcessing(true);
    setResult(null);

    const existingProjectNames = projects.map(p => p.title).join(', ');
    const raw = await callAI({
      messages: [{ role: 'user', content: `Process this brain dump. Existing projects: ${existingProjectNames || 'none'}.
Return ONLY valid JSON, no markdown:
{
  "summary": "2-3 sentence sharp summary",
  "mostUrgent": "single most important item or null",
  "categories": { "Work": [], "Money": [], "Family": [], "Health": [], "Home": [], "Ideas": [], "Emotional": [], "Later": [] },
  "actionItems": ["item1"],
  "emotionalThemes": ["theme1"],
  "urgentFlags": ["item1"],
  "newProjects": [{"title":"name","category":"work|home|finance|health|creative|personal|business","nextAction":"first action","notes":"brief context"}],
  "tasksToCreate": [{"title":"task","priority":"critical|high|medium|low","projectName":"project name or null","estimatedMinutes":30}]
}
Only include newProjects if user explicitly mentioned creating one. Only tasksToCreate for clear actionable items.
estimatedMinutes: realistic time to complete the task (15=quick call/email, 30=short task, 60=focused work, 90-120=deep complex work).
BRAIN DUMP:\n${text}` }],
      maxTokens: 1000,
      systemExtra: 'Return ONLY valid JSON. No markdown fences.',
    });

    let parsed = null;
    try { const clean = (raw || '{}').replace(/```json|```/g, '').trim(); parsed = JSON.parse(clean); }
    catch { parsed = { summary: 'Your thoughts have been captured.', mostUrgent: null, categories: {}, actionItems: [], emotionalThemes: [], urgentFlags: [], newProjects: [], tasksToCreate: [] }; }

    // Auto-create projects
    const createdProjects = [];
    if (parsed.newProjects?.length > 0) {
      for (const proj of parsed.newProjects) {
        if (!proj.title) continue;
        const exists = projects.some(p => p.title.toLowerCase() === proj.title.toLowerCase());
        if (!exists) {
          const ref = await addProject(user.uid, { title: proj.title, category: proj.category || 'personal', status: 'active', momentum: 30, nextAction: proj.nextAction || '', notes: proj.notes || 'Created from brain dump', blockers: '', sentiment: 'new' });
          createdProjects.push({ ...proj, id: ref?.id });
        }
      }
    }

    // Auto-create tasks — track IDs for scheduling
    const createdTaskTitles = [];
    const taskRefs = [];
    if (parsed.tasksToCreate?.length > 0) {
      const allProjects = [...projects, ...createdProjects];
      for (const task of parsed.tasksToCreate) {
        if (!task.title) continue;
        const matched = task.projectName ? allProjects.find(p => p.title.toLowerCase().includes(task.projectName.toLowerCase())) : null;
        const ref = await addTask(user.uid, { title: task.title, priority: task.priority || 'medium', project: matched?.title || 'Inbox', projectId: matched?.id || null, source: 'brain-dump', energy: 'medium' });
        createdTaskTitles.push(task.title);
        taskRefs.push({ title: task.title, id: ref?.id || null, priority: task.priority || 'medium', estimatedMinutes: task.estimatedMinutes || 30 });
      }
    }

    setCreatedTaskRefs(taskRefs);
    setCreated({ projects: createdProjects.map(p => p.title), tasks: createdTaskTitles });
    setResult(parsed);
    await saveBrainDump(user.uid, { rawText: text, result: parsed });
    setSaved(true);
    setProcessing(false);
  };

  // ─── Build schedule ────────────────────────────────────────────────────────

  const handleBuildSchedule = async () => {
    if (scheduling) return;
    setScheduling(true);
    setScheduleError('');
    setSchedule(null);
    setRemovedItems(new Set());

    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      if (!token) { setScheduleError('Calendar not connected. Connect it on the Life OS screen first.'); return; }

      const todayDate    = new Date();
      const tomorrowDate = new Date(todayDate.getTime() + 86400000);
      todayDate.setSeconds(0, 0);

      const windowStart = new Date(todayDate); windowStart.setHours(0, 0, 0, 0);
      const windowEnd   = new Date(tomorrowDate); windowEnd.setHours(23, 59, 59, 999);

      const { events = [] } = await getEvents(token, windowStart.toISOString(), windowEnd.toISOString());

      const todaySlots    = getFreeSlots(events, todayDate);
      const tomorrowSlots = getFreeSlots(events, tomorrowDate);

      if (!todaySlots.length && !tomorrowSlots.length) {
        setScheduleError('No free time slots found today or tomorrow. Your calendar looks packed.');
        return;
      }

      // Focus profile from recent weekly reviews
      const recentReviews = weeklyReviews.slice(0, 4);
      const recentEnergy  = recentReviews.length
        ? Math.round(recentReviews.reduce((s, r) => s + (r.energyScore || 60), 0) / recentReviews.length)
        : 65;

      // Build task list: auto-created tasks first (by priority), then unscheduled action items
      const urgentSet = new Set(result?.urgentFlags || []);
      const tasks = [
        ...createdTaskRefs.map(t => ({ title: t.title, taskId: t.id, priority: t.priority, estimatedMinutes: t.estimatedMinutes })),
        ...(result?.actionItems || [])
          .filter(item => !createdTaskRefs.some(t => t.title === item))
          .map(item => ({
            title:              item,
            taskId:             null,
            priority:           urgentSet.has(item) ? 'high' : 'medium',
            estimatedMinutes:   30,
          })),
      ].sort((a, b) => {
        const rank = { critical: 0, high: 1, medium: 2, low: 3 };
        return (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2);
      });

      const todayLabel    = todayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const tomorrowLabel = tomorrowDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

      const res = await fetch('/api/schedule/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks, slots: { today: todaySlots, tomorrow: tomorrowSlots }, focusProfile: { recentEnergy }, today: todayLabel, tomorrow: tomorrowLabel }),
      });

      const data = await res.json();
      if (data.error) { setScheduleError('Schedule build failed. Try again.'); return; }

      setSchedule(data.schedule || []);
      setScheduleDates({ today: todayLabel, tomorrow: tomorrowLabel });
    } catch (err) {
      console.error('Build schedule error:', err);
      setScheduleError('Something went wrong building your schedule.');
    } finally {
      setScheduling(false);
    }
  };

  // ─── Confirm schedule ──────────────────────────────────────────────────────

  const handleConfirmSchedule = async () => {
    if (confirming) return;
    const active = (schedule || []).filter((_, i) => !removedItems.has(i));
    if (!active.length) return;

    setConfirming(true);
    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone;

      await Promise.all(active.map(async (block) => {
        await createEvent(token, {
          summary:     block.taskTitle,
          description: `Anchor brain dump schedule · ${block.focusType} focus`,
          start:       { dateTime: block.start, timeZone: tz },
          end:         { dateTime: block.end,   timeZone: tz },
        });

        if (block.taskId) {
          await updateTask(user.uid, block.taskId, { status: 'scheduled', scheduledStart: block.start, scheduledEnd: block.end });
        } else {
          await addTask(user.uid, { title: block.taskTitle, priority: block.priority || 'medium', source: 'brain-dump', status: 'scheduled', scheduledStart: block.start, scheduledEnd: block.end });
        }
      }));

      setConfirmedCount(active.length);
      setScheduleConfirmed(true);
    } catch (err) {
      console.error('Confirm schedule error:', err);
    } finally {
      setConfirming(false);
    }
  };

  // ─── Misc handlers ─────────────────────────────────────────────────────────

  const sendTaskToInbox = async (taskText) => {
    await addTask(user.uid, { title: taskText, priority: 'medium', project: 'Inbox', energy: 'medium', source: 'brain-dump' });
    setTasksSent(prev => [...prev, taskText]);
  };

  const reset = () => {
    setText(''); setResult(null); setSaved(false); setTasksSent([]);
    setCreated({ projects: [], tasks: [] }); setCreatedTaskRefs([]);
    setSchedule(null); setScheduleError(''); setRemovedItems(new Set());
    setScheduleConfirmed(false); setConfirmedCount(0); setScheduleDates({ today: '', tomorrow: '' });
  };

  const toggleRemove = (index) => {
    setRemovedItems(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  // ─── Derived display data ──────────────────────────────────────────────────

  const tips     = ['What\'s stressing me', 'What I\'m avoiding', 'Tasks I need to do', 'New project ideas', 'Money worries', 'What\'s unresolved'];
  const catColors = { Work: { bg: tokens.blueDim, text: tokens.blue }, Money: { bg: tokens.redDim, text: tokens.red }, Family: { bg: tokens.purpleDim, text: tokens.purple }, Health: { bg: tokens.greenDim, text: tokens.green }, Home: { bg: tokens.amberDim, text: tokens.amber }, Ideas: { bg: tokens.accentDim, text: tokens.accent }, Emotional: { bg: tokens.purpleDim, text: tokens.purple }, Later: { bg: 'rgba(255,255,255,0.05)', text: tokens.textMuted } };

  // Sort action items: urgent flags first, then by inferred category weight
  const urgentSet = new Set(result?.urgentFlags || []);
  const sortedActionItems = [...(result?.actionItems || [])].sort((a, b) => {
    const aUrgent = urgentSet.has(a) ? 0 : 1;
    const bUrgent = urgentSet.has(b) ? 0 : 1;
    return aUrgent - bUrgent;
  });

  const calendarConnected = !!calendarIntegration?.connected;
  const todayBlocks       = (schedule || []).filter(b => b.day === 'today');
  const tomorrowBlocks    = (schedule || []).filter(b => b.day === 'tomorrow');
  const activeBlockCount  = (schedule || []).filter((_, i) => !removedItems.has(i)).length;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* Header */}
      <div className="fade-up" style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Brain Dump → AI Organization</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '26px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>Brain Dump</h1>
        <p style={{ color: tokens.textSecondary, fontSize: '13px', marginTop: '4px' }}>Raw thoughts, worries, ideas, tasks — everything. AI will organize it.</p>
      </div>

      {/* Tabs */}
      <div className="fade-up stagger-1" style={{ display: 'flex', gap: '6px', marginBottom: '20px', background: tokens.bgCard, padding: '6px', borderRadius: '10px', border: `1px solid ${tokens.border}` }}>
        {[{ id: 'dump', label: '◎ New Dump' }, { id: 'history', label: `📋 History (${brainDumps.length})` }].map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); if (tab.id === 'dump') reset(); }}
            style={{ flex: 1, padding: '9px', borderRadius: '7px', border: 'none', background: activeTab === tab.id ? tokens.accentDim : 'transparent', color: activeTab === tab.id ? tokens.accent : tokens.textSecondary, fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 400, cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── History tab ── */}
      {activeTab === 'history' ? (
        <HistoryTab brainDumps={brainDumps} />

      ) : !result ? (
        /* ── Dump input ── */
        <div className="fade-up stagger-2">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
            <button onClick={toggleRecording}
              style={{ width: 64, height: 64, borderRadius: '50%', background: recording ? 'rgba(212,122,107,0.2)' : tokens.accentDim, border: `2px solid ${recording ? tokens.red : tokens.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', cursor: 'pointer', transition: 'all 0.2s', boxShadow: recording ? `0 0 24px rgba(212,122,107,0.3)` : `0 0 16px rgba(200,169,110,0.15)` }}
              className={recording ? 'pulsing' : ''}
            >{recording ? '⏹' : '🎤'}</button>
          </div>
          {recording && <p style={{ textAlign: 'center', fontSize: '12px', color: tokens.red, marginBottom: '12px' }} className="pulsing">Recording... speak freely</p>}

          <textarea value={text} onChange={e => setText(e.target.value)}
            placeholder="Start typing anything — don't filter yourself.&#10;&#10;Mention creating a project? AI creates it automatically.&#10;Mention tasks? AI creates and links them.&#10;Worries, ideas, anything — dump it all."
            style={{ width: '100%', minHeight: '200px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '12px', padding: '16px 18px', color: tokens.textPrimary, fontSize: '14px', lineHeight: 1.75, resize: 'vertical', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', transition: 'border-color 0.15s' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px', marginBottom: '14px' }}>
            {tips.map(tip => (
              <button key={tip} onClick={() => setText(t => t + (t.trim() ? '\n\n' : '') + tip + ': ')}
                style={{ fontSize: '11px', color: tokens.textSecondary, background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '99px', padding: '4px 12px', cursor: 'pointer', fontFamily: fonts.body }}
                onMouseEnter={e => { e.target.style.borderColor = tokens.accent; e.target.style.color = tokens.accent; }}
                onMouseLeave={e => { e.target.style.borderColor = tokens.border; e.target.style.color = tokens.textSecondary; }}
              >{tip}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button onClick={handleProcess} loading={processing} disabled={!text.trim() || processing} size="lg">✦ Organize with AI</Button>
            {text.length > 0 && <span style={{ fontSize: '12px', color: tokens.textMuted }}>{text.length} chars</span>}
          </div>
        </div>

      ) : scheduleConfirmed ? (
        /* ── Schedule confirmed ── */
        <div className="fade-in" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: tokens.greenDim, border: `1px solid rgba(109,191,158,0.25)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', margin: '0 auto 16px' }}>✓</div>
          <div style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color: tokens.green, marginBottom: '8px' }}>Schedule locked in</div>
          <div style={{ fontSize: '13px', color: tokens.textMuted, marginBottom: '28px' }}>
            {confirmedCount} block{confirmedCount !== 1 ? 's' : ''} added to Google Calendar. Tasks marked scheduled.
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <Button onClick={reset} variant="ghost">← New Dump</Button>
            <Button onClick={() => setActiveTab('history')}>View History →</Button>
          </div>
        </div>

      ) : schedule !== null ? (
        /* ── Schedule preview ── */
        <div className="fade-in">
          <div style={{ marginBottom: '18px' }}>
            <SectionLabel>Proposed Schedule</SectionLabel>
            <p style={{ fontSize: '13px', color: tokens.textMuted }}>
              {activeBlockCount === 0
                ? 'All blocks removed. Add some back or cancel.'
                : `${activeBlockCount} block${activeBlockCount !== 1 ? 's' : ''} ready to lock in. Remove any you don't want.`}
            </p>
          </div>

          {todayBlocks.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
                TODAY — {scheduleDates.today}
              </div>
              {todayBlocks.map((block, i) => (
                <ScheduleBlock key={i} block={block} removed={removedItems.has(i)} onToggle={() => toggleRemove(i)} />
              ))}
            </div>
          )}

          {tomorrowBlocks.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
                TOMORROW — {scheduleDates.tomorrow}
              </div>
              {tomorrowBlocks.map((block, i) => {
                const globalIndex = todayBlocks.length + i;
                return <ScheduleBlock key={i} block={block} removed={removedItems.has(globalIndex)} onToggle={() => toggleRemove(globalIndex)} />;
              })}
            </div>
          )}

          {schedule.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px', color: tokens.textMuted, fontSize: '13px' }}>
              No time slots could be scheduled. Your calendar may be fully booked.
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', paddingTop: '8px' }}>
            <Button onClick={() => { setSchedule(null); setScheduleError(''); }} variant="ghost">← Back</Button>
            <Button onClick={handleConfirmSchedule} loading={confirming} disabled={activeBlockCount === 0 || confirming}>
              Confirm — Schedule {activeBlockCount} item{activeBlockCount !== 1 ? 's' : ''} →
            </Button>
          </div>
        </div>

      ) : (
        /* ── Results view ── */
        <div className="fade-in">
          <div style={{ marginBottom: '14px' }}><AICard text={result.summary} label="ANCHOR SUMMARY" /></div>

          {(created.projects.length > 0 || created.tasks.length > 0) && (
            <div style={{ marginBottom: '14px', padding: '14px 16px', background: tokens.greenDim, border: `1px solid rgba(109,191,158,0.2)`, borderRadius: '12px' }}>
              <div style={{ fontSize: '11px', color: tokens.green, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>✓ AUTOMATICALLY CREATED</div>
              {created.projects.length > 0 && <div style={{ fontSize: '13px', color: tokens.textPrimary, marginBottom: '4px' }}><span style={{ color: tokens.green }}>Projects: </span>{created.projects.join(', ')}</div>}
              {created.tasks.length > 0 && <div style={{ fontSize: '13px', color: tokens.textPrimary }}><span style={{ color: tokens.green }}>Tasks: </span>{created.tasks.join(', ')}</div>}
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '6px' }}>Now live in Projects and Tasks screens.</div>
            </div>
          )}

          {result.mostUrgent && (
            <div style={{ marginBottom: '14px', padding: '14px 16px', background: 'rgba(212,169,107,0.08)', border: `1px solid rgba(212,169,107,0.2)`, borderRadius: '12px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '16px', flexShrink: 0 }}>⚑</span>
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.amber, letterSpacing: '0.1em', marginBottom: '4px' }}>START HERE</div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: tokens.textPrimary }}>{result.mostUrgent}</div>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            {/* Action items — sorted by urgency */}
            {sortedActionItems.length > 0 && (
              <Card>
                <SectionLabel>Action Items</SectionLabel>
                {sortedActionItems.map((item, i) => {
                  const isUrgent = urgentSet.has(item);
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', gap: '6px', flex: 1, alignItems: 'flex-start' }}>
                        <span style={{ color: isUrgent ? tokens.amber : tokens.accent, flexShrink: 0, fontSize: isUrgent ? '13px' : '14px' }}>
                          {isUrgent ? '⚑' : '→'}
                        </span>
                        <span style={{ fontSize: '13px', color: tokens.textPrimary }}>{item}</span>
                      </div>
                      {!tasksSent.includes(item)
                        ? <button onClick={() => sendTaskToInbox(item)} style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', flexShrink: 0, fontFamily: fonts.body }}>+ Task</button>
                        : <span style={{ fontSize: '10px', color: tokens.green, flexShrink: 0 }}>✓</span>
                      }
                    </div>
                  );
                })}
              </Card>
            )}

            {result.emotionalThemes?.length > 0 && (
              <Card>
                <SectionLabel>Emotional Themes</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                  {result.emotionalThemes.map((t, i) => <Tag key={i} label={t} color={tokens.purpleDim} textColor={tokens.purple} />)}
                </div>
                {result.urgentFlags?.length > 0 && (<>
                  <div style={{ fontSize: '10px', color: tokens.red, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>URGENT</div>
                  {result.urgentFlags.map((f, i) => <div key={i} style={{ fontSize: '12px', color: tokens.red, marginBottom: '4px' }}>⚑ {f}</div>)}
                </>)}
              </Card>
            )}
          </div>

          {Object.entries(result.categories || {}).filter(([, v]) => Array.isArray(v) && v.length > 0).length > 0 && (
            <Card style={{ marginBottom: '14px' }}>
              <SectionLabel>Categorized Thoughts</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                {Object.entries(result.categories).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([cat, items]) => {
                  const c = catColors[cat] || { bg: tokens.bgGlass, text: tokens.textSecondary };
                  return (
                    <div key={cat} style={{ padding: '12px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}` }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: c.text, letterSpacing: '0.08em', marginBottom: '8px' }}>{cat.toUpperCase()}</div>
                      {items.map((item, i) => <div key={i} style={{ fontSize: '12px', color: tokens.textSecondary, marginBottom: '4px' }}>· {item}</div>)}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Schedule builder CTA */}
          <div style={{ marginBottom: '14px', padding: '16px', background: 'linear-gradient(135deg, rgba(91,143,212,0.07), rgba(91,143,212,0.03))', border: `1px solid rgba(91,143,212,0.18)`, borderRadius: tokens.radiusLg }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '3px' }}>Build a time-blocked schedule</div>
                <div style={{ fontSize: '12px', color: tokens.textMuted }}>
                  {calendarConnected
                    ? 'AI reads your calendar, factors in priority and focus time, and lays out your day.'
                    : 'Connect Google Calendar on the Life OS screen to unlock scheduling.'}
                </div>
              </div>
              {calendarConnected ? (
                <Button onClick={handleBuildSchedule} loading={scheduling} disabled={scheduling}>
                  {scheduling ? 'Building…' : '✦ Build My Schedule'}
                </Button>
              ) : (
                <span style={{ fontSize: '11px', color: tokens.textMuted, fontStyle: 'italic' }}>Calendar not connected</span>
              )}
            </div>
            {scheduleError && <div style={{ fontSize: '12px', color: tokens.red, marginTop: '10px' }}>{scheduleError}</div>}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button onClick={reset} variant="ghost">← New Dump</Button>
            <Button onClick={() => setActiveTab('history')} variant="accent" size="sm">View History →</Button>
            {saved && <span style={{ fontSize: '12px', color: tokens.green }}>✓ Saved</span>}
          </div>
        </div>
      )}
    </div>
  );
}
