// src/components/screens/BrainDumpScreen.js
import React, { useState, useRef, useEffect } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { callAI, buildSchedule } from '../../lib/ai';
import { saveBrainDump, addTask, addProject, updateTask } from '../../lib/db';
import { getValidAccessToken, getEvents, getFreeSlots, createEvent, formatEventTime } from '../../lib/calendar';
import { Card, Button, SectionLabel, Tag, AICard } from '../ui';

// ─── Focus styles ─────────────────────────────────────────────────────────────

const focusStyles = {
  deep:   { bg: tokens.blueDim,  text: tokens.blue  },
  medium: { bg: tokens.amberDim, text: tokens.amber },
  quick:  { bg: tokens.greenDim, text: tokens.green },
};

const PRIORITY_CYCLE = { critical: 'high', high: 'medium', medium: 'low', low: 'critical' };
const PRIORITY_EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };

// ─── Time recalculation (cross-day) ───────────────────────────────────────────
// Packs ordered blocks greedily across today + tomorrow slots in sequence.
// Returns blocks with updated start/end/day. Blocks that don't fit get day:null.

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
        const start = new Date(cursor);
        const end   = new Date(cursor.getTime() + durationMs);
        result.push({ ...block, day: slot.day, start: start.toISOString(), end: end.toISOString() });
        cursor  = new Date(end.getTime() + BUFFER_MS);
        placed  = true;
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

// ─── Schedule block row ───────────────────────────────────────────────────────

