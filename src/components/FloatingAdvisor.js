// src/components/FloatingAdvisor.js
// Floating AI panel — replaces AdvisorScreen + BrainDumpScreen.
// Two tabs: Chat (strategic advisor, page-aware) · Brain Dump (organise thoughts + schedule).
// Quick capture bar sits above the tabs for instant task entry (typed or voice).
// Opens from the ✦ button fixed to the bottom-right of every screen.
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { tokens, fonts } from '../lib/tokens';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { usePageContext } from '../context/PageContext';
import { callAI, buildSchedule } from '../lib/ai';
import { buildHolisticContext } from '../lib/aiContext';
import {
  saveAdvisorChat, getAdvisorChat,
  addTask, addProject, saveBrainDump, updateTask, updateBrainDump,
} from '../lib/db';
import {
  getValidAccessToken, getEvents, getFreeSlots, createEvent, formatEventTime,
} from '../lib/calendar';
import { Spinner, Modal, Button } from './ui';
import TaskModal from './TaskModal';

// ─── constants ────────────────────────────────────────────────────────────────

const SESSION_KEY = new Date().toDateString().replace(/ /g, '-');

const SUGGESTED_PROMPTS = [
  "What's my highest leverage move today?",
  "Am I overcommitting right now?",
  "Where am I leaking energy?",
  "Which project needs attention most?",
  "What should I ignore this week?",
  "Talk me through my debt payoff strategy",
  "What patterns are hurting my progress?",
];

const PRIORITY_CYCLE = { critical: 'high', high: 'medium', medium: 'low', low: 'critical' };
const PRIORITY_EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };
const FOCUS_STYLES   = {
  deep:   { bg: tokens.blueDim,  text: tokens.blue  },
  medium: { bg: tokens.amberDim, text: tokens.amber },
  quick:  { bg: tokens.greenDim, text: tokens.green },
};
const DUMP_TIPS = ['What\'s stressing me','What I\'m avoiding','Tasks I need to do','New project ideas','Money worries','What\'s unresolved'];

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseActions(text) {
  const actions = [];
  for (const m of text.matchAll(/CREATE_PROJECT:\s*({[^}]+})/g)) {
    try { actions.push({ type: 'create_project', ...JSON.parse(m[1]) }); } catch {}
  }
  for (const m of text.matchAll(/CREATE_TASK:\s*({[^}]+})/g)) {
    try { actions.push({ type: 'create_task', ...JSON.parse(m[1]) }); } catch {}
  }
  const cleanText = text
    .replace(/CREATE_PROJECT:\s*{[^}]+}/g, '')
    .replace(/CREATE_TASK:\s*{[^}]+}/g, '')
    .trim();
  return { cleanText, actions };
}

function recalculateTimes(orderedBlocks, todaySlots, tomorrowSlots) {
  const BUFFER_MS = 10 * 60000;
  const allSlots  = [
    ...todaySlots.map(s => ({ ...s, day: 'today' })),
    ...tomorrowSlots.map(s => ({ ...s, day: 'tomorrow' })),
  ];
  if (!allSlots.length) return orderedBlocks.map(b => ({ ...b, day: null, start: null, end: null }));

  let slotIdx = 0;
  let cursor  = new Date(allSlots[0].start);
  const result = [];

  for (const block of orderedBlocks) {
    const durationMs = (block.durationMinutes || 30) * 60000;
    let placed = false;

    while (slotIdx < allSlots.length) {
      const slot      = allSlots[slotIdx];
      const slotStart = new Date(slot.start);
      const slotEnd   = new Date(slot.end);
      if (cursor < slotStart) cursor = new Date(slotStart);
      if (cursor >= slotEnd)  { slotIdx++; if (slotIdx < allSlots.length) cursor = new Date(allSlots[slotIdx].start); continue; }
      const available = slotEnd.getTime() - cursor.getTime();
      if (available >= durationMs) {
        result.push({ ...block, day: slot.day, start: new Date(cursor).toISOString(), end: new Date(cursor.getTime() + durationMs).toISOString() });
        cursor = new Date(cursor.getTime() + durationMs + BUFFER_MS);
        placed = true;
        break;
      } else {
        slotIdx++;
        if (slotIdx < allSlots.length) cursor = new Date(allSlots[slotIdx].start);
      }
    }
    if (!placed) result.push({ ...block, day: null, start: null, end: null });
  }
  return result;
}

// ─── ScheduleBlock sub-component ─────────────────────────────────────────────

