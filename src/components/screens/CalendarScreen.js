// src/components/screens/CalendarScreen.js
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import {
  getValidAccessToken, getEvents, createEvent, deleteEvent, updateEvent,
  formatEventTime, initiateCalendarAuth, getFreeSlots,
} from '../../lib/calendar';
import { Button, Modal, Input, Spinner, priorityColors } from '../ui';
import { updateTask } from '../../lib/db';
import PlanScheduleFlow from './PlanScheduleFlow';

const HOUR_HEIGHT = 60;
const GRID_START  = 6;
const GRID_END    = 22;
const HOURS = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i);
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_LOWER = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];

const EVENT_PALETTE = [
  { bg: 'rgba(91,143,212,0.88)',  border: '#5B8FD4',  text: '#fff' },
  { bg: 'rgba(109,191,158,0.88)', border: '#6DBF9E',  text: '#fff' },
  { bg: 'rgba(155,133,201,0.88)', border: '#9B85C9',  text: '#fff' },
  { bg: 'rgba(212,169,107,0.88)', border: '#D4A96B',  text: '#fff' },
  { bg: 'rgba(212,122,107,0.88)', border: '#D47A6B',  text: '#fff' },
];

function eventColor(ev, idx) {
  if (ev._anchor) return { bg: 'rgba(200,169,110,0.88)', border: '#C8A96E', text: '#0C0E12' };
  const cid = parseInt(ev.colorId, 10);
  if (!isNaN(cid)) return EVENT_PALETTE[(cid - 1) % EVENT_PALETTE.length] || EVENT_PALETTE[0];
  return EVENT_PALETTE[idx % EVENT_PALETTE.length];
}

function weekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekDays(ws) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i); return d;
  });
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function minsToTop(totalMins) {
  return ((totalMins - GRID_START * 60) / 60) * HOUR_HEIGHT;
}

function fmtHour(h) {
  if (h === 0)  return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}