function ScheduleBlock({
  block, index, totalBlocks,
  isEditing, editForm, onEditStart, onEditSave, onEditCancel, onEditChange,
  onDelete,
  isDragTarget,
  onDragStart, onDragOver, onDragEnd, onDrop,
}) {
  const fc = focusStyles[block.focusType] || focusStyles.medium;
  const unscheduled = !block.start;

  return (
    <div
      draggable={!isEditing && !unscheduled}
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDragEnd={onDragEnd}
      onDrop={(e) => { e.preventDefault(); onDrop(index); }}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '12px 14px', marginBottom: '6px',
        background: isDragTarget ? tokens.accentDim : unscheduled ? tokens.bgGlass : tokens.bgCard,
        border: `1px solid ${isDragTarget ? 'rgba(200,169,110,0.3)' : unscheduled ? 'rgba(255,255,255,0.04)' : tokens.border}`,
        borderRadius: tokens.radiusMd,
        opacity: unscheduled ? 0.45 : 1,
        cursor: isEditing || unscheduled ? 'default' : 'grab',
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      {/* Drag handle */}
      <div style={{ color: tokens.textMuted, fontSize: '15px', paddingTop: '3px', userSelect: 'none', flexShrink: 0, opacity: unscheduled ? 0.3 : 0.6 }}>⠿</div>

      {isEditing ? (
        /* ── Inline edit mode ── */
        <div style={{ flex: 1 }}>
          <input
            autoFocus
            value={editForm.title}
            onChange={e => onEditChange('title', e.target.value)}
            style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.borderFocus}`, borderRadius: tokens.radiusMd, padding: '8px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box', marginBottom: '8px' }}
          />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="number"
              min="5" max="480"
              value={editForm.durationMinutes}
              onChange={e => onEditChange('durationMinutes', Math.max(5, parseInt(e.target.value) || 30))}
              style={{ width: '70px', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusMd, padding: '6px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}
            />
            <span style={{ fontSize: '11px', color: tokens.textMuted }}>min</span>
            <Button size="sm" onClick={onEditSave} style={{ marginLeft: 'auto' }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={onEditCancel}>Cancel</Button>
          </div>
        </div>
      ) : (
        /* ── Normal display ── */
        <div style={{ flex: 1, minWidth: 0 }}>
          {unscheduled ? (
            <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '2px' }}>Couldn't fit in available slots</div>
          ) : (
            <div style={{ fontSize: '11px', color: tokens.textMuted, marginBottom: '3px' }}>
              {formatEventTime(block.start)} – {formatEventTime(block.end)} · {block.durationMinutes}m
            </div>
          )}
          <div style={{ fontSize: '14px', fontWeight: 600, color: unscheduled ? tokens.textSecondary : tokens.textPrimary, lineHeight: 1.35 }}>
            {block.taskTitle}
          </div>
          {block.reason && !unscheduled && (
            <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '3px', lineHeight: 1.4 }}>{block.reason}</div>
          )}
        </div>
      )}

      {!isEditing && (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0, paddingTop: '2px' }}>
          {!unscheduled && (
            <span style={{ fontSize: '10px', fontWeight: 700, color: fc.text, background: fc.bg, padding: '2px 8px', borderRadius: '4px' }}>
              {block.focusType}
            </span>
          )}
          <button
            onClick={() => onEditStart(index, block)}
            title="Edit"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.textMuted, fontSize: '13px', padding: '2px 4px', opacity: 0.7, fontFamily: fonts.body }}
          >✎</button>
          <button
            onClick={() => onDelete(index)}
            title="Remove"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.red, fontSize: '13px', padding: '2px 4px', opacity: 0.6, fontFamily: fonts.body }}
          >✕</button>
        </div>
      )}
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function BrainDumpScreen() {
  const { user }   = useAuth();
  const { projects, tasks, brainDumps, weeklyReviews, calendarIntegration } = useData();

  // View: 'input' | 'taskReview' | 'results' | 'schedule' | 'confirmed'
  const [view,        setView]        = useState('input');
  const [activeTab,   setActiveTab]   = useState('dump');

  // Dump state
  const [text,       setText]       = useState('');
  const [processing, setProcessing] = useState(false);
  const [result,     setResult]     = useState(null);
  const [recording,  setRecording]  = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [tasksSent,  setTasksSent]  = useState([]);

  // Task review state
  const [pendingTasks,  setPendingTasks]  = useState([]); // from AI, not yet written to Firestore
  const [freshProjects, setFreshProjects] = useState([]); // auto-created in this session
  const [savingTasks,   setSavingTasks]   = useState(false);
  const [createdTaskRefs, setCreatedTaskRefs] = useState([]);
  const [created,       setCreated]       = useState({ projects: [], tasks: [] });

  // Schedule state
  const [scheduling,        setScheduling]        = useState(false);
  const [scheduleBlocks,    setScheduleBlocks]    = useState([]);
  const [rawSlots,          setRawSlots]          = useState({ today: [], tomorrow: [] });
  const [scheduleError,     setScheduleError]     = useState('');
  const [confirming,        setConfirming]        = useState(false);
  const [confirmedCount,    setConfirmedCount]    = useState(0);
  const [scheduleDates,     setScheduleDates]     = useState({ today: '', tomorrow: '' });

  // Schedule block interaction
  const [editingBlockIndex, setEditingBlockIndex] = useState(null);
  const [editForm,          setEditForm]          = useState({ title: '', durationMinutes: 30 });
  const [dragOver,          setDragOver]          = useState(null);
  const dragItem = useRef(null);

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
estimatedMinutes: realistic time (15=quick call/email, 30=short task, 60=focused work, 90-120=deep/complex work).
BRAIN DUMP:\n${text}` }],
      maxTokens: 1000,
      systemExtra: 'Return ONLY valid JSON. No markdown fences.',
    });

    let parsed = null;
    try { const clean = (raw || '{}').replace(/```json|```/g, '').trim(); parsed = JSON.parse(clean); }
    catch { parsed = { summary: 'Your thoughts have been captured.', mostUrgent: null, categories: {}, actionItems: [], emotionalThemes: [], urgentFlags: [], newProjects: [], tasksToCreate: [] }; }

    // Auto-create projects immediately (no review needed)
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
    setFreshProjects(createdProjects);

    // Save brain dump to Firestore
    await saveBrainDump(user.uid, { rawText: text, result: parsed });
    setSaved(true);
    setResult(parsed);
    setProcessing(false);

    // Gate tasks on review — skip review if no tasks to create
    if (parsed.tasksToCreate?.length > 0) {
      setPendingTasks(parsed.tasksToCreate);
      setView('taskReview');
    } else {
      setCreated({ projects: createdProjects.map(p => p.title), tasks: [] });
      setView('results');
    }
  };

  // ─── Task review handlers ──────────────────────────────────────────────────

  const updatePendingTask = (index, field, value) =>
    setPendingTasks(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));

  const removePendingTask = (index) =>
    setPendingTasks(prev => prev.filter((_, i) => i !== index));

  const cyclePriority = (index) =>
    setPendingTasks(prev => prev.map((t, i) => i === index ? { ...t, priority: PRIORITY_CYCLE[t.priority] || 'medium' } : t));

  const handleConfirmTasks = async () => {
    setSavingTasks(true);
    const allProjects = [...projects, ...freshProjects];
    const createdTitles = [];
    const taskRefs = [];

    for (const task of pendingTasks) {
      if (!task.title?.trim()) continue;
      const matched = task.projectName ? allProjects.find(p => p.title.toLowerCase().includes(task.projectName.toLowerCase())) : null;
      const ref = await addTask(user.uid, {
        title:     task.title.trim(),
        priority:  task.priority || 'medium',
        project:   matched?.title || 'Inbox',
        projectId: matched?.id || null,
        source:    'brain-dump',
        energy:    'medium',
      });
      createdTitles.push(task.title.trim());
      taskRefs.push({ title: task.title.trim(), id: ref?.id || null, priority: task.priority || 'medium', estimatedMinutes: task.estimatedMinutes || 30 });
    }

    setCreatedTaskRefs(taskRefs);
    setCreated({ projects: freshProjects.map(p => p.title), tasks: createdTitles });
    setSavingTasks(false);
    setView('results');
  };

  const handleSkipTasks = () => {
    setCreated({ projects: freshProjects.map(p => p.title), tasks: [] });
    setView('results');
  };

  // ─── Build schedule ────────────────────────────────────────────────────────

  const handleBuildSchedule = async () => {
    if (scheduling) return;
    setScheduling(true);
    setScheduleError('');
    setScheduleBlocks([]);

    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      if (!token) { setScheduleError('Calendar not connected. Connect it on the Life OS screen first.'); return; }

      const todayDate    = new Date();
      const tomorrowDate = new Date(todayDate.getTime() + 86400000);

      const windowStart = new Date(todayDate); windowStart.setHours(0, 0, 0, 0);
      const windowEnd   = new Date(tomorrowDate); windowEnd.setHours(23, 59, 59, 999);

      const { events = [] } = await getEvents(token, windowStart.toISOString(), windowEnd.toISOString());

      // Clip today's slots to current time (round up to next 15 min)
      const rawTodaySlots = getFreeSlots(events, todayDate);
      const tomorrowSlots = getFreeSlots(events, tomorrowDate);
      const roundedNow    = new Date(Math.ceil(Date.now() / (15 * 60000)) * (15 * 60000));

      const todaySlots = rawTodaySlots.map(slot => {
        const slotEnd   = new Date(slot.end);
        const slotStart = new Date(slot.start);
        if (slotEnd <= roundedNow) return null;
        if (slotStart < roundedNow) {
          const newDuration = Math.round((slotEnd - roundedNow) / 60000);
          if (newDuration < 30) return null;
          return { ...slot, start: roundedNow.toISOString(), durationMins: newDuration };
        }
        return slot;
      }).filter(Boolean);

      if (!todaySlots.length && !tomorrowSlots.length) {
        setScheduleError('No free time slots found today or tomorrow. Your calendar looks packed.');
        return;
      }

      setRawSlots({ today: todaySlots, tomorrow: tomorrowSlots });

      // Focus profile from recent weekly reviews
      const recentReviews = weeklyReviews.slice(0, 4);
      const recentEnergy  = recentReviews.length
        ? Math.round(recentReviews.reduce((s, r) => s + (r.energyScore || 60), 0) / recentReviews.length)
        : 65;

      // Build combined task pool: brain dump tasks + unscheduled existing tasks
      const urgentSet     = new Set(result?.urgentFlags || []);
      const existingTasks = tasks
        .filter(t => !t.done && !t.scheduledStart)
        .map(t => ({ title: t.title, taskId: t.id, priority: t.priority || 'medium', estimatedMinutes: t.estimatedMinutes || 30 }));

      const rawTasks = [
        ...createdTaskRefs.map(t => ({ title: t.title, taskId: t.id, priority: t.priority, estimatedMinutes: t.estimatedMinutes })),
        ...(result?.actionItems || [])
          .filter(item => !createdTaskRefs.some(t => t.title === item))
          .map(item => ({ title: item, taskId: null, priority: urgentSet.has(item) ? 'high' : 'medium', estimatedMinutes: 30 })),
        ...existingTasks,
      ];

      // Deduplicate by taskId, then sort by priority
      const seen    = new Set();
      const allTasks = rawTasks.filter(t => {
        if (t.taskId && seen.has(t.taskId)) return false;
        if (t.taskId) seen.add(t.taskId);
        return true;
      }).sort((a, b) => {
        const rank = { critical: 0, high: 1, medium: 2, low: 3 };
        return (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2);
      });

      if (!allTasks.length) {
        setScheduleError('No tasks found to schedule. Confirm some tasks first or add tasks on the Tasks screen.');
        return;
      }

      const todayLabel    = todayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const tomorrowLabel = tomorrowDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

      console.log('[buildSchedule] sending', allTasks.length, 'tasks, today slots:', todaySlots.length, 'tomorrow slots:', tomorrowSlots.length);

      const data = await buildSchedule({
        tasks:        allTasks,
        slots:        { today: todaySlots, tomorrow: tomorrowSlots },
        focusProfile: { recentEnergy },
        today:        todayLabel,
        tomorrow:     tomorrowLabel,
      });

      if (!data) { setScheduleError('Schedule build failed. Try again.'); return; }

      setScheduleBlocks(data.schedule || []);
      setScheduleDates({ today: todayLabel, tomorrow: tomorrowLabel });
      setView('schedule');
    } catch (err) {
      console.error('Build schedule error:', err);
      setScheduleError('Something went wrong building your schedule.');
    } finally {
      setScheduling(false);
    }
  };

  // ─── Schedule block interaction ────────────────────────────────────────────

  const handleDragStart = (index) => { dragItem.current = index; };
  const handleDragOver  = (index) => { setDragOver(index); };
  const handleDragEnd   = () => { setDragOver(null); dragItem.current = null; };

  const handleDrop = (targetIndex) => {
    const from = dragItem.current;
    if (from === null || from === targetIndex) { setDragOver(null); return; }
    const newBlocks = [...scheduleBlocks];
    const [moved] = newBlocks.splice(from, 1);
    newBlocks.splice(targetIndex, 0, moved);
    setScheduleBlocks(recalculateTimes(newBlocks, rawSlots.today, rawSlots.tomorrow));
    dragItem.current = null;
    setDragOver(null);
  };

  const handleEditStart = (index, block) => {
    setEditingBlockIndex(index);
    setEditForm({ title: block.taskTitle, durationMinutes: block.durationMinutes });
  };

  const handleEditSave = () => {
    const newBlocks = scheduleBlocks.map((b, i) =>
      i === editingBlockIndex ? { ...b, taskTitle: editForm.title, durationMinutes: editForm.durationMinutes } : b
    );
    setScheduleBlocks(recalculateTimes(newBlocks, rawSlots.today, rawSlots.tomorrow));
    setEditingBlockIndex(null);
  };

  const handleEditCancel = () => setEditingBlockIndex(null);
  const handleEditChange = (field, value) => setEditForm(f => ({ ...f, [field]: value }));

  const handleDeleteBlock = (index) => {
    const newBlocks = scheduleBlocks.filter((_, i) => i !== index);
    setScheduleBlocks(recalculateTimes(newBlocks, rawSlots.today, rawSlots.tomorrow));
    if (editingBlockIndex === index) setEditingBlockIndex(null);
  };

  // ─── Confirm schedule ──────────────────────────────────────────────────────

  const handleConfirmSchedule = async () => {
    if (confirming) return;
    const active = scheduleBlocks.filter(b => b.start);
    if (!active.length) return;

    setConfirming(true);
    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone;

      await Promise.all(active.map(async (block) => {
        const calEvent       = await createEvent(token, {
          summary:     block.taskTitle,
          description: `Anchor schedule · ${block.focusType} focus`,
          start:       { dateTime: block.start, timeZone: tz },
          end:         { dateTime: block.end,   timeZone: tz },
        });
        const calendarEventId = calEvent?.id || null;

        if (block.taskId) {
          await updateTask(user.uid, block.taskId, { status: 'scheduled', scheduledStart: block.start, scheduledEnd: block.end, calendarEventId });
        } else {
          await addTask(user.uid, { title: block.taskTitle, priority: block.priority || 'medium', source: 'brain-dump', status: 'scheduled', scheduledStart: block.start, scheduledEnd: block.end, calendarEventId });
        }
      }));

      setConfirmedCount(active.length);
      setView('confirmed');
    } catch (err) {
      console.error('Confirm schedule error:', err);
    } finally {
      setConfirming(false);
    }
  };

  // ─── Misc ─────────────────────────────────────────────────────────────────

  const sendTaskToInbox = async (taskText) => {
    await addTask(user.uid, { title: taskText, priority: 'medium', project: 'Inbox', energy: 'medium', source: 'brain-dump' });
    setTasksSent(prev => [...prev, taskText]);
  };

  const reset = () => {
    setText(''); setResult(null); setSaved(false); setTasksSent([]);
    setPendingTasks([]); setFreshProjects([]); setSavingTasks(false);
    setCreatedTaskRefs([]); setCreated({ projects: [], tasks: [] });
    setScheduleBlocks([]); setRawSlots({ today: [], tomorrow: [] }); setScheduleError('');
    setConfirming(false); setConfirmedCount(0); setScheduleDates({ today: '', tomorrow: '' });
    setEditingBlockIndex(null); setDragOver(null);
    setView('input');
  };

  // ─── Derived ──────────────────────────────────────────────────────────────

  const tips      = ['What\'s stressing me', 'What I\'m avoiding', 'Tasks I need to do', 'New project ideas', 'Money worries', 'What\'s unresolved'];
  const catColors = { Work: { bg: tokens.blueDim, text: tokens.blue }, Money: { bg: tokens.redDim, text: tokens.red }, Family: { bg: tokens.purpleDim, text: tokens.purple }, Health: { bg: tokens.greenDim, text: tokens.green }, Home: { bg: tokens.amberDim, text: tokens.amber }, Ideas: { bg: tokens.accentDim, text: tokens.accent }, Emotional: { bg: tokens.purpleDim, text: tokens.purple }, Later: { bg: 'rgba(255,255,255,0.05)', text: tokens.textMuted } };

  const urgentSet          = new Set(result?.urgentFlags || []);
  const sortedActionItems  = [...(result?.actionItems || [])].sort((a, b) => (urgentSet.has(a) ? 0 : 1) - (urgentSet.has(b) ? 0 : 1));
  const calendarConnected  = !!calendarIntegration?.connected;
  const activeBlockCount   = scheduleBlocks.filter(b => b.start).length;
  const unscheduledBlocks  = scheduleBlocks.filter(b => !b.start);

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

      {activeTab === 'history' ? (
        <HistoryTab brainDumps={brainDumps} />

      ) : view === 'input' ? (
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

      ) : view === 'taskReview' ? (
        /* ── Task review ── */
        <div className="fade-in">
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '11px', color: tokens.textMuted, letterSpacing: '0.1em', marginBottom: '6px', textTransform: 'uppercase' }}>Review Before Creating</div>
            <h2 style={{ fontFamily: fonts.display, fontSize: '22px', fontWeight: 700, color: tokens.textPrimary, margin: 0 }}>Tasks to Create</h2>
            <p style={{ fontSize: '13px', color: tokens.textSecondary, marginTop: '4px' }}>Edit, remove, or change priority. Nothing is written until you confirm.</p>
          </div>

          {pendingTasks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: tokens.textMuted, fontSize: '13px', background: tokens.bgCard, borderRadius: tokens.radiusLg, border: `1px solid ${tokens.border}`, marginBottom: '20px' }}>
              All tasks removed.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {pendingTasks.map((task, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusMd }}>
                  <button
                    onClick={() => cyclePriority(i)}
                    title="Tap to change priority"
                    style={{ fontSize: '16px', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, padding: '0 2px' }}
                  >{PRIORITY_EMOJI[task.priority] || '🟡'}</button>
                  <input
                    value={task.title}
                    onChange={e => updatePendingTask(i, 'title', e.target.value)}
                    style={{ flex: 1, background: 'transparent', border: 'none', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, minWidth: 0 }}
                  />
                  <span style={{ fontSize: '11px', color: tokens.textMuted, flexShrink: 0, whiteSpace: 'nowrap' }}>{task.estimatedMinutes || 30}m</span>
                  <button onClick={() => removePendingTask(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: tokens.red, fontSize: '14px', opacity: 0.6, padding: '0 2px', flexShrink: 0, fontFamily: fonts.body }}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button onClick={handleSkipTasks} variant="ghost">Skip, no tasks</Button>
            <Button onClick={handleConfirmTasks} loading={savingTasks}>
              {pendingTasks.length === 0 ? 'Continue →' : `Confirm ${pendingTasks.length} Task${pendingTasks.length !== 1 ? 's' : ''} →`}
            </Button>
          </div>
        </div>

      ) : view === 'confirmed' ? (
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

      ) : view === 'schedule' ? (
        /* ── Schedule preview ── */
        <div className="fade-in">
          <div style={{ marginBottom: '16px' }}>
            <SectionLabel>Proposed Schedule</SectionLabel>
            <p style={{ fontSize: '13px', color: tokens.textMuted }}>
              {activeBlockCount === 0
                ? 'No schedulable blocks. Edit durations or go back.'
                : `${activeBlockCount} block${activeBlockCount !== 1 ? 's' : ''} ready. Drag to reorder — times update automatically.`}
            </p>
          </div>

          {/* Scheduled blocks */}
          {scheduleBlocks.filter(b => b.start).length > 0 && (() => {
            let lastDay = null;
            return scheduleBlocks.map((block, i) => {
              if (!block.start) return null;
              const showHeader = block.day !== lastDay;
              lastDay = block.day;
              return (
                <React.Fragment key={i}>
                  {showHeader && (
                    <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px', marginTop: i > 0 ? '20px' : 0 }}>
                      {block.day === 'today' ? `TODAY — ${scheduleDates.today}` : `TOMORROW — ${scheduleDates.tomorrow}`}
                    </div>
                  )}
                  <ScheduleBlock
                    block={block} index={i} totalBlocks={scheduleBlocks.length}
                    isEditing={editingBlockIndex === i}
                    editForm={editForm}
                    onEditStart={handleEditStart} onEditSave={handleEditSave}
                    onEditCancel={handleEditCancel} onEditChange={handleEditChange}
                    onDelete={handleDeleteBlock}
                    isDragTarget={dragOver === i}
                    onDragStart={handleDragStart} onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd} onDrop={handleDrop}
                  />
                </React.Fragment>
              );
            });
          })()}

          {/* Unscheduled blocks */}
          {unscheduledBlocks.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.red, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
                COULDN'T SCHEDULE ({unscheduledBlocks.length})
              </div>
              {scheduleBlocks.map((block, i) => {
                if (block.start) return null;
                return (
                  <ScheduleBlock
                    key={i} block={block} index={i} totalBlocks={scheduleBlocks.length}
                    isEditing={editingBlockIndex === i}
                    editForm={editForm}
                    onEditStart={handleEditStart} onEditSave={handleEditSave}
                    onEditCancel={handleEditCancel} onEditChange={handleEditChange}
                    onDelete={handleDeleteBlock}
                    isDragTarget={dragOver === i}
                    onDragStart={handleDragStart} onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd} onDrop={handleDrop}
                  />
                );
              })}
              <p style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '6px' }}>Shorten their duration or remove to free them up.</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', paddingTop: '16px', borderTop: `1px solid ${tokens.border}`, marginTop: '8px' }}>
            <Button onClick={() => setView('results')} variant="ghost">← Back</Button>
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
              <div style={{ fontSize: '11px', color: tokens.green, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>✓ CREATED</div>
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
            {sortedActionItems.length > 0 && (
              <Card>
                <SectionLabel>Action Items</SectionLabel>
                {sortedActionItems.map((item, i) => {
                  const isUrgent = urgentSet.has(item);
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', gap: '6px', flex: 1, alignItems: 'flex-start' }}>
                        <span style={{ color: isUrgent ? tokens.amber : tokens.accent, flexShrink: 0 }}>{isUrgent ? '⚑' : '→'}</span>
                        <span style={{ fontSize: '13px', color: tokens.textPrimary }}>{item}</span>
                      </div>
                      {tasksSent.includes(item) || createdTaskRefs.some(t => t.title === item)
                        ? <span style={{ fontSize: '10px', color: tokens.green, flexShrink: 0 }}>✓</span>
                        : <button onClick={() => sendTaskToInbox(item)} style={{ fontSize: '10px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', flexShrink: 0, fontFamily: fonts.body }}>+ Task</button>
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
                    ? 'Reads your calendar + existing tasks, factors in priority and focus time, lays out your day.'
                    : 'Connect Google Calendar on the Life OS screen to unlock scheduling.'}
                </div>
              </div>
              {calendarConnected
                ? <Button onClick={handleBuildSchedule} loading={scheduling} disabled={scheduling}>{scheduling ? 'Building…' : '✦ Build My Schedule'}</Button>
                : <span style={{ fontSize: '11px', color: tokens.textMuted, fontStyle: 'italic' }}>Calendar not connected</span>
              }
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