function ScheduleBlock({ block, index, isFirst, isLast, isEditing, editForm, onEditStart, onEditSave, onEditCancel, onEditChange, onDelete, onMoveUp, onMoveDown }) {
  const fc = FOCUS_STYLES[block.focusType] || FOCUS_STYLES.medium;
  const unscheduled = !block.start;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px', marginBottom: '5px', background: unscheduled ? tokens.bgGlass : tokens.bgCard, border: `1px solid ${unscheduled ? 'rgba(255,255,255,0.04)' : tokens.border}`, borderRadius: '8px', opacity: unscheduled ? 0.45 : 1 }}>
      {!unscheduled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0, paddingTop: '2px' }}>
          <button onClick={onMoveUp} disabled={isFirst} style={{ background: 'none', border: 'none', cursor: isFirst ? 'default' : 'pointer', color: isFirst ? tokens.textMuted : tokens.textSecondary, fontSize: '11px', padding: '1px 2px', opacity: isFirst ? 0.3 : 0.7, lineHeight: 1 }}>↑</button>
          <button onClick={onMoveDown} disabled={isLast} style={{ background: 'none', border: 'none', cursor: isLast ? 'default' : 'pointer', color: isLast ? tokens.textMuted : tokens.textSecondary, fontSize: '11px', padding: '1px 2px', opacity: isLast ? 0.3 : 0.7, lineHeight: 1 }}>↓</button>
        </div>
      )}

      {isEditing ? (
        <div style={{ flex: 1 }}>
          <input autoFocus value={editForm.title} onChange={e => onEditChange('title', e.target.value)} style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.borderFocus}`, borderRadius: '6px', padding: '6px 8px', color: tokens.textPrimary, fontSize: '12px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', marginBottom: '6px' }} />
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="number" min="5" max="480" value={editForm.durationMinutes} onChange={e => onEditChange('durationMinutes', Math.max(5, parseInt(e.target.value) || 30))} style={{ width: '60px', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '4px 8px', color: tokens.textPrimary, fontSize: '12px', outline: 'none', fontFamily: fonts.body }} />
            <span style={{ fontSize: '10px', color: tokens.textMuted }}>min</span>
            <button onClick={onEditSave} style={{ marginLeft: 'auto', background: tokens.accent, border: 'none', borderRadius: '5px', padding: '4px 10px', color: '#0C0E12', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: fonts.body }}>Save</button>
            <button onClick={onEditCancel} style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '5px', padding: '4px 8px', color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', fontFamily: fonts.body }}>×</button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minWidth: 0 }}>
          {unscheduled
            ? <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '2px' }}>Couldn't fit</div>
            : <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '2px' }}>{formatEventTime(block.start)} – {formatEventTime(block.end)} · {block.durationMinutes}m</div>
          }
          <div style={{ fontSize: '12px', fontWeight: 600, color: unscheduled ? tokens.textSecondary : tokens.textPrimary, lineHeight: 1.3 }}>{block.taskTitle}</div>
          {block.reason && !unscheduled && <div style={{ fontSize: '10px', color: tokens.textMuted, marginTop: '2px' }}>{block.reason}</div>}
        </div>
      )}

      {!isEditing && (
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexShrink: 0 }}>
          {!unscheduled && <span style={{ fontSize: '9px', fontWeight: 700, color: fc.text, background: fc.bg, padding: '2px 6px', borderRadius: '4px' }}>{block.focusType}</span>}
          <button onClick={() => onEditStart(index, block)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.textMuted, fontSize: '12px', padding: '1px 3px', opacity: 0.7, fontFamily: fonts.body }}>✎</button>
          <button onClick={() => onDelete(index)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.red, fontSize: '12px', padding: '1px 3px', opacity: 0.6, fontFamily: fonts.body }}>✕</button>
        </div>
      )}
    </div>
  );
}

// ─── HistoryTab sub-component ─────────────────────────────────────────────────

function HistoryTab({ brainDumps, uid }) {
  const [expanded, setExpanded]       = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const visible = showArchived ? brainDumps : brainDumps.filter(d => !d.archived);
  const archivedCount = brainDumps.filter(d => d.archived).length;

  if (!visible.length) return (
    <div style={{ textAlign: 'center', padding: '32px 16px' }}>
      <div style={{ fontSize: '24px', opacity: 0.3, marginBottom: '8px' }}>◎</div>
      <div style={{ fontSize: '13px', color: tokens.textMuted }}>No brain dumps yet.</div>
    </div>
  );

  return (
    <div>
      {archivedCount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <button onClick={() => setShowArchived(v => !v)} style={{ background: 'none', border: 'none', fontSize: '11px', color: tokens.textMuted, cursor: 'pointer', fontFamily: fonts.body }}>
            {showArchived ? 'Hide archived' : `Show ${archivedCount} archived`}
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {visible.map(dump => {
          const isExp     = expanded === dump.id;
          const date      = dump.createdAt?.toDate?.() || new Date();
          const dateStr   = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          const summary   = dump.result?.summary || dump.result?.mostUrgent || 'Brain dump captured';
          const actCount  = dump.result?.actionItems?.length || 0;
          const cats      = Object.entries(dump.result?.categories || {}).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([k]) => k);
          return (
            <div key={dump.id} onClick={() => setExpanded(isExp ? null : dump.id)}
              style={{ background: isExp ? 'rgba(200,169,110,0.05)' : tokens.bgCard, border: `1px solid ${isExp ? 'rgba(200,169,110,0.2)' : tokens.border}`, borderRadius: '8px', padding: '12px 14px', cursor: 'pointer', opacity: dump.archived ? 0.6 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, paddingRight: '8px' }}>
                  <div style={{ fontSize: '10px', color: tokens.textMuted, marginBottom: '3px' }}>{dateStr}</div>
                  <div style={{ fontSize: '12px', color: tokens.textPrimary, lineHeight: 1.4 }}>{summary}</div>
                  {cats.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '5px' }}>
                      {cats.slice(0, 3).map(cat => <span key={cat} style={{ fontSize: '9px', color: tokens.textMuted, background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: '4px' }}>{cat}</span>)}
                      {actCount > 0 && <span style={{ fontSize: '9px', color: tokens.accent, background: tokens.accentDim, padding: '1px 6px', borderRadius: '4px' }}>{actCount} actions</span>}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '11px', color: tokens.textMuted, flexShrink: 0 }}>{isExp ? '▲' : '▼'}</span>
              </div>

              {isExp && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${tokens.border}` }}>
                  {dump.rawText && <div style={{ fontSize: '11px', color: tokens.textSecondary, lineHeight: 1.6, whiteSpace: 'pre-wrap', background: tokens.bgGlass, padding: '8px 10px', borderRadius: '6px', marginBottom: '10px' }}>{dump.rawText.slice(0, 300)}{dump.rawText.length > 300 ? '…' : ''}</div>}
                  {dump.result?.actionItems?.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ fontSize: '9px', color: tokens.accent, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '5px' }}>ACTION ITEMS</div>
                      {dump.result.actionItems.slice(0, 5).map((item, i) => <div key={i} style={{ fontSize: '11px', color: tokens.textPrimary, marginBottom: '3px' }}><span style={{ color: tokens.accent }}>→</span> {item}</div>)}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={e => { e.stopPropagation(); updateBrainDump(uid, dump.id, { archived: !dump.archived }); }} style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '5px', padding: '3px 10px', fontSize: '10px', color: tokens.textMuted, cursor: 'pointer', fontFamily: fonts.body }}>
                      {dump.archived ? 'Unarchive' : 'Archive'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FloatingAdvisor({ open, onClose }) {
  const { user }                                                       = useAuth();
  const { projects, tasks, goals, brainDumps, weeklyReviews,
          calendarIntegration, userProfile,
          manualCashFlow, debtAccounts, assetAccounts,
          notes, savingsAnalysis, savingsHistory, actedOnRecommendations,
          habits, habitLogs, dailyReviews, brainDumpDigests }          = useData();
  const { pageContext }                                                = usePageContext();

  // panel state — controlled externally via open/onClose props
  const [tab,     setTab]     = useState('chat'); // 'chat' | 'dump'

  // ── chat state ────────────────────────────────────────────────────────────
  const [messages,        setMessages]        = useState([]);
  const [chatInput,       setChatInput]       = useState('');
  const [chatLoading,     setChatLoading]     = useState(false);
  const [loadingSession,  setLoadingSession]  = useState(true);
  const bottomRef  = useRef(null);
  const chatInputRef = useRef(null);

  // ── dump state ────────────────────────────────────────────────────────────
  const [dumpTab,           setDumpTab]           = useState('new');   // 'new' | 'history'
  const [dumpView,          setDumpView]          = useState('input'); // 'input'|'taskReview'|'results'|'schedule'|'confirmed'
  const [dumpText,          setDumpText]          = useState('');
  const [processing,        setProcessing]        = useState(false);
  const [dumpResult,        setDumpResult]        = useState(null);
  const [recording,         setRecording]         = useState(false);
  const [dumpSaved,         setDumpSaved]         = useState(false);
  const [tasksSent,         setTasksSent]         = useState([]);
  const [pendingTasks,      setPendingTasks]      = useState([]);
  const [freshProjects,     setFreshProjects]     = useState([]);
  const [savingTasks,       setSavingTasks]       = useState(false);
  const [createdTaskRefs,   setCreatedTaskRefs]   = useState([]);
  const [created,           setCreated]           = useState({ projects: [], tasks: [] });
  const [intentCapturing,   setIntentCapturing]   = useState(false);
  const [intent,            setIntent]            = useState({ topPriority: '', toDefer: '', energy: 'medium' });
  const [scheduling,        setScheduling]        = useState(false);
  const [scheduleBlocks,    setScheduleBlocks]    = useState([]);
  const [rawSlots,          setRawSlots]          = useState({ today: [], tomorrow: [] });
  const [scheduleError,     setScheduleError]     = useState('');
  const [confirming,        setConfirming]        = useState(false);
  const [confirmedCount,    setConfirmedCount]    = useState(0);
  const [scheduleDates,     setScheduleDates]     = useState({ today: '', tomorrow: '' });
  const [editingBlockIdx,   setEditingBlockIdx]   = useState(null);
  const [editForm,          setEditForm]          = useState({ title: '', durationMinutes: 30 });
  const [saveToNoteModal,   setSaveToNoteModal]   = useState({ open: false, content: '', taskId: '', saving: false });
  const recognitionRef = useRef(null);

  // ── quick capture state ───────────────────────────────────────────────────
  const [captureText,     setCaptureText]     = useState('');
  const [captureExpanded, setCaptureExpanded] = useState(false);
  const [captureListening,setCaptureListening]= useState(false);
  const [captureParsing,  setCaptureParsing]  = useState(false);
  const [captureTaskOpen, setCaptureTaskOpen] = useState(false);
  const [captureDefaults, setCaptureDefaults] = useState({});
  const [captureSaving,   setCaptureSaving]   = useState(false);
  const captureRecognitionRef = useRef(null);
  const captureInputRef       = useRef(null);

  // ── load chat session ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    getAdvisorChat(user.uid, SESSION_KEY).then(session => {
      if (session?.messages) setMessages(session.messages);
      setLoadingSession(false);
    });
  }, [user]);

  // ── scroll to bottom on new messages ──────────────────────────────────────
  useEffect(() => {
    if (open && tab === 'chat') bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading, open, tab]);

  // ── focus input when panel opens on chat tab ──────────────────────────────
  useEffect(() => {
    if (open && tab === 'chat') setTimeout(() => chatInputRef.current?.focus(), 100);
  }, [open, tab]);

  // ── voice recognition setup (brain dump) ──────────────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const r = new SR();
      r.continuous = true; r.interimResults = true; r.lang = 'en-US';
      r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; setDumpText(t); };
      r.onend = () => setRecording(false);
      recognitionRef.current = r;
    }
  }, []);

  // ── voice recognition setup (quick capture) ───────────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const r = new SR();
      r.continuous = false; r.interimResults = true; r.lang = 'en-US';
      r.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        setCaptureText(t);
      };
      r.onend = () => {
        setCaptureListen(false);
      };
      captureRecognitionRef.current = r;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setCaptureListen = (on) => {
    setCaptureListen._state = on;
    setCaptureListening(on);
  };

  const toggleCaptureVoice = () => {
    if (!captureRecognitionRef.current) { alert('Voice input not supported. Try Chrome.'); return; }
    if (captureListening) {
      captureRecognitionRef.current.stop();
      setCaptureListening(false);
    } else {
      setCaptureText('');
      captureRecognitionRef.current.start();
      setCaptureListening(true);
      setCaptureExpanded(true);
      setTimeout(() => captureInputRef.current?.focus(), 50);
    }
  };

  const handleCaptureSubmit = async () => {
    const text = captureText.trim();
    if (!text) return;
    setCaptureParsing(true);
    try {
      const res = await fetch('/api/tasks/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ transcript: text }),
      });
      const data = res.ok ? await res.json() : {};
      setCaptureDefaults(data.task || { title: text });
    } catch {
      setCaptureDefaults({ title: text });
    }
    setCaptureParsing(false);
    setCaptureTaskOpen(true);
  };

  const handleCaptureSave = async (formData) => {
    setCaptureSaving(true);
    try {
      await addTask(user.uid, { ...formData, source: 'quick-capture' });
      setCaptureTaskOpen(false);
      setCaptureText('');
      setCaptureExpanded(false);
      setCaptureDefaults({});
    } catch (err) {
      console.error('Quick capture save error:', err);
    }
    setCaptureSaving(false);
  };

  // ── close on Escape ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && open) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ── proactive insights (chat) ─────────────────────────────────────────────
  const proactiveInsights = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const insights = [];
    const overdue = tasks.filter(t => !t.done && t.scheduledDate && t.scheduledDate < today);
    if (overdue.length >= 3) insights.push({ label: `${overdue.length} tasks overdue`, prompt: `I have ${overdue.length} overdue tasks including "${overdue[0].title}". Am I overcommitting or avoiding?` });
    const stalled = projects.filter(p => p.status === 'stalled');
    if (stalled.length > 0) insights.push({ label: `${stalled.length > 1 ? `${stalled.length} projects` : stalled[0].title} stalled`, prompt: `My "${stalled[0].title}" project is stalled. What's the right move — push, pause, or kill it?` });
    const critical = tasks.filter(t => !t.done && t.priority === 'critical');
    if (critical.length > 0) insights.push({ label: `${critical.length} critical task${critical.length > 1 ? 's' : ''} pending`, prompt: `I have ${critical.length} critical task${critical.length > 1 ? 's' : ''} pending: "${critical[0].title}". Help me unblock this.` });
    return insights.slice(0, 3);
  }, [tasks, projects]);

  // ── build AI context (chat) ────────────────────────────────────────────────
  const buildContext = () => {
    let calendarDensity = null;
    try {
      const stored = sessionStorage.getItem('calendarDensity');
      if (stored) calendarDensity = JSON.parse(stored);
    } catch {}
    const base = buildHolisticContext({
      goals, tasks, projects, brainDumps, brainDumpDigests, weeklyReviews,
      userProfile, plaidData: manualCashFlow, manualCashFlow,
      debtAccounts, assetAccounts, notes,
      calendarDensity,
      savingsAnalysis, savingsHistory, actedOnRecommendations,
      habits, habitLogs, dailyReviews,
    });

    // Page-specific context injection
    let pageStr = '';
    if (pageContext) {
      const { type, title, id, data } = pageContext;
      if (type === 'goal' && data) {
        pageStr = `\n\n=== CURRENT PAGE: GOAL ===
The user has the Advisor open while viewing the goal "${title}".
Goal type: ${data.goalType || 'general'}
Why it matters: ${data.why || 'not set'}
Target date: ${data.targetDate || 'not set'}
Likelihood score: ${data.likelihoodScore != null ? data.likelihoodScore + '/100' : 'unscored'}
Context: ${data.context || 'none'}
Goal ID for task linking: ${id}

When you suggest creating tasks, include "goalId":"${id}" in CREATE_TASK JSON to automatically link them to this goal.
Focus your advice on this specific goal unless the user steers elsewhere.`;
      } else if (type === 'project' && data) {
        pageStr = `\n\n=== CURRENT PAGE: PROJECT ===
The user has the Advisor open while viewing the project "${title}".
Status: ${data.status || 'active'}
Category: ${data.category || 'general'}
Next action: ${data.nextAction || 'not set'}
Blockers: ${data.blockers || 'none'}
Project ID for task linking: ${id}

When you suggest creating tasks, include "projectId":"${id}" in CREATE_TASK JSON to automatically link them to this project.
Focus your advice on this specific project unless the user steers elsewhere.`;
      }
    }

    return `${base}${pageStr}

CAPABILITIES: You can create projects and tasks directly. When asked, include these markers in your response (auto-processed, NOT shown to user):
CREATE_PROJECT: {"title":"Project Name","category":"work|home|finance|health|creative|personal|business","nextAction":"first step","notes":"brief context"}
CREATE_TASK: {"title":"Task name","priority":"critical|high|medium|low","project":"Project name or Inbox","goalId":"optional-goal-id","projectId":"optional-project-id","context":"work|personal|home|health|financial|null","dueDate":"YYYY-MM-DD or null"}

Always confirm in plain language what you created. Multiple CREATE_TASK markers are allowed.`.trim();
  };

  // ── execute actions (chat) ─────────────────────────────────────────────────
  const executeActions = async (actions) => {
    const results = [];
    for (const action of actions) {
      try {
        if (action.type === 'create_project') {
          const exists = projects.some(p => p.title.toLowerCase() === action.title?.toLowerCase());
          if (!exists && action.title) {
            await addProject(user.uid, { title: action.title, category: action.category || 'personal', status: 'active', momentum: 30, nextAction: action.nextAction || '', notes: action.notes || 'Created by Anchor advisor', blockers: '', sentiment: 'new' });
            results.push(`✓ Project created: "${action.title}"`);
          }
        }
        if (action.type === 'create_task') {
          const linkedProject = projects.find(p => p.title.toLowerCase() === action.project?.toLowerCase());
          await addTask(user.uid, {
            title:     action.title,
            priority:  action.priority || 'medium',
            project:   linkedProject?.title || action.project || 'Inbox',
            projectId: action.projectId || linkedProject?.id || null,
            goalId:    action.goalId    || (pageContext?.type === 'goal'    ? pageContext.id : null),
            source:    'advisor',
            context:   action.context  || null,
            dueDate:   action.dueDate  || null,
          });
          results.push(`✓ Task created: "${action.title}"`);
        }
      } catch (err) {
        console.error('Action error:', err);
      }
    }
    return results;
  };

  // ── save AI response to task note ─────────────────────────────────────────
  const handleSaveToNote = async () => {
    const { taskId, content } = saveToNoteModal;
    if (!taskId || !content.trim()) return;
    setSaveToNoteModal(m => ({ ...m, saving: true }));
    try {
      const task = tasks.find(t => t.id === taskId);
      const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const appendedNote = task?.notes
        ? `${task.notes}\n\n✦ Advisor [${date}]: ${content.trim()}`
        : `✦ Advisor [${date}]: ${content.trim()}`;
      await updateTask(user.uid, taskId, { notes: appendedNote });
      setSaveToNoteModal({ open: false, content: '', taskId: '', saving: false });
    } catch {
      setSaveToNoteModal(m => ({ ...m, saving: false }));
    }
  };

  // ── send chat message ──────────────────────────────────────────────────────
  const sendChat = async (text) => {
    const msg = (text || chatInput).trim();
    if (!msg || chatLoading) return;
    setChatInput('');

    const userMsg = { role: 'user', content: msg };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setChatLoading(true);

    const apiMsgs = updated.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }));
    const rawReply = await callAI({ messages: apiMsgs, systemExtra: buildContext(), maxTokens: 600 });
    const { cleanText, actions } = parseActions(rawReply || 'Let me think on that.');

    let actionResults = [];
    if (actions.length > 0) actionResults = await executeActions(actions);

    const aiMsg = { role: 'ai', content: cleanText, actionResults };
    const final = [...updated, aiMsg];
    setMessages(final);
    setChatLoading(false);
    await saveAdvisorChat(user.uid, SESSION_KEY, final);
    chatInputRef.current?.focus();
  };

  // ── dump: process ──────────────────────────────────────────────────────────
  const handleProcess = async () => {
    if (!dumpText.trim()) return;
    setProcessing(true);
    setDumpResult(null);

    const raw = await callAI({
      messages: [{ role: 'user', content: `Process this brain dump. Existing projects: ${projects.map(p => p.title).join(', ') || 'none'}.
Return ONLY valid JSON, no markdown:
{
  "summary": "2-3 sentence sharp summary",
  "mostUrgent": "single most important item or null",
  "categories": { "Work": [], "Money": [], "Family": [], "Health": [], "Home": [], "Ideas": [], "Emotional": [], "Later": [] },
  "actionItems": ["item1"],
  "emotionalThemes": ["theme1"],
  "urgentFlags": ["item1"],
  "newProjects": [{"title":"name","category":"work|home|finance|health|creative|personal|business","nextAction":"first action","notes":"brief context"}],
  "tasksToCreate": [{"title":"task","priority":"critical|high|medium|low","projectName":"project name or null","estimatedMinutes":30,"context":"work|personal|home|health|financial|null"}]
}
Only include newProjects if explicitly mentioned. estimatedMinutes: realistic (15=quick, 30=short, 60=focused, 90-120=deep).
context detection: company names or 'work'/'client'/'boss'/'office' → 'work'; 'house'/'home'/'fix'/'repair'/'yard' → 'home'; 'doctor'/'dentist'/'workout'/'health'/'gym' → 'health'; 'bank'/'bills'/'budget'/'taxes'/'finance' → 'financial'; explicit 'personal' → 'personal'; null if unclear.
BRAIN DUMP:\n${dumpText}` }],
      maxTokens: 1000,
      systemExtra: 'Return ONLY valid JSON. No markdown fences.',
    });

    let parsed = null;
    try { parsed = JSON.parse((raw || '{}').replace(/```json|```/g, '').trim()); }
    catch { parsed = { summary: 'Your thoughts have been captured.', mostUrgent: null, categories: {}, actionItems: [], emotionalThemes: [], urgentFlags: [], newProjects: [], tasksToCreate: [] }; }

    const createdProjects = [];
    if (parsed.newProjects?.length > 0) {
      for (const proj of parsed.newProjects) {
        if (!proj.title) continue;
        if (!projects.some(p => p.title.toLowerCase() === proj.title.toLowerCase())) {
          const ref = await addProject(user.uid, { title: proj.title, category: proj.category || 'personal', status: 'active', momentum: 30, nextAction: proj.nextAction || '', notes: proj.notes || 'Created from brain dump', blockers: '', sentiment: 'new' });
          createdProjects.push({ ...proj, id: ref?.id });
        }
      }
    }
    setFreshProjects(createdProjects);
    await saveBrainDump(user.uid, { rawText: dumpText, result: parsed });
    setDumpSaved(true);
    setDumpResult(parsed);
    setProcessing(false);

    if (parsed.tasksToCreate?.length > 0) {
      setPendingTasks(parsed.tasksToCreate);
      setDumpView('taskReview');
    } else {
      setCreated({ projects: createdProjects.map(p => p.title), tasks: [] });
      setDumpView('results');
    }
  };

  // ── dump: task review ──────────────────────────────────────────────────────
  const updatePendingTask = (i, field, val) => setPendingTasks(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: val } : t));
  const removePendingTask = (i) => setPendingTasks(prev => prev.filter((_, idx) => idx !== i));
  const cyclePriority = (i) => setPendingTasks(prev => prev.map((t, idx) => idx === i ? { ...t, priority: PRIORITY_CYCLE[t.priority] || 'medium' } : t));

  const handleConfirmTasks = async () => {
    setSavingTasks(true);
    const allProj = [...projects, ...freshProjects];
    const titles = [], refs = [];
    for (const task of pendingTasks) {
      if (!task.title?.trim()) continue;
      const matched = task.projectName ? allProj.find(p => p.title.toLowerCase().includes(task.projectName.toLowerCase())) : null;
      const ref = await addTask(user.uid, { title: task.title.trim(), priority: task.priority || 'medium', project: matched?.title || 'Inbox', projectId: matched?.id || null, source: 'brain-dump', energy: 'medium', context: task.context || null });
      titles.push(task.title.trim());
      refs.push({ title: task.title.trim(), id: ref?.id || null, priority: task.priority || 'medium', estimatedMinutes: task.estimatedMinutes || 30 });
    }
    setCreatedTaskRefs(refs);
    setCreated({ projects: freshProjects.map(p => p.title), tasks: titles });
    setSavingTasks(false);
    setDumpView('results');
  };

  const handleSkipTasks = () => {
    setCreated({ projects: freshProjects.map(p => p.title), tasks: [] });
    setDumpView('results');
  };

  // ── dump: build schedule ───────────────────────────────────────────────────
  const openIntentCapture = () => {
    setIntent({ topPriority: '', toDefer: '', energy: 'medium' });
    setIntentCapturing(true);
  };

  const handleBuildSchedule = async (intentData) => {
    if (scheduling) return;
    setIntentCapturing(false);
    setScheduling(true);
    setScheduleError('');
    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      if (!token) { setScheduleError('Calendar not connected. Connect on Life OS screen.'); return; }

      const todayDate    = new Date();
      const tomorrowDate = new Date(todayDate.getTime() + 86400000);
      const windowStart  = new Date(todayDate); windowStart.setHours(0, 0, 0, 0);
      const windowEnd    = new Date(tomorrowDate); windowEnd.setHours(23, 59, 59, 999);

      const { events = [] } = await getEvents(token, windowStart.toISOString(), windowEnd.toISOString());
      const workHours        = userProfile?.workHours || null;
      const rawTodaySlots    = getFreeSlots(events, todayDate, workHours);
      const tomorrowSlots    = getFreeSlots(events, tomorrowDate, workHours);
      const roundedNow       = new Date(Math.ceil(Date.now() / (15 * 60000)) * (15 * 60000));

      const todaySlots = rawTodaySlots.map(slot => {
        const end = new Date(slot.end), start = new Date(slot.start);
        if (end <= roundedNow) return null;
        if (start < roundedNow) { const dur = Math.round((end - roundedNow) / 60000); return dur < 30 ? null : { ...slot, start: roundedNow.toISOString(), durationMins: dur }; }
        return slot;
      }).filter(Boolean);

      if (!todaySlots.length && !tomorrowSlots.length) { setScheduleError('No free slots found today or tomorrow.'); return; }
      setRawSlots({ today: todaySlots, tomorrow: tomorrowSlots });

      const recentReviews = weeklyReviews.slice(0, 4);
      const recentEnergy  = recentReviews.length ? Math.round(recentReviews.reduce((s, r) => s + (r.energyScore || 60), 0) / recentReviews.length) : 65;
      const urgentSet     = new Set(dumpResult?.urgentFlags || []);
      const todayStr = new Date().toISOString().split('T')[0];
      const existingTasks = tasks.filter(t => !t.done && !t.scheduledStart && !(t.deferredUntil && t.deferredUntil > todayStr)).map(t => ({ title: t.title, taskId: t.id, priority: t.priority || 'medium', estimatedMinutes: t.estimatedMinutes || 30, dueDate: t.dueDate || null, pushCount: t.pushCount || 0, context: t.context || null }));
      const seen = new Set();
      const allTasks = [
        ...createdTaskRefs.map(t => ({ title: t.title, taskId: t.id, priority: t.priority, estimatedMinutes: t.estimatedMinutes })),
        ...(dumpResult?.actionItems || []).filter(item => !createdTaskRefs.some(t => t.title === item)).map(item => ({ title: item, taskId: null, priority: urgentSet.has(item) ? 'high' : 'medium', estimatedMinutes: 30 })),
        ...existingTasks,
      ].filter(t => { if (t.taskId && seen.has(t.taskId)) return false; if (t.taskId) seen.add(t.taskId); return true; })
       .sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.priority] ?? 2) - ({ critical: 0, high: 1, medium: 2, low: 3 }[b.priority] ?? 2));

      if (!allTasks.length) { setScheduleError('No tasks to schedule.'); return; }

      const todayLabel    = todayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const tomorrowLabel = tomorrowDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

      const intentPayload = intentData || intent;
      const energyOverride = intentPayload.energy === 'high' ? 85 : intentPayload.energy === 'low' ? 35 : null;
      const data = await buildSchedule({ tasks: allTasks, slots: { today: todaySlots, tomorrow: tomorrowSlots }, focusProfile: { recentEnergy: energyOverride ?? recentEnergy }, today: todayLabel, tomorrow: tomorrowLabel, intent: intentPayload });
      if (!data) { setScheduleError('Schedule build failed. Try again.'); return; }
      setScheduleBlocks(data.schedule || []);
      setScheduleDates({ today: todayLabel, tomorrow: tomorrowLabel });
      setDumpView('schedule');
    } catch (err) {
      console.error('Schedule error:', err);
      setScheduleError('Something went wrong building your schedule.');
    } finally {
      setScheduling(false);
    }
  };

  // ── dump: schedule block interactions ─────────────────────────────────────
  const handleMoveBlock = (i, dir) => {
    const target = dir === 'up' ? i - 1 : i + 1;
    if (target < 0 || target >= scheduleBlocks.length) return;
    const nb = [...scheduleBlocks]; [nb[i], nb[target]] = [nb[target], nb[i]];
    setScheduleBlocks(recalculateTimes(nb, rawSlots.today, rawSlots.tomorrow));
  };
  const handleEditStart  = (i, b) => { setEditingBlockIdx(i); setEditForm({ title: b.taskTitle, durationMinutes: b.durationMinutes }); };
  const handleEditSave   = () => { setScheduleBlocks(recalculateTimes(scheduleBlocks.map((b, i) => i === editingBlockIdx ? { ...b, taskTitle: editForm.title, durationMinutes: editForm.durationMinutes } : b), rawSlots.today, rawSlots.tomorrow)); setEditingBlockIdx(null); };
  const handleEditCancel = () => setEditingBlockIdx(null);
  const handleEditChange = (field, val) => setEditForm(f => ({ ...f, [field]: val }));
  const handleDeleteBlock = (i) => { setScheduleBlocks(recalculateTimes(scheduleBlocks.filter((_, idx) => idx !== i), rawSlots.today, rawSlots.tomorrow)); if (editingBlockIdx === i) setEditingBlockIdx(null); };

  // ── dump: confirm schedule ────────────────────────────────────────────────
  const handleConfirmSchedule = async () => {
    if (confirming) return;
    const active = scheduleBlocks.filter(b => b.start);
    if (!active.length) return;
    setConfirming(true);
    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await Promise.all(active.map(async (block) => {
        const ev = await createEvent(token, { summary: block.taskTitle, description: `Anchor schedule · ${block.focusType} focus`, start: { dateTime: block.start, timeZone: tz }, end: { dateTime: block.end, timeZone: tz }, extendedProperties: { private: { anchorScheduled: 'true' } } });
        if (block.taskId) await updateTask(user.uid, block.taskId, { status: 'scheduled', scheduledStart: block.start, scheduledEnd: block.end, scheduledDate: block.start.split('T')[0], calendarEventId: ev?.id || null });
        else await addTask(user.uid, { title: block.taskTitle, priority: block.priority || 'medium', source: 'brain-dump', status: 'scheduled', scheduledStart: block.start, scheduledEnd: block.end, scheduledDate: block.start.split('T')[0], calendarEventId: ev?.id || null });
      }));
      setConfirmedCount(active.length);
      setDumpView('confirmed');
    } catch (err) { console.error('Confirm schedule error:', err); }
    finally { setConfirming(false); }
  };

  // ── dump: misc ────────────────────────────────────────────────────────────
  const sendTaskToInbox = async (taskText) => {
    await addTask(user.uid, { title: taskText, priority: 'medium', project: 'Inbox', energy: 'medium', source: 'brain-dump' });
    setTasksSent(prev => [...prev, taskText]);
  };
  const resetDump = () => {
    setDumpText(''); setDumpResult(null); setDumpSaved(false); setTasksSent([]);
    setPendingTasks([]); setFreshProjects([]); setSavingTasks(false);
    setCreatedTaskRefs([]); setCreated({ projects: [], tasks: [] });
    setScheduleBlocks([]); setRawSlots({ today: [], tomorrow: [] }); setScheduleError('');
    setConfirming(false); setConfirmedCount(0); setScheduleDates({ today: '', tomorrow: '' });
    setEditingBlockIdx(null); setDumpView('input');
  };

  const toggleRecording = () => {
    if (!recognitionRef.current) { alert('Voice input not supported. Try Chrome.'); return; }
    if (recording) { recognitionRef.current.stop(); setRecording(false); }
    else { setDumpText(''); recognitionRef.current.start(); setRecording(true); }
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const urgentSet         = new Set(dumpResult?.urgentFlags || []);
  const sortedActionItems = [...(dumpResult?.actionItems || [])].sort((a, b) => (urgentSet.has(a) ? 0 : 1) - (urgentSet.has(b) ? 0 : 1));
  const calendarConnected = !!calendarIntegration?.connected;
  const activeBlockCount  = scheduleBlocks.filter(b => b.start).length;

  // ── styles ────────────────────────────────────────────────────────────────
  const btnStyle = (active) => ({
    flex: 1, padding: '7px 4px', borderRadius: '6px', border: 'none',
    background: active ? tokens.accentDim : 'transparent',
    color: active ? tokens.accent : tokens.textSecondary,
    fontSize: '12px', fontWeight: active ? 700 : 400,
    cursor: 'pointer', transition: 'all 0.15s', fontFamily: fonts.body,
  });

  // ── page context banner label ──────────────────────────────────────────────
  const pageLabel = pageContext
    ? `${pageContext.type === 'goal' ? '◆' : '◈'} ${pageContext.title}`
    : null;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Panel ───────────────────────────────────────────────────────── */}
      {open && (
        <>
          {/* Backdrop */}
          <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 398, background: 'rgba(0,0,0,0.15)', backdropFilter: 'blur(1px)' }} />

          <div
            className="fade-up"
            style={{
              position: 'fixed',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)',
              right:  'max(12px, env(safe-area-inset-right, 12px))',
              width:  'min(440px, calc(100vw - 24px))',
              height: 'min(640px, calc(100vh - 130px))',
              background:   tokens.bgCard,
              border:       `1px solid ${tokens.border}`,
              borderRadius: '16px',
              boxShadow:    '0 16px 64px rgba(0,0,0,0.25)',
              zIndex:       399,
              display:      'flex',
              flexDirection:'column',
              overflow:     'hidden',
            }}
          >
            {/* ── Panel header ─────────────────────────────────────────── */}
            <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${tokens.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: pageLabel ? '6px' : 0 }}>
                <div style={{ width: 24, height: 24, borderRadius: '7px', background: tokens.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', flexShrink: 0 }}>✦</div>
                <span style={{ fontFamily: fonts.display, fontSize: '14px', fontWeight: 700, color: tokens.textPrimary }}>Anchor Advisor</span>
                <div style={{ flex: 1 }} />
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '16px', cursor: 'pointer', padding: '2px', lineHeight: 1 }}>✕</button>
              </div>
              {pageLabel && (
                <div style={{ fontSize: '11px', color: tokens.accent, background: tokens.accentDim, padding: '3px 10px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  {pageLabel}
                </div>
              )}
            </div>

            {/* ── Quick Capture bar ─────────────────────────────────── */}
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${tokens.border}`, flexShrink: 0, background: tokens.bgGlass }}>
              {!captureExpanded ? (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    onClick={toggleCaptureVoice}
                    title="Voice capture"
                    style={{ width: 32, height: 32, borderRadius: '8px', background: captureListening ? 'rgba(212,122,107,0.2)' : tokens.accentDim, border: `1px solid ${captureListening ? tokens.red : tokens.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' }}
                    className={captureListening ? 'pulsing' : ''}
                  >
                    🎤
                  </button>
                  <input
                    ref={captureInputRef}
                    value={captureText}
                    onChange={e => setCaptureText(e.target.value)}
                    onFocus={() => setCaptureExpanded(true)}
                    onKeyDown={e => { if (e.key === 'Enter' && captureText.trim()) handleCaptureSubmit(); if (e.key === 'Escape') { setCaptureExpanded(false); setCaptureText(''); } }}
                    placeholder="Quick capture a task…"
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: tokens.textPrimary, fontSize: '12px', fontFamily: fonts.body, padding: '4px 0' }}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button
                      onClick={toggleCaptureVoice}
                      title={captureListening ? 'Stop' : 'Speak task'}
                      style={{ width: 32, height: 32, borderRadius: '8px', background: captureListening ? 'rgba(212,122,107,0.2)' : tokens.accentDim, border: `1px solid ${captureListening ? tokens.red : tokens.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', cursor: 'pointer', flexShrink: 0 }}
                      className={captureListening ? 'pulsing' : ''}
                    >
                      {captureListening ? '⏹' : '🎤'}
                    </button>
                    <input
                      ref={captureInputRef}
                      autoFocus
                      value={captureText}
                      onChange={e => setCaptureText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && captureText.trim()) handleCaptureSubmit(); if (e.key === 'Escape') { setCaptureExpanded(false); setCaptureText(''); } }}
                      placeholder={captureListening ? 'Listening…' : 'e.g. "dentist Thursday 30 min start Tuesday"'}
                      style={{ flex: 1, background: tokens.bgInput, border: `1px solid ${tokens.borderFocus}`, borderRadius: '7px', outline: 'none', color: tokens.textPrimary, fontSize: '12px', fontFamily: fonts.body, padding: '6px 10px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button onClick={() => { setCaptureExpanded(false); setCaptureText(''); setCaptureListening(false); captureRecognitionRef.current?.stop(); }}
                      style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: tokens.textMuted, cursor: 'pointer', fontFamily: fonts.body }}>
                      Cancel
                    </button>
                    <button
                      onClick={handleCaptureSubmit}
                      disabled={!captureText.trim() || captureParsing}
                      style={{ background: captureText.trim() && !captureParsing ? tokens.accent : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '6px', padding: '4px 12px', fontSize: '11px', fontWeight: 700, color: captureText.trim() && !captureParsing ? '#0C0E12' : tokens.textMuted, cursor: captureText.trim() && !captureParsing ? 'pointer' : 'not-allowed', fontFamily: fonts.body, display: 'flex', alignItems: 'center', gap: '5px' }}
                    >
                      {captureParsing ? <><Spinner size={10} /> Parsing…</> : '+ Add Task →'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Tab bar ───────────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: '4px', padding: '8px 12px', borderBottom: `1px solid ${tokens.border}`, flexShrink: 0, background: tokens.bgCard }}>
              <button style={btnStyle(tab === 'chat')} onClick={() => setTab('chat')}>✦ Chat</button>
              <button style={btnStyle(tab === 'dump')} onClick={() => setTab('dump')}>◎ Brain Dump</button>
            </div>

            {/* ── Tab content ───────────────────────────────────────────── */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

              {/* ═══════════ CHAT TAB ══════════════════════════════════ */}
              {tab === 'chat' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {/* Proactive insights */}
                  {proactiveInsights.length > 0 && messages.length === 0 && !loadingSession && (
                    <div style={{ padding: '10px 12px 0', flexShrink: 0 }}>
                      <div style={{ fontSize: '9px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>✦ Pattern Detected</div>
                      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
                        {proactiveInsights.map((ins, i) => (
                          <button key={i} onClick={() => sendChat(ins.prompt)} style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, border: `1px solid rgba(200,169,110,0.2)`, borderRadius: '99px', padding: '4px 10px', cursor: 'pointer', fontFamily: fonts.body }}>
                            ⚑ {ins.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggested prompts (when no messages) */}
                  {messages.length === 0 && !loadingSession && (
                    <div style={{ padding: '8px 12px', flexShrink: 0 }}>
                      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                        {SUGGESTED_PROMPTS.slice(0, 5).map(p => (
                          <button key={p} onClick={() => sendChat(p)} style={{ fontSize: '10px', color: tokens.textSecondary, background: tokens.bgGlass, border: `1px solid ${tokens.border}`, borderRadius: '99px', padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: fonts.body, marginBottom: '2px' }}
                            onMouseEnter={e => { e.target.style.borderColor = tokens.accent; e.target.style.color = tokens.accent; }}
                            onMouseLeave={e => { e.target.style.borderColor = tokens.border; e.target.style.color = tokens.textSecondary; }}
                          >{p}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Messages */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {loadingSession ? (
                      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '32px' }}><Spinner /></div>
                    ) : messages.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
                        <div style={{ fontSize: '24px', opacity: 0.3, marginBottom: '8px' }}>✦</div>
                        <div style={{ fontFamily: fonts.display, fontSize: '14px', color: tokens.textSecondary, marginBottom: '4px' }}>Ready when you are.</div>
                        {pageLabel
                          ? <div style={{ fontSize: '11px', color: tokens.textMuted, lineHeight: 1.6 }}>I can see you're viewing <strong style={{ color: tokens.accent }}>{pageContext.title}</strong>. Ask anything about it, or I can suggest tasks to move it forward.</div>
                          : <div style={{ fontSize: '11px', color: tokens.textMuted, lineHeight: 1.6 }}>Ask anything. I can create projects and tasks directly from this chat.</div>
                        }
                      </div>
                    ) : (
                      messages.map((m, i) => (
                        <div key={i}>
                          <div style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-start', gap: '8px' }}>
                            {m.role === 'ai' && <div style={{ width: 24, height: 24, borderRadius: '7px', background: tokens.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', flexShrink: 0, marginTop: '2px' }}>✦</div>}
                            <div style={{ maxWidth: '82%', padding: '10px 13px', borderRadius: m.role === 'user' ? '10px 10px 3px 10px' : '3px 10px 10px 10px', background: m.role === 'user' ? tokens.accentDim : tokens.bgGlass, border: `1px solid ${m.role === 'user' ? 'rgba(200,169,110,0.18)' : tokens.border}`, fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                              {m.content}
                            </div>
                            {m.role === 'user' && <div style={{ width: 24, height: 24, borderRadius: '7px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, flexShrink: 0, marginTop: '2px' }}>A</div>}
                          </div>
                          {m.role === 'ai' && m.actionResults?.length > 0 && (
                            <div style={{ marginLeft: '32px', marginTop: '5px', padding: '8px 12px', background: tokens.greenDim, border: `1px solid rgba(109,191,158,0.2)`, borderRadius: '7px' }}>
                              {m.actionResults.map((r, j) => <div key={j} style={{ fontSize: '11px', color: tokens.green, marginBottom: j < m.actionResults.length - 1 ? '3px' : 0 }}>{r}</div>)}
                            </div>
                          )}
                          {m.role === 'ai' && i === messages.length - 1 && !chatLoading && (
                            <div style={{ marginLeft: '32px', marginTop: '5px' }}>
                              <button
                                onClick={() => setSaveToNoteModal({ open: true, content: m.content, taskId: '', saving: false })}
                                style={{ fontSize: '10px', color: tokens.textMuted, background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '5px', padding: '2px 8px', cursor: 'pointer', fontFamily: fonts.body }}
                                onMouseEnter={e => { e.target.style.borderColor = tokens.accent; e.target.style.color = tokens.accent; }}
                                onMouseLeave={e => { e.target.style.borderColor = tokens.border; e.target.style.color = tokens.textMuted; }}
                              >
                                Save to task note ↓
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                    {chatLoading && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: 24, height: 24, borderRadius: '7px', background: tokens.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>✦</div>
                        <div style={{ padding: '10px 13px', background: tokens.bgGlass, border: `1px solid ${tokens.border}`, borderRadius: '3px 10px 10px 10px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <Spinner size={12} /><span style={{ fontSize: '12px', color: tokens.textMuted }}>Thinking…</span>
                        </div>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>

                  {/* Mid-convo prompt chips */}
                  {messages.length > 0 && (
                    <div style={{ padding: '6px 12px', display: 'flex', gap: '5px', flexWrap: 'wrap', flexShrink: 0, borderTop: `1px solid ${tokens.border}` }}>
                      {SUGGESTED_PROMPTS.slice(0, 3).map(p => (
                        <button key={p} onClick={() => sendChat(p)} style={{ fontSize: '9px', color: tokens.textMuted, background: tokens.bgGlass, border: `1px solid ${tokens.border}`, borderRadius: '99px', padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: fonts.body }}
                          onMouseEnter={e => { e.target.style.color = tokens.accent; e.target.style.borderColor = tokens.accent; }}
                          onMouseLeave={e => { e.target.style.color = tokens.textMuted; e.target.style.borderColor = tokens.border; }}
                        >{p}</button>
                      ))}
                    </div>
                  )}

                  {/* Input */}
                  <div style={{ padding: '10px 12px', borderTop: messages.length > 0 ? 'none' : `1px solid ${tokens.border}`, flexShrink: 0, background: tokens.bgCard }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <textarea
                        ref={chatInputRef}
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                        placeholder={pageLabel ? `Ask about ${pageContext.title}, or anything…` : "Ask anything, create tasks, brainstorm…"}
                        rows={1}
                        style={{ flex: 1, background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 12px', color: tokens.textPrimary, fontSize: '13px', resize: 'none', outline: 'none', fontFamily: fonts.body, lineHeight: 1.5, minHeight: '40px', maxHeight: '100px', overflow: 'auto', transition: 'border-color 0.15s' }}
                        onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                        onBlur={e => e.target.style.borderColor = tokens.border}
                      />
                      <button onClick={() => sendChat()} disabled={!chatInput.trim() || chatLoading}
                        style={{ background: chatInput.trim() && !chatLoading ? tokens.accent : 'rgba(255,255,255,0.05)', color: chatInput.trim() && !chatLoading ? '#0C0E12' : tokens.textMuted, border: 'none', borderRadius: '8px', padding: '0 14px', fontSize: '16px', cursor: chatInput.trim() && !chatLoading ? 'pointer' : 'not-allowed', transition: 'all 0.15s', flexShrink: 0, minWidth: '42px' }}>
                        →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══════════ BRAIN DUMP TAB ════════════════════════════ */}
              {tab === 'dump' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {/* Dump sub-tabs */}
                  <div style={{ display: 'flex', gap: '4px', padding: '8px 12px', borderBottom: `1px solid ${tokens.border}`, flexShrink: 0 }}>
                    <button style={btnStyle(dumpTab === 'new')} onClick={() => { setDumpTab('new'); resetDump(); }}>◎ New Dump</button>
                    <button style={btnStyle(dumpTab === 'history')} onClick={() => setDumpTab('history')}>📋 History ({brainDumps.length})</button>
                  </div>

                  {/* Dump content area */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>

                    {dumpTab === 'history' && <HistoryTab brainDumps={brainDumps} uid={user.uid} />}

                    {dumpTab === 'new' && dumpView === 'input' && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                          <button onClick={toggleRecording} style={{ width: 52, height: 52, borderRadius: '50%', background: recording ? 'rgba(212,122,107,0.2)' : tokens.accentDim, border: `2px solid ${recording ? tokens.red : tokens.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', cursor: 'pointer', transition: 'all 0.2s' }} className={recording ? 'pulsing' : ''}>
                            {recording ? '⏹' : '🎤'}
                          </button>
                        </div>
                        {recording && <p style={{ textAlign: 'center', fontSize: '11px', color: tokens.red, marginBottom: '10px' }} className="pulsing">Recording… speak freely</p>}

                        <textarea value={dumpText} onChange={e => setDumpText(e.target.value)}
                          placeholder={"Start typing anything — don't filter yourself.\n\nMention creating a project? AI creates it.\nMention tasks? AI creates and links them."}
                          style={{ width: '100%', minHeight: '130px', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '10px', padding: '12px 14px', color: tokens.textPrimary, fontSize: '13px', lineHeight: 1.65, resize: 'vertical', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', transition: 'border-color 0.15s' }}
                          onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                          onBlur={e => e.target.style.borderColor = tokens.border}
                        />
                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', margin: '8px 0' }}>
                          {DUMP_TIPS.map(tip => (
                            <button key={tip} onClick={() => setDumpText(t => t + (t.trim() ? '\n\n' : '') + tip + ': ')}
                              style={{ fontSize: '10px', color: tokens.textSecondary, background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '99px', padding: '3px 10px', cursor: 'pointer', fontFamily: fonts.body }}
                              onMouseEnter={e => { e.target.style.borderColor = tokens.accent; e.target.style.color = tokens.accent; }}
                              onMouseLeave={e => { e.target.style.borderColor = tokens.border; e.target.style.color = tokens.textSecondary; }}
                            >{tip}</button>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button onClick={handleProcess} disabled={!dumpText.trim() || processing}
                            style={{ background: dumpText.trim() && !processing ? tokens.accent : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', padding: '9px 16px', color: dumpText.trim() && !processing ? '#0C0E12' : tokens.textMuted, fontSize: '13px', fontWeight: 700, cursor: dumpText.trim() && !processing ? 'pointer' : 'not-allowed', fontFamily: fonts.body, transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {processing ? <><Spinner size={12} /> Organizing…</> : '✦ Organize with AI'}
                          </button>
                          {dumpText.length > 0 && <span style={{ fontSize: '11px', color: tokens.textMuted }}>{dumpText.length} chars</span>}
                        </div>
                      </div>
                    )}

                    {dumpTab === 'new' && dumpView === 'taskReview' && (
                      <div>
                        <div style={{ marginBottom: '14px' }}>
                          <div style={{ fontSize: '10px', color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>Review Before Creating</div>
                          <div style={{ fontFamily: fonts.display, fontSize: '16px', fontWeight: 700, color: tokens.textPrimary }}>Tasks to Create</div>
                          <p style={{ fontSize: '11px', color: tokens.textSecondary, marginTop: '3px' }}>Edit or remove. Nothing written until you confirm.</p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                          {pendingTasks.map((task, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '8px' }}>
                              <button onClick={() => cyclePriority(i)} style={{ fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>{PRIORITY_EMOJI[task.priority] || '🟡'}</button>
                              <input value={task.title} onChange={e => updatePendingTask(i, 'title', e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', color: tokens.textPrimary, fontSize: '12px', outline: 'none', fontFamily: fonts.body, minWidth: 0 }} />
                              <span style={{ fontSize: '10px', color: tokens.textMuted, flexShrink: 0 }}>{task.estimatedMinutes || 30}m</span>
                              <button onClick={() => removePendingTask(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.red, fontSize: '13px', opacity: 0.6, fontFamily: fonts.body }}>✕</button>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={handleSkipTasks} style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '8px 12px', color: tokens.textMuted, fontSize: '12px', cursor: 'pointer', fontFamily: fonts.body }}>Skip tasks</button>
                          <button onClick={handleConfirmTasks} disabled={savingTasks} style={{ background: tokens.accent, border: 'none', borderRadius: '8px', padding: '8px 14px', color: '#0C0E12', fontSize: '12px', fontWeight: 700, cursor: savingTasks ? 'not-allowed' : 'pointer', fontFamily: fonts.body, display: 'flex', alignItems: 'center', gap: '5px' }}>
                            {savingTasks ? <><Spinner size={12} /> Saving…</> : `Confirm ${pendingTasks.length} task${pendingTasks.length !== 1 ? 's' : ''} →`}
                          </button>
                        </div>
                      </div>
                    )}

                    {dumpTab === 'new' && dumpView === 'results' && dumpResult && (
                      <div>
                        {/* Summary */}
                        <div style={{ padding: '12px 14px', background: tokens.accentDim, border: `1px solid rgba(200,169,110,0.2)`, borderRadius: '10px', marginBottom: '12px' }}>
                          <div style={{ fontSize: '9px', color: tokens.accent, fontWeight: 700, letterSpacing: '0.1em', marginBottom: '5px' }}>ANCHOR SUMMARY</div>
                          <div style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.6 }}>{dumpResult.summary}</div>
                        </div>

                        {(created.projects.length > 0 || created.tasks.length > 0) && (
                          <div style={{ padding: '10px 12px', background: tokens.greenDim, border: `1px solid rgba(109,191,158,0.2)`, borderRadius: '8px', marginBottom: '10px' }}>
                            <div style={{ fontSize: '9px', color: tokens.green, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>✓ CREATED</div>
                            {created.projects.length > 0 && <div style={{ fontSize: '12px', color: tokens.textPrimary, marginBottom: '3px' }}><span style={{ color: tokens.green }}>Projects: </span>{created.projects.join(', ')}</div>}
                            {created.tasks.length > 0 && <div style={{ fontSize: '12px', color: tokens.textPrimary }}><span style={{ color: tokens.green }}>Tasks: </span>{created.tasks.join(', ')}</div>}
                          </div>
                        )}

                        {dumpResult.mostUrgent && (
                          <div style={{ padding: '10px 12px', background: 'rgba(212,169,107,0.08)', border: `1px solid rgba(212,169,107,0.2)`, borderRadius: '8px', marginBottom: '10px', display: 'flex', gap: '8px' }}>
                            <span style={{ flexShrink: 0 }}>⚑</span>
                            <div>
                              <div style={{ fontSize: '9px', color: tokens.amber, fontWeight: 700, letterSpacing: '0.1em', marginBottom: '3px' }}>START HERE</div>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>{dumpResult.mostUrgent}</div>
                            </div>
                          </div>
                        )}

                        {/* Action items */}
                        {sortedActionItems.length > 0 && (
                          <div style={{ padding: '10px 12px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '8px', marginBottom: '10px' }}>
                            <div style={{ fontSize: '9px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>ACTION ITEMS</div>
                            {sortedActionItems.map((item, i) => {
                              const isUrgent = urgentSet.has(item);
                              const alreadyDone = tasksSent.includes(item) || createdTaskRefs.some(t => { const a = t.title.toLowerCase(), b = item.toLowerCase(); return a === b || b.includes(a) || a.includes(b); });
                              return (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px', marginBottom: '7px' }}>
                                  <div style={{ display: 'flex', gap: '5px', flex: 1 }}>
                                    <span style={{ color: isUrgent ? tokens.amber : tokens.accent, flexShrink: 0 }}>{isUrgent ? '⚑' : '→'}</span>
                                    <span style={{ fontSize: '12px', color: tokens.textPrimary }}>{item}</span>
                                  </div>
                                  {alreadyDone
                                    ? <span style={{ fontSize: '10px', color: tokens.green, flexShrink: 0 }}>✓</span>
                                    : <button onClick={() => sendTaskToInbox(item)} style={{ fontSize: '9px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '4px', padding: '2px 7px', cursor: 'pointer', flexShrink: 0, fontFamily: fonts.body }}>+ Task</button>
                                  }
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Emotional themes */}
                        {dumpResult.emotionalThemes?.length > 0 && (
                          <div style={{ padding: '10px 12px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '8px', marginBottom: '10px' }}>
                            <div style={{ fontSize: '9px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px' }}>EMOTIONAL THEMES</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {dumpResult.emotionalThemes.map((t, i) => <span key={i} style={{ fontSize: '10px', color: tokens.purple, background: tokens.purpleDim, padding: '2px 8px', borderRadius: '4px' }}>{t}</span>)}
                            </div>
                          </div>
                        )}

                        {/* Schedule builder CTA */}
                        <div style={{ padding: '12px', background: 'linear-gradient(135deg, rgba(91,143,212,0.07), rgba(91,143,212,0.03))', border: `1px solid rgba(91,143,212,0.18)`, borderRadius: '10px', marginBottom: '10px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, marginBottom: '3px' }}>Build a time-blocked schedule</div>

                          {/* Intent capture inline panel */}
                          {intentCapturing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                              <div>
                                <label style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '4px' }}>What's most important today?</label>
                                <input
                                  value={intent.topPriority}
                                  onChange={e => setIntent(i => ({ ...i, topPriority: e.target.value }))}
                                  placeholder="e.g. Finish the Wells Fargo docs, call Mike"
                                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '6px 9px', color: tokens.textPrimary, fontSize: '12px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }}
                                  onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                                  onBlur={e => e.target.style.borderColor = tokens.border}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '4px' }}>Anything to push off or avoid?</label>
                                <input
                                  value={intent.toDefer}
                                  onChange={e => setIntent(i => ({ ...i, toDefer: e.target.value }))}
                                  placeholder="e.g. Skip anything that can wait until next week"
                                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '6px 9px', color: tokens.textPrimary, fontSize: '12px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }}
                                  onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                                  onBlur={e => e.target.style.borderColor = tokens.border}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '4px' }}>Energy today</label>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  {[['low', '🔋 Low'], ['medium', '⚡ Medium'], ['high', '🔥 High']].map(([val, label]) => (
                                    <button key={val} onClick={() => setIntent(i => ({ ...i, energy: val }))}
                                      style={{ flex: 1, padding: '5px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body, border: `1px solid ${intent.energy === val ? tokens.accent : tokens.border}`, background: intent.energy === val ? tokens.accentDim : 'transparent', color: intent.energy === val ? tokens.accent : tokens.textMuted }}>
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                                <button onClick={() => setIntentCapturing(false)} style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '6px', padding: '6px 10px', color: tokens.textMuted, fontSize: '11px', cursor: 'pointer', fontFamily: fonts.body }}>Cancel</button>
                                <button onClick={() => handleBuildSchedule(intent)} disabled={scheduling} style={{ flex: 1, background: tokens.accent, border: 'none', borderRadius: '6px', padding: '6px 10px', color: '#0C0E12', fontSize: '12px', fontWeight: 700, cursor: scheduling ? 'not-allowed' : 'pointer', fontFamily: fonts.body, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                                  {scheduling ? <><Spinner size={12} /> Building…</> : '✦ Build Schedule'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '8px' }}>
                                {calendarConnected ? 'Reads your calendar + tasks, factors in priority and focus type.' : 'Connect Google Calendar on Life OS to unlock.'}
                              </div>
                              {calendarConnected
                                ? <button onClick={openIntentCapture} disabled={scheduling} style={{ background: tokens.accent, border: 'none', borderRadius: '7px', padding: '7px 12px', color: '#0C0E12', fontSize: '12px', fontWeight: 700, cursor: scheduling ? 'not-allowed' : 'pointer', fontFamily: fonts.body, display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    {scheduling ? <><Spinner size={12} /> Building…</> : '✦ Build My Schedule'}
                                  </button>
                                : <span style={{ fontSize: '11px', color: tokens.textMuted, fontStyle: 'italic' }}>Calendar not connected</span>
                              }
                            </>
                          )}
                          {scheduleError && <div style={{ fontSize: '11px', color: tokens.red, marginTop: '8px' }}>{scheduleError}</div>}
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={resetDump} style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '7px', padding: '7px 12px', color: tokens.textMuted, fontSize: '12px', cursor: 'pointer', fontFamily: fonts.body }}>← New Dump</button>
                          <button onClick={() => setDumpTab('history')} style={{ background: tokens.accentDim, border: 'none', borderRadius: '7px', padding: '7px 12px', color: tokens.accent, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}>View History →</button>
                          {dumpSaved && <span style={{ fontSize: '11px', color: tokens.green, alignSelf: 'center' }}>✓ Saved</span>}
                        </div>
                      </div>
                    )}

                    {dumpTab === 'new' && dumpView === 'schedule' && (
                      <div>
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ fontSize: '9px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '3px' }}>Proposed Schedule</div>
                          <p style={{ fontSize: '11px', color: tokens.textMuted }}>
                            {activeBlockCount === 0 ? 'No schedulable blocks.' : `${activeBlockCount} block${activeBlockCount !== 1 ? 's' : ''} ready. Reorder to adjust times.`}
                          </p>
                        </div>

                        {(() => {
                          let lastDay = null;
                          return scheduleBlocks.map((block, i) => {
                            if (!block.start) return null;
                            const showHeader = block.day !== lastDay;
                            lastDay = block.day;
                            return (
                              <React.Fragment key={i}>
                                {showHeader && <div style={{ fontSize: '9px', fontWeight: 700, color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '5px', marginTop: i > 0 ? '14px' : 0 }}>{block.day === 'today' ? `TODAY — ${scheduleDates.today}` : `TOMORROW — ${scheduleDates.tomorrow}`}</div>}
                                <ScheduleBlock block={block} index={i} isFirst={i === 0} isLast={i === scheduleBlocks.filter(b => b.start).length - 1}
                                  isEditing={editingBlockIdx === i} editForm={editForm}
                                  onEditStart={handleEditStart} onEditSave={handleEditSave} onEditCancel={handleEditCancel} onEditChange={handleEditChange}
                                  onDelete={handleDeleteBlock} onMoveUp={() => handleMoveBlock(i, 'up')} onMoveDown={() => handleMoveBlock(i, 'down')} />
                              </React.Fragment>
                            );
                          });
                        })()}

                        {scheduleBlocks.filter(b => !b.start).length > 0 && (
                          <div style={{ marginTop: '14px' }}>
                            <div style={{ fontSize: '9px', fontWeight: 700, color: tokens.red, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '5px' }}>COULDN'T SCHEDULE</div>
                            {scheduleBlocks.map((block, i) => block.start ? null : (
                              <ScheduleBlock key={i} block={block} index={i} isFirst={false} isLast={false}
                                isEditing={editingBlockIdx === i} editForm={editForm}
                                onEditStart={handleEditStart} onEditSave={handleEditSave} onEditCancel={handleEditCancel} onEditChange={handleEditChange}
                                onDelete={handleDeleteBlock} onMoveUp={() => {}} onMoveDown={() => {}} />
                            ))}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '8px', paddingTop: '12px', borderTop: `1px solid ${tokens.border}`, marginTop: '8px' }}>
                          <button onClick={() => setDumpView('results')} style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '7px', padding: '7px 12px', color: tokens.textMuted, fontSize: '12px', cursor: 'pointer', fontFamily: fonts.body }}>← Back</button>
                          <button onClick={handleConfirmSchedule} disabled={activeBlockCount === 0 || confirming} style={{ background: activeBlockCount > 0 ? tokens.accent : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '7px', padding: '7px 14px', color: activeBlockCount > 0 ? '#0C0E12' : tokens.textMuted, fontSize: '12px', fontWeight: 700, cursor: activeBlockCount > 0 && !confirming ? 'pointer' : 'not-allowed', fontFamily: fonts.body, display: 'flex', alignItems: 'center', gap: '5px' }}>
                            {confirming ? <><Spinner size={12} /> Confirming…</> : `Confirm ${activeBlockCount} item${activeBlockCount !== 1 ? 's' : ''} →`}
                          </button>
                        </div>
                      </div>
                    )}

                    {dumpTab === 'new' && dumpView === 'confirmed' && (
                      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
                        <div style={{ width: 48, height: 48, borderRadius: '50%', background: tokens.greenDim, border: `1px solid rgba(109,191,158,0.25)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', margin: '0 auto 12px' }}>✓</div>
                        <div style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: tokens.green, marginBottom: '6px' }}>Schedule locked in</div>
                        <div style={{ fontSize: '12px', color: tokens.textMuted, marginBottom: '20px' }}>{confirmedCount} block{confirmedCount !== 1 ? 's' : ''} added to Google Calendar.</div>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button onClick={resetDump} style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '7px', padding: '7px 12px', color: tokens.textMuted, fontSize: '12px', cursor: 'pointer', fontFamily: fonts.body }}>← New Dump</button>
                          <button onClick={() => setDumpTab('history')} style={{ background: tokens.accentDim, border: 'none', borderRadius: '7px', padding: '7px 12px', color: tokens.accent, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body }}>View History →</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Quick Capture Task Modal ── */}
      <TaskModal
        open={captureTaskOpen}
        onClose={() => { setCaptureTaskOpen(false); setCaptureDefaults({}); }}
        onSave={handleCaptureSave}
        defaultValues={captureDefaults}
        saving={captureSaving}
        modalTitle="New Task"
      />

      {/* ── Save to Task Note Modal ── */}
      <Modal open={saveToNoteModal.open} onClose={() => setSaveToNoteModal(m => ({ ...m, open: false }))} title="Save to Task Note">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Pick a Task</label>
            <select
              value={saveToNoteModal.taskId}
              onChange={e => setSaveToNoteModal(m => ({ ...m, taskId: e.target.value }))}
              autoFocus
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: saveToNoteModal.taskId ? tokens.textPrimary : tokens.textMuted, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
            >
              <option value="">Choose a task…</option>
              {tasks.filter(t => !t.done).map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>What to save <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(edit as needed)</span></label>
            <textarea
              value={saveToNoteModal.content}
              onChange={e => setSaveToNoteModal(m => ({ ...m, content: e.target.value }))}
              rows={5}
              style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '12px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.55 }}
              onFocus={e => e.target.style.borderColor = tokens.borderFocus}
              onBlur={e => e.target.style.borderColor = tokens.border}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => setSaveToNoteModal(m => ({ ...m, open: false }))}>Cancel</Button>
            <Button onClick={handleSaveToNote} loading={saveToNoteModal.saving} disabled={!saveToNoteModal.taskId || !saveToNoteModal.content.trim()}>
              Save to Note
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