function localISO(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isWorkDay(date, workHours) {
  if (!workHours) return true;
  const name = DAY_NAMES_LOWER[date.getDay()];
  return workHours[name]?.enabled !== false;
}

// Greedy column layout for overlapping events
function layoutDay(events) {
  if (!events.length) return [];
  const sorted = [...events].sort(
    (a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime)
  );
  const cols = [];
  const assigned = sorted.map((ev) => {
    const s = new Date(ev.start.dateTime).getTime();
    let col = 0;
    while (cols[col] && new Date(sorted[cols[col][cols[col].length - 1]].end.dateTime).getTime() > s) col++;
    if (!cols[col]) cols[col] = [];
    cols[col].push(sorted.indexOf(ev));
    return col;
  });
  return sorted.map((ev, i) => {
    const s = new Date(ev.start.dateTime).getTime();
    const e = new Date(ev.end.dateTime).getTime();
    let maxCol = assigned[i];
    sorted.forEach((other, j) => {
      const os = new Date(other.start.dateTime).getTime();
      const oe = new Date(other.end.dateTime).getTime();
      if (s < oe && e > os) maxCol = Math.max(maxCol, assigned[j]);
    });
    return { ...ev, _col: assigned[i], _totalCols: maxCol + 1 };
  });
}

export default function CalendarScreen() {
  const { user }                                               = useAuth();
  const { calendarIntegration, tasks, userProfile, projects } = useData();
  const [ws, setWs]                    = useState(() => weekStart(new Date()));
  const [events, setEvents]            = useState([]);
  const [loading, setLoading]          = useState(false);
  const [fetchError, setFetchError]    = useState('');
  const [isMobile, setIsMobile]        = useState(window.innerWidth < 768);
  const [mobileDay, setMobileDay]      = useState(new Date());
  const [createOpen, setCreateOpen]    = useState(false);
  const [newEv, setNewEv]              = useState({ title: '', start: '', end: '', description: '' });
  const [saving, setSaving]            = useState(false);
  const [detail, setDetail]            = useState(null);
  const [deleting, setDeleting]        = useState(false);
  const [planOpen, setPlanOpen]        = useState(false);
  const [sidebarOpen, setSidebarOpen]  = useState(true);
  const [conflicts, setConflicts]      = useState([]);
  // Task edit modal
  const [editingTask, setEditingTask]  = useState(null);
  const [editForm, setEditForm]        = useState({});
  const [editSaving, setEditSaving]    = useState(false);
  // Drag from sidebar
  const [dragOverInfo, setDragOverInfo]   = useState(null); // { dayIndex, mins }
  const [dragNoSlot, setDragNoSlot]       = useState('');
  // Auto-schedule
  const [autoScheduling, setAutoScheduling] = useState(new Set());
  // Work hours warning
  const [workHoursWarning, setWorkHoursWarning] = useState(null); // { task, day, mins }

  const scrollRef               = useRef(null);
  const fetched                 = useRef(new Set());
  const dragRef                 = useRef(null);
  const tasksRef                = useRef(tasks);
  const draggedSidebarTask      = useRef(null);
  const isDraggingFromSidebar   = useRef(false);
  const [dragState, setDragState] = useState(null);

  const yesterdayStr = ymd(new Date(Date.now() - 86400000));

  useEffect(() => {
    const fn = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
    };
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = (8 - GRID_START) * HOUR_HEIGHT;
  }, []);

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // ── Unscheduled tasks for sidebar ─────────────────────────────────────────
  // Show tasks that have no time slot yet (no scheduledStart), regardless of whether
  // they have a date. A task with a date but no time needs to be dragged onto the grid.
  const unscheduledTasks = useMemo(() => tasks
    .filter(t => {
      if (t.done) return false;
      if (t.scheduledStart) return false; // has a time → shows on grid
      return true;
    })
    .sort((a, b) => {
      const po = { critical: 0, high: 1, medium: 2, low: 3 };
      return (po[a.priority] ?? 9) - (po[b.priority] ?? 9);
    }),
  [tasks]);

  // ── Task-derived calendar blocks (tasks with a scheduled time slot) ────────
  const taskCalEvents = useMemo(() => {
    const wsEnd = new Date(ws); wsEnd.setDate(wsEnd.getDate() + 7);
    const gcalIds = new Set(events.map(e => e.id));
    return tasks
      .filter(t => !t.done && t.scheduledStart && t.scheduledEnd)
      .filter(t => !t.calendarEventId || !gcalIds.has(t.calendarEventId))
      .filter(t => {
        const s = new Date(t.scheduledStart);
        return s >= ws && s < wsEnd;
      })
      .map(t => ({
        id: `task-${t.id}`,
        _taskId: t.id,
        _isTask: true,
        _anchor: true,
        summary: t.title,
        priority: t.priority,
        start: { dateTime: t.scheduledStart },
        end:   { dateTime: t.scheduledEnd },
      }));
  }, [tasks, ws, events]);

  // ── Drag-to-reschedule existing calendar events ────────────────────────────
  const onEventMouseDown = useCallback((e, ev) => {
    if (isMobile || !ev.start?.dateTime || isDraggingFromSidebar.current) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { event: ev, startY: e.clientY, hasMoved: false };
    setDragState({ eventId: ev.id, deltaMins: 0 });
  }, [isMobile]);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragRef.current) return;
      const deltaY = e.clientY - dragRef.current.startY;
      if (Math.abs(deltaY) > 4) dragRef.current.hasMoved = true;
      const deltaMins = Math.round(deltaY / 15) * 15;
      setDragState(prev => prev ? { ...prev, deltaMins } : null);
    };

    const onMouseUp = async (e) => {
      if (!dragRef.current) return;
      const ref = dragRef.current;
      dragRef.current = null;
      const rawDelta  = e.clientY - ref.startY;
      const deltaMins = Math.round(rawDelta / 15) * 15;
      setDragState(null);
      if (!ref.hasMoved || deltaMins === 0) return;

      const ev       = ref.event;
      const newStart = new Date(new Date(ev.start.dateTime).getTime() + deltaMins * 60000);
      const newEnd   = new Date(new Date(ev.end.dateTime).getTime()   + deltaMins * 60000);

      setEvents(prev => prev.map(e =>
        e.id === ev.id
          ? { ...e, start: { dateTime: newStart.toISOString() }, end: { dateTime: newEnd.toISOString() } }
          : e
      ));

      try {
        const token = await getValidAccessToken(user.uid, calendarIntegration);
        if (token) {
          await updateEvent(token, ev.id, {
            start: { dateTime: newStart.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
            end:   { dateTime: newEnd.toISOString(),   timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          });
        }
        const linkedTask = (tasksRef.current || []).find(t => t.calendarEventId === ev.id);
        if (linkedTask) {
          await updateTask(user.uid, linkedTask.id, {
            scheduledDate:  newStart.toISOString().split('T')[0],
            scheduledStart: newStart.toISOString(),
            scheduledEnd:   newEnd.toISOString(),
          });
        }
      } catch (err) {
        console.error('Drag reschedule failed:', err);
        setEvents(prev => prev.map(e => e.id === ev.id ? ev : e));
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };
  }, [user, calendarIntegration]);

  // ── Phase 2: sync-on-open ──────────────────────────────────────────────────
  const syncTasksWithEvents = useCallback(async (fetchedEvents) => {
    const linked = (tasksRef.current || []).filter(t => t.calendarEventId && t.scheduledStart);
    for (const task of linked) {
      const ev = fetchedEvents.find(e => e.id === task.calendarEventId);
      if (!ev?.start?.dateTime) continue;
      const newStart = ev.start.dateTime;
      const newEnd   = ev.end?.dateTime;
      if (newStart !== task.scheduledStart || newEnd !== task.scheduledEnd) {
        try {
          await updateTask(user.uid, task.id, {
            scheduledDate:  newStart.split('T')[0],
            scheduledStart: newStart,
            scheduledEnd:   newEnd,
          });
        } catch (err) {
          console.error('Sync task error:', err);
        }
      }
    }

    const detected = [];
    const anchorTasks = (tasksRef.current || []).filter(t => t.calendarEventId && t.scheduledStart && t.scheduledEnd);
    for (const ev of fetchedEvents.filter(e => !e._anchor && e.start?.dateTime)) {
      const evStart = new Date(ev.start.dateTime).getTime();
      const evEnd   = new Date(ev.end?.dateTime || ev.start.dateTime).getTime();
      for (const task of anchorTasks) {
        const tStart = new Date(task.scheduledStart).getTime();
        const tEnd   = new Date(task.scheduledEnd).getTime();
        if (evStart < tEnd && evEnd > tStart) detected.push({ event: ev, task });
      }
    }
    if (detected.length > 0) setConflicts(detected);
  }, [user]);

  const fetchWeek = useCallback(async (start) => {
    const key = start.toISOString();
    if (fetched.current.has(key) || !calendarIntegration?.connected) return;
    setLoading(true);
    setFetchError('');
    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      if (!token) { setFetchError('Not connected'); return; }
      const end = new Date(start); end.setDate(end.getDate() + 7);
      const { events: raw } = await getEvents(token, start.toISOString(), end.toISOString());
      fetched.current.add(key);
      setEvents(prev => {
        const outside = prev.filter(e => {
          const d = new Date(e.start?.dateTime || e.start?.date);
          return d < start || d >= end;
        });
        return [...outside, ...(raw || [])];
      });
      syncTasksWithEvents(raw || []);
    } catch {
      setFetchError('Could not load events');
    } finally {
      setLoading(false);
    }
  }, [user, calendarIntegration, syncTasksWithEvents]);

  useEffect(() => { fetchWeek(ws); }, [ws, fetchWeek]);

  // ── Task edit ─────────────────────────────────────────────────────────────
  const openEdit = (task) => {
    setEditingTask(task);
    setEditForm({
      title:              task.title || '',
      priority:           task.priority || 'medium',
      dueDate:            task.dueDate || '',
      estimatedMinutes:   task.estimatedMinutes || '',
      notes:              task.notes || '',
      project:            task.project || 'Inbox',
      projectId:          task.projectId || null,
    });
  };

  const handleEditSave = async () => {
    if (!editingTask || !editForm.title.trim()) return;
    setEditSaving(true);
    const linked = (projects || []).find(p => p.title === editForm.project);
    try {
      await updateTask(user.uid, editingTask.id, {
        title:            editForm.title.trim(),
        priority:         editForm.priority,
        dueDate:          editForm.dueDate || null,
        estimatedMinutes: editForm.estimatedMinutes ? Number(editForm.estimatedMinutes) : null,
        notes:            editForm.notes,
        project:          editForm.project,
        projectId:        linked?.id || editForm.projectId || null,
      });
      setEditingTask(null);
    } catch (err) {
      console.error('Edit save error:', err);
    } finally {
      setEditSaving(false);
    }
  };

  // ── Auto-schedule single task ──────────────────────────────────────────────
  const handleAutoSchedule = async (task) => {
    setAutoScheduling(prev => new Set([...prev, task.id]));
    setDragNoSlot('');

    try {
      const workHours = userProfile?.workHours || null;
      const todayDate = new Date();
      const tomDate   = new Date(todayDate); tomDate.setDate(tomDate.getDate() + 1);

      const todayEvs = events.filter(e => e.start?.dateTime?.startsWith(ymd(todayDate)));
      const tomEvs   = events.filter(e => e.start?.dateTime?.startsWith(ymd(tomDate)));

      const todaySlots = getFreeSlots(todayEvs, todayDate.toISOString(), workHours);
      const tomSlots   = getFreeSlots(tomEvs,   tomDate.toISOString(),   workHours);

      const needed = task.estimatedMinutes || 45;
      const slot   = [...todaySlots, ...tomSlots].find(s => s.durationMins >= needed);

      if (!slot) {
        setDragNoSlot(`No free slot found for "${task.title}" today or tomorrow.`);
        setTimeout(() => setDragNoSlot(''), 4000);
        return;
      }

      const start = new Date(slot.start);
      const end   = new Date(start.getTime() + needed * 60000);

      await updateTask(user.uid, task.id, {
        status:         'scheduled',
        scheduledDate:  ymd(start),
        scheduledStart: start.toISOString(),
        scheduledEnd:   end.toISOString(),
      });
    } finally {
      setAutoScheduling(prev => { const n = new Set(prev); n.delete(task.id); return n; });
    }
  };

  // ── Drag from sidebar ──────────────────────────────────────────────────────
  const handleSidebarDragStart = (e, task) => {
    draggedSidebarTask.current = task;
    isDraggingFromSidebar.current = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
  };

  const handleSidebarDragEnd = () => {
    draggedSidebarTask.current = null;
    isDraggingFromSidebar.current = false;
    setDragOverInfo(null);
  };

  const handleCalendarDragOver = useCallback((e, dayIndex, day) => {
    if (!isDraggingFromSidebar.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const y    = e.clientY - rect.top;
    const rawMins  = Math.floor((y / HOUR_HEIGHT) * 60) + GRID_START * 60;
    const snapped  = Math.max(GRID_START * 60, Math.min(GRID_END * 60 - 30, Math.round(rawMins / 15) * 15));
    setDragOverInfo({ dayIndex, day, mins: snapped });
  }, []);

  const handleCalendarDrop = useCallback(async (e, dayIndex, day) => {
    e.preventDefault();
    const task = draggedSidebarTask.current;
    if (!task) return;

    draggedSidebarTask.current = null;
    isDraggingFromSidebar.current = false;

    const rect = e.currentTarget.getBoundingClientRect();
    const y    = e.clientY - rect.top;
    const rawMins = Math.floor((y / HOUR_HEIGHT) * 60) + GRID_START * 60;
    const mins    = Math.max(GRID_START * 60, Math.min(GRID_END * 60 - 30, Math.round(rawMins / 15) * 15));

    setDragOverInfo(null);

    // Warn if dropped on a non-work day
    const wh = userProfile?.workHours;
    if (wh && !isWorkDay(day, wh)) {
      setWorkHoursWarning({ task, day, mins });
      return;
    }

    await scheduleTaskAtSlot(task, day, mins);
  }, [userProfile]); // eslint-disable-line

  const scheduleTaskAtSlot = async (task, day, mins) => {
    const start = new Date(day);
    start.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    const end = new Date(start.getTime() + (task.estimatedMinutes || 45) * 60000);

    await updateTask(user.uid, task.id, {
      status:         'scheduled',
      scheduledDate:  ymd(start),
      scheduledStart: start.toISOString(),
      scheduledEnd:   end.toISOString(),
    });
  };

  const confirmWorkHoursOverride = async () => {
    if (!workHoursWarning) return;
    const { task, day, mins } = workHoursWarning;
    setWorkHoursWarning(null);
    await scheduleTaskAtSlot(task, day, mins);
  };

  const days    = weekDays(ws);
  const today   = new Date();
  const visible = isMobile ? [mobileDay] : days;

  const timedForDay = (day) => [
    ...events.filter(e => e.start?.dateTime && sameDay(new Date(e.start.dateTime), day)),
    ...taskCalEvents.filter(e => sameDay(new Date(e.start.dateTime), day)),
  ];
  const allDayForDay = (day) => events.filter(e => !e.start?.dateTime && e.start?.date && sameDay(new Date(e.start.date + 'T12:00:00'), day));

  const prevPeriod = () => {
    const d = new Date(ws); d.setDate(d.getDate() - 7); setWs(d);
    if (isMobile) { const m = new Date(mobileDay); m.setDate(m.getDate() - 1); setMobileDay(m); }
  };
  const nextPeriod = () => {
    const d = new Date(ws); d.setDate(d.getDate() + 7); setWs(d);
    if (isMobile) { const m = new Date(mobileDay); m.setDate(m.getDate() + 1); setMobileDay(m); }
  };
  const goToday = () => { setWs(weekStart(new Date())); setMobileDay(new Date()); };

  const openCreate = (day, hour, minute = 0) => {
    const s = new Date(day); s.setHours(hour, minute, 0, 0);
    const e = new Date(s);   e.setHours(hour + 1, minute, 0, 0);
    setNewEv({ title: '', start: localISO(s), end: localISO(e), description: '' });
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!newEv.title.trim()) return;
    setSaving(true);
    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      if (!token) return;
      await createEvent(token, {
        summary: newEv.title.trim(),
        description: newEv.description,
        start: { dateTime: new Date(newEv.start).toISOString() },
        end:   { dateTime: new Date(newEv.end).toISOString() },
      });
      setCreateOpen(false);
      setNewEv({ title: '', start: '', end: '', description: '' });
      fetched.current.delete(ws.toISOString());
      fetchWeek(ws);
    } catch (err) {
      console.error('Create event error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    setDeleting(true);
    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      if (token) await deleteEvent(token, detail.id);
      setEvents(prev => prev.filter(e => e.id !== detail.id));
      setDetail(null);
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setDeleting(false);
    }
  };

  const gridHeight = (GRID_END - GRID_START) * HOUR_HEIGHT;
  const nowMins    = today.getHours() * 60 + today.getMinutes();
  const nowTop     = minsToTop(nowMins);
  const showNow    = nowMins >= GRID_START * 60 && nowMins < GRID_END * 60;

  const monthLabel = (() => {
    const a = days[0]; const b = days[6];
    if (a.getMonth() === b.getMonth())
      return a.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    return `${a.toLocaleString('en-US', { month: 'short' })} – ${b.toLocaleString('en-US', { month: 'short', year: 'numeric' })}`;
  })();

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!calendarIntegration?.connected) {
    return (
      <div style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center', padding: '0 16px' }}>
        <div style={{ fontSize: '40px', marginBottom: '16px', opacity: 0.6 }}>📅</div>
        <h1 style={{ fontFamily: fonts.display, fontSize: '24px', fontWeight: 700, color: tokens.textPrimary, marginBottom: '10px' }}>
          Connect Google Calendar
        </h1>
        <p style={{ color: tokens.textSecondary, fontSize: '14px', lineHeight: 1.65, marginBottom: '24px' }}>
          Link your Google Calendar to view, create, and manage events directly in Anchor — synced in both directions.
        </p>
        <Button onClick={() => initiateCalendarAuth(user.uid)}>Connect Google Calendar</Button>
      </div>
    );
  }

  const allDayEvs = visible.flatMap(d => allDayForDay(d));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: isMobile ? 'calc(100vh - 170px)' : 'calc(100vh - 110px)' }}>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexShrink: 0, gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isMobile && (
            <button onClick={() => setSidebarOpen(o => !o)}
              style={{ background: sidebarOpen ? tokens.accentDim : tokens.bgCard, border: `1px solid ${sidebarOpen ? tokens.accent : tokens.border}`, color: sidebarOpen ? tokens.accent : tokens.textMuted, borderRadius: '7px', padding: '5px 9px', cursor: 'pointer', fontSize: '13px', fontFamily: fonts.body, lineHeight: 1, transition: 'all 0.15s' }}>
              ☰
            </button>
          )}
          <h1 style={{ fontFamily: fonts.display, fontSize: isMobile ? '18px' : '22px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0, whiteSpace: 'nowrap' }}>
            {isMobile
              ? mobileDay.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
              : monthLabel}
          </h1>
          {loading && <Spinner size={13} />}
          {fetchError && <span style={{ fontSize: '11px', color: tokens.red }}>{fetchError}</span>}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button onClick={() => setPlanOpen(true)} variant="accent" size="sm">✦ Plan Schedule</Button>
          <Button onClick={goToday} variant="ghost" size="sm">Today</Button>
          <button onClick={prevPeriod}
            style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, color: tokens.textSecondary, borderRadius: '7px', padding: '5px 11px', cursor: 'pointer', fontSize: '13px', fontFamily: fonts.body, lineHeight: 1 }}>‹</button>
          <button onClick={nextPeriod}
            style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, color: tokens.textSecondary, borderRadius: '7px', padding: '5px 11px', cursor: 'pointer', fontSize: '13px', fontFamily: fonts.body, lineHeight: 1 }}>›</button>
          <Button size="sm" onClick={() => { const n = new Date(); openCreate(n, n.getHours() + 1); }}>+ Event</Button>
        </div>
      </div>

      {/* ── Conflict banner ── */}
      {conflicts.length > 0 && (
        <div style={{ background: tokens.amberDim, border: `1px solid ${tokens.amber}`, borderRadius: '8px', padding: '8px 14px', marginBottom: '8px', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: tokens.amber, fontWeight: 600 }}>
            ⚑ {conflicts.length} scheduling conflict{conflicts.length > 1 ? 's' : ''} detected — calendar events overlap task blocks
          </span>
          <button onClick={() => setConflicts([])} style={{ background: 'none', border: 'none', color: tokens.amber, cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}>×</button>
        </div>
      )}

      {/* ── No-slot toast ── */}
      {dragNoSlot && (
        <div style={{ background: tokens.redDim, border: `1px solid ${tokens.red}`, borderRadius: '8px', padding: '8px 14px', marginBottom: '8px', flexShrink: 0, fontSize: '12px', color: tokens.red, fontWeight: 600 }}>
          {dragNoSlot}
        </div>
      )}

      {/* ── Main layout: sidebar + calendar ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Sidebar ── */}
        {!isMobile && sidebarOpen && (
          <div style={{
            width: 260, flexShrink: 0, borderRight: `1px solid ${tokens.border}`,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: tokens.bgCard,
          }}>
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${tokens.border}` }}>
              <Button onClick={() => setPlanOpen(true)} style={{ width: '100%', justifyContent: 'center' }}>
                ✦ Plan My Schedule
              </Button>
            </div>
            <div style={{ padding: '6px 14px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${tokens.border}` }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.textMuted }}>
                Unscheduled · {unscheduledTasks.length}
              </div>
              <span style={{ fontSize: '10px', color: tokens.textMuted }}>drag to place</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {unscheduledTasks.length === 0 && (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: tokens.textMuted, fontSize: '12px' }}>
                  All tasks scheduled ✓
                </div>
              )}
              {unscheduledTasks.slice(0, 60).map(task => {
                const pc      = priorityColors[task.priority] || {};
                const overdue = task.scheduledDate && task.scheduledDate < yesterdayStr;
                const yest    = task.scheduledDate === yesterdayStr;
                const isAutoSched = autoScheduling.has(task.id);

                return (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={e => handleSidebarDragStart(e, task)}
                    onDragEnd={handleSidebarDragEnd}
                    style={{
                      padding: '9px 12px', borderBottom: `1px solid ${tokens.border}`,
                      cursor: 'grab', userSelect: 'none',
                      opacity: isAutoSched ? 0.5 : 1,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = tokens.bgCardHover}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                      <div style={{ fontSize: '12px', color: tokens.textPrimary, fontWeight: 500, lineHeight: 1.35, flex: 1, minWidth: 0 }}>
                        {task.title}
                      </div>
                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                        <button
                          onClick={() => openEdit(task)}
                          title="Edit task"
                          style={{ background: 'none', border: `1px solid ${tokens.border}`, color: tokens.textMuted, borderRadius: '5px', padding: '2px 6px', cursor: 'pointer', fontSize: '10px', lineHeight: 1.2, fontFamily: fonts.body }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.accent; e.currentTarget.style.color = tokens.accent; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = tokens.textMuted; }}
                        >✎</button>
                        <button
                          onClick={() => handleAutoSchedule(task)}
                          disabled={isAutoSched}
                          title="Auto-schedule in next free slot"
                          style={{ background: 'none', border: `1px solid ${tokens.border}`, color: tokens.textMuted, borderRadius: '5px', padding: '2px 6px', cursor: isAutoSched ? 'default' : 'pointer', fontSize: '10px', lineHeight: 1.2, fontFamily: fonts.body }}
                          onMouseEnter={e => { if (!isAutoSched) { e.currentTarget.style.borderColor = tokens.green; e.currentTarget.style.color = tokens.green; }}}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = tokens.textMuted; }}
                        >{isAutoSched ? '…' : '⚡'}</button>
                      </div>
                    </div>
                    {/* Metadata row */}
                    <div style={{ display: 'flex', gap: '5px', marginTop: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: pc.bg || tokens.accentDim, color: pc.text || tokens.accent, fontWeight: 700, textTransform: 'uppercase' }}>
                        {task.priority}
                      </span>
                      {task.estimatedMinutes && (
                        <span style={{ fontSize: '9px', color: tokens.textMuted }}>⏱ {task.estimatedMinutes}m</span>
                      )}
                      {task.dueDate && (
                        <span style={{ fontSize: '9px', color: new Date(task.dueDate + 'T12:00:00') < today ? tokens.red : tokens.textMuted }}>
                          due {new Date(task.dueDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {yest    && <span style={{ fontSize: '9px', color: tokens.amber, fontWeight: 600 }}>⚡ yesterday</span>}
                      {overdue && !yest && <span style={{ fontSize: '9px', color: tokens.red, fontWeight: 600 }}>overdue</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Calendar column ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Mobile day pills */}
          {isMobile && (
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', overflowX: 'auto', flexShrink: 0, paddingBottom: '2px' }}>
              {days.map((d, i) => {
                const active  = sameDay(d, mobileDay);
                const isToday = sameDay(d, today);
                return (
                  <button key={i} onClick={() => setMobileDay(d)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '5px 9px', borderRadius: '8px', border: `1px solid ${active ? 'rgba(200,169,110,0.3)' : tokens.border}`, background: active ? tokens.accentDim : 'transparent', cursor: 'pointer', flexShrink: 0 }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: active ? tokens.accent : tokens.textMuted }}>{DAY_SHORT[d.getDay()]}</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: isToday ? tokens.accent : active ? tokens.textPrimary : tokens.textSecondary, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: isToday && !active ? tokens.accentDim : 'transparent' }}>
                      {d.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Desktop day headers */}
          {!isMobile && (
            <div style={{ display: 'flex', flexShrink: 0, borderBottom: `1px solid ${tokens.border}` }}>
              <div style={{ width: 48, flexShrink: 0 }} />
              {days.map((d, i) => {
                const isToday    = sameDay(d, today);
                const isNonWork  = userProfile?.workHours && !isWorkDay(d, userProfile.workHours);
                return (
                  <div key={i} style={{ flex: 1, textAlign: 'center', padding: '6px 2px 8px', borderLeft: i > 0 ? `1px solid ${tokens.border}` : 'none', background: isNonWork ? 'rgba(0,0,0,0.02)' : isToday ? 'rgba(200,169,110,0.03)' : 'transparent' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: isNonWork ? tokens.textDisabled : tokens.textMuted }}>{DAY_SHORT[d.getDay()]}</div>
                    <div style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: isToday ? tokens.accent : isNonWork ? tokens.textDisabled : tokens.textPrimary, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: isToday ? tokens.accentDim : 'transparent', margin: '3px auto 0' }}>
                      {d.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* All-day row */}
          {allDayEvs.length > 0 && (
            <div style={{ display: 'flex', flexShrink: 0, borderBottom: `1px solid ${tokens.border}`, background: tokens.bgCard }}>
              <div style={{ width: isMobile ? 0 : 48, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 4 }}>
                {!isMobile && <span style={{ fontSize: '9px', color: tokens.textMuted, whiteSpace: 'nowrap' }}>all day</span>}
              </div>
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '3px', padding: '4px 6px', alignItems: 'center', minHeight: 28 }}>
                {allDayEvs.map((ev, i) => (
                  <div key={i} onClick={() => setDetail(ev)}
                    style={{ fontSize: '11px', fontWeight: 500, background: 'rgba(91,143,212,0.22)', color: tokens.blue, borderRadius: '4px', padding: '2px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {ev.summary}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scrollable time grid */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
            <div style={{ display: 'flex' }}>
              <div style={{ width: 48, flexShrink: 0, position: 'relative', height: gridHeight }}>
                {HOURS.map(h => (
                  <div key={h} style={{ position: 'absolute', top: (h - GRID_START) * HOUR_HEIGHT - 8, right: 8, fontSize: '10px', color: tokens.textMuted, lineHeight: 1, userSelect: 'none', whiteSpace: 'nowrap' }}>
                    {fmtHour(h)}
                  </div>
                ))}
              </div>

              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${visible.length}, 1fr)`, position: 'relative', borderLeft: `1px solid ${tokens.border}` }}>
                {HOURS.map(h => (
                  <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - GRID_START) * HOUR_HEIGHT, borderTop: `1px solid ${tokens.border}`, pointerEvents: 'none', zIndex: 1 }} />
                ))}

                {visible.map((day, di) => {
                  const laid      = layoutDay(timedForDay(day));
                  const isToday   = sameDay(day, today);
                  const isNonWork = userProfile?.workHours && !isWorkDay(day, userProfile.workHours);
                  const ghostInfo = dragOverInfo?.dayIndex === di ? dragOverInfo : null;
                  const ghostH    = ((draggedSidebarTask.current?.estimatedMinutes || 45) / 60) * HOUR_HEIGHT;

                  return (
                    <div key={di}
                      onDragOver={e => handleCalendarDragOver(e, di, day)}
                      onDrop={e => handleCalendarDrop(e, di, day)}
                      onClick={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (dragState) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const y    = e.clientY - rect.top;
                        const hr   = Math.floor(y / HOUR_HEIGHT) + GRID_START;
                        const min  = Math.floor((y % HOUR_HEIGHT) / HOUR_HEIGHT * 4) * 15;
                        openCreate(day, hr, min);
                      }}
                      style={{
                        position: 'relative', height: gridHeight,
                        borderLeft: di > 0 ? `1px solid ${tokens.border}` : 'none',
                        cursor: 'crosshair',
                        background: isNonWork
                          ? 'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(0,0,0,0.012) 8px, rgba(0,0,0,0.012) 16px)'
                          : isToday ? 'rgba(200,169,110,0.015)' : 'transparent',
                      }}
                    >
                      {HOURS.map(h => (
                        <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - GRID_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2, borderTop: `1px dashed rgba(0,0,0,0.05)`, pointerEvents: 'none' }} />
                      ))}
                      {isToday && showNow && (
                        <div style={{ position: 'absolute', left: -1, right: 0, top: nowTop, zIndex: 10, pointerEvents: 'none' }}>
                          <div style={{ position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: '50%', background: tokens.red }} />
                          <div style={{ height: 2, background: tokens.red, opacity: 0.85 }} />
                        </div>
                      )}

                      {/* Drag ghost preview */}
                      {ghostInfo && (
                        <div style={{
                          position: 'absolute',
                          top: minsToTop(ghostInfo.mins) + 1,
                          left: 2, right: 2,
                          height: Math.max(ghostH - 2, 18),
                          background: tokens.accentDim,
                          border: `2px dashed ${tokens.accent}`,
                          borderRadius: '5px',
                          pointerEvents: 'none',
                          zIndex: 15,
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0 6px',
                          overflow: 'hidden',
                        }}>
                          <div style={{ fontSize: '10px', fontWeight: 600, color: tokens.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {draggedSidebarTask.current?.title}
                            <span style={{ marginLeft: 6, opacity: 0.7 }}>
                              {Math.floor(ghostInfo.mins / 60) % 12 || 12}:{String(ghostInfo.mins % 60).padStart(2, '0')}{ghostInfo.mins < 720 ? 'am' : 'pm'}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Calendar events + task blocks */}
                      {laid.map((ev, ei) => {
                        const sMins = ev.start?.dateTime
                          ? new Date(ev.start.dateTime).getHours() * 60 + new Date(ev.start.dateTime).getMinutes()
                          : GRID_START * 60;
                        const eMins = ev.end?.dateTime
                          ? new Date(ev.end.dateTime).getHours() * 60 + new Date(ev.end.dateTime).getMinutes()
                          : GRID_END * 60;
                        const baseTop    = minsToTop(Math.max(sMins, GRID_START * 60));
                        const height     = Math.max(((Math.min(eMins, GRID_END * 60) - Math.max(sMins, GRID_START * 60)) / 60) * HOUR_HEIGHT - 2, 18);
                        const color      = eventColor(ev, ei);
                        const pct        = 100 / ev._totalCols;
                        const isDragging = dragState?.eventId === ev.id;
                        const top        = isDragging ? baseTop + dragState.deltaMins : baseTop;
                        return (
                          <div key={ev.id}
                            onMouseDown={(e) => { if (!isDragging && !ev._isTask) onEventMouseDown(e, ev); }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (dragRef.current || dragState?.eventId === ev.id) return;
                              if (ev._isTask) {
                                const t = tasks.find(tk => tk.id === ev._taskId);
                                if (t) openEdit(t);
                              } else {
                                setDetail(ev);
                              }
                            }}
                            onMouseEnter={e => { if (!dragState) e.currentTarget.style.filter = 'brightness(1.18)'; }}
                            onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                            style={{ position: 'absolute', top: top + 1, left: `calc(${pct * ev._col}% + 2px)`, width: `calc(${pct}% - 4px)`, height, background: color.bg, borderLeft: `3px solid ${color.border}`, borderRadius: '5px', padding: '3px 6px', overflow: 'hidden', cursor: ev._isTask ? 'pointer' : isDragging ? 'grabbing' : 'grab', zIndex: isDragging ? 20 : 5, boxShadow: isDragging ? '0 4px 16px rgba(0,0,0,0.5)' : '0 1px 4px rgba(0,0,0,0.35)', opacity: isDragging ? 0.9 : 1, transition: isDragging ? 'none' : 'filter 0.12s, box-shadow 0.12s', userSelect: 'none' }}>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: color.text, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ev._isTask && <span style={{ opacity: 0.7, marginRight: 3 }}>☐</span>}
                              {ev.summary}
                            </div>
                            {height > 32 && (
                              <div style={{ fontSize: '10px', color: color.text, opacity: 0.85, marginTop: '2px', whiteSpace: 'nowrap' }}>
                                {formatEventTime(ev.start.dateTime)}
                                {ev.end?.dateTime ? ` – ${formatEventTime(ev.end.dateTime)}` : ''}
                              </div>
                            )}
                            {height > 52 && ev.location && (
                              <div style={{ fontSize: '10px', color: color.text, opacity: 0.7, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                📍 {ev.location}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Plan Schedule Wizard ── */}
      <PlanScheduleFlow
        open={planOpen}
        onClose={() => {
          setPlanOpen(false);
          fetched.current.clear();
          fetchWeek(ws);
        }}
        calendarIntegration={calendarIntegration}
      />

      {/* ── Task Edit Modal ── */}
      <Modal open={!!editingTask} onClose={() => setEditingTask(null)} title="Edit Task">
        {editingTask && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Input label="Title" value={editForm.title} onChange={v => setEditForm(p => ({ ...p, title: v }))} placeholder="Task title" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Priority</label>
                <select value={editForm.priority} onChange={e => setEditForm(p => ({ ...p, priority: e.target.value }))}
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Project</label>
                <select value={editForm.project} onChange={e => setEditForm(p => ({ ...p, project: e.target.value }))}
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body }}>
                  <option value="Inbox">Inbox</option>
                  {(projects || []).filter(p => p.status === 'active').map(p => <option key={p.id} value={p.title}>{p.title}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Due Date</label>
                <input type="date" value={editForm.dueDate || ''}
                  onChange={e => setEditForm(p => ({ ...p, dueDate: e.target.value }))}
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, colorScheme: 'light', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Est. Minutes</label>
                <input type="number" min="5" max="480" value={editForm.estimatedMinutes || ''}
                  onChange={e => setEditForm(p => ({ ...p, estimatedMinutes: e.target.value }))}
                  placeholder="45"
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
              </div>
            </div>
            <Input label="Notes" value={editForm.notes} onChange={v => setEditForm(p => ({ ...p, notes: v }))} placeholder="Context, links, details..." multiline rows={2} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setEditingTask(null)} variant="ghost">Cancel</Button>
              <Button onClick={handleEditSave} loading={editSaving} disabled={!editForm.title.trim()}>Save Task</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Work Hours Override Warning ── */}
      <Modal open={!!workHoursWarning} onClose={() => setWorkHoursWarning(null)} title="Outside Work Hours">
        {workHoursWarning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '12px 14px', background: tokens.amberDim, borderRadius: '8px', border: `1px solid ${tokens.amber}` }}>
              <div style={{ fontSize: '13px', color: tokens.amber, fontWeight: 600, marginBottom: '4px' }}>
                {DAY_SHORT[workHoursWarning.day.getDay()]} is outside your scheduled work days.
              </div>
              <div style={{ fontSize: '12px', color: tokens.textSecondary }}>
                Your work hours settings show {DAY_SHORT[workHoursWarning.day.getDay()]} as a day off. You can still schedule here if needed.
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setWorkHoursWarning(null)} variant="ghost">Cancel</Button>
              <Button onClick={confirmWorkHoursOverride}>Schedule Anyway</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Create Event Modal ── */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Event">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input label="Title" value={newEv.title} onChange={v => setNewEv(p => ({ ...p, title: v }))} placeholder="Event title" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {['start', 'end'].map(field => (
              <div key={field}>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>
                  {field === 'start' ? 'Start' : 'End'}
                </label>
                <input type="datetime-local" value={newEv[field]}
                  onChange={e => setNewEv(p => ({ ...p, [field]: e.target.value }))}
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, colorScheme: 'light', boxSizing: 'border-box' }}
                  onFocus={e => e.target.style.borderColor = tokens.borderFocus}
                  onBlur={e => e.target.style.borderColor = tokens.border}
                />
              </div>
            ))}
          </div>
          <Input label="Description (optional)" value={newEv.description} onChange={v => setNewEv(p => ({ ...p, description: v }))} placeholder="Notes, meeting link, etc." multiline rows={2} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button onClick={() => setCreateOpen(false)} variant="ghost">Cancel</Button>
            <Button onClick={handleCreate} loading={saving} disabled={!newEv.title.trim()}>Create Event</Button>
          </div>
        </div>
      </Modal>

      {/* ── Detail Modal ── */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.summary || 'Event'}>
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {detail.start?.dateTime ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {[['Start', detail.start.dateTime], ['End', detail.end?.dateTime]].map(([lbl, iso]) => iso && (
                  <div key={lbl}>
                    <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.textMuted, marginBottom: '4px' }}>{lbl}</div>
                    <div style={{ fontSize: '13px', color: tokens.textPrimary }}>
                      {new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: tokens.textSecondary }}>All-day event · {new Date(detail.start?.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            )}
            {detail.location && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.textMuted, marginBottom: '4px' }}>Location</div>
                <div style={{ fontSize: '13px', color: tokens.textPrimary }}>{detail.location}</div>
              </div>
            )}
            {detail.description && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.textMuted, marginBottom: '4px' }}>Description</div>
                <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{detail.description}</div>
              </div>
            )}
            {detail.organizer?.displayName && (
              <div style={{ fontSize: '12px', color: tokens.textMuted }}>Organized by {detail.organizer.displayName}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: `1px solid ${tokens.border}` }}>
              <Button onClick={handleDelete} variant="danger" size="sm" loading={deleting}>Delete Event</Button>
              <Button onClick={() => setDetail(null)} variant="ghost" size="sm">Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
