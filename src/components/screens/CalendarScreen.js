// src/components/screens/CalendarScreen.js
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { tokens, fonts, calEventPalette } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import {
  getValidAccessToken, getEvents, createEvent, deleteEvent, updateEvent,
  formatEventTime, initiateCalendarAuth, getFreeSlots,
} from '../../lib/calendar';
import { Button, Modal, Input, Spinner, priorityColors } from '../ui';
import { addTask, updateTask } from '../../lib/db';
import { RECURRENCE_OPTIONS, isTaskBlocked, isDeferred } from '../../lib/tasks';
import TaskModal from '../TaskModal';
import PlanScheduleFlow from './PlanScheduleFlow';
import WorkScheduleImportModal from './WorkScheduleImportModal';
import { fetchWeeklyWeather, weatherCodeToEmoji, DEFAULT_ZIP } from '../../lib/weather';

const isDev = process.env.NODE_ENV !== 'production';

const HOUR_HEIGHT = 60;
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_LOWER = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];

function eventColor(ev, idx) {
  if (ev._done) return { bg: 'rgba(109,191,158,0.28)', border: '#6DBF9E', text: 'rgba(255,255,255,0.75)' };
  if (ev._anchor) return { bg: 'rgba(200,169,110,0.88)', border: '#C8A96E', text: '#0C0E12' };
  const cid = parseInt(ev.colorId, 10);
  if (!isNaN(cid)) return calEventPalette[(cid - 1) % calEventPalette.length] || calEventPalette[0];
  return calEventPalette[idx % calEventPalette.length];
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

function minsToTop(totalMins, gs = 6) {
  return ((totalMins - gs * 60) / 60) * HOUR_HEIGHT;
}

const FOCUS_TYPES = [
  { value: 'deep',    label: '🧠 Deep Work' },
  { value: 'shallow', label: '💬 Shallow'   },
  { value: 'admin',   label: '📋 Admin'     },
];

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
  const { user }                                                      = useAuth();
  const { calendarIntegration, tasks, userProfile, projects, goals } = useData();

  const gridStart = userProfile?.calGridStart ?? 6;
  const gridEnd   = userProfile?.calGridEnd   ?? 22;
  const gridHours = useMemo(() =>
    Array.from({ length: gridEnd - gridStart }, (_, i) => gridStart + i),
    [gridStart, gridEnd]
  );
  const [ws, setWs]                    = useState(() => {
    const saved = localStorage.getItem('anchor_calendar_view') || 'week';
    return saved === 'week' ? weekStart(new Date()) : new Date();
  });
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
  const [weatherForecast, setWeatherForecast] = useState(null);
  const [importOpen, setImportOpen]    = useState(false);
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [sidebarFilter,       setSidebarFilter]       = useState('unscheduled'); // 'unscheduled' | 'all'
  const [sidebarSearch,       setSidebarSearch]       = useState('');
  const [sidebarPriority,     setSidebarPriority]     = useState(''); // '' | 'critical' | 'high' | 'medium' | 'low'
  const [sidebarProjectId,    setSidebarProjectId]    = useState(''); // '' = all
  const [calView, setCalView] = useState(() => localStorage.getItem('anchor_calendar_view') || 'week');
  const [conflicts, setConflicts]      = useState([]);
  // Task edit/create modal (unified)
  const [editingTask,   setEditingTask]  = useState(null);  // null = closed, task obj = edit, 'new' = create
  const [taskSaving,    setTaskSaving]   = useState(false);
  // Legacy editForm kept for the calendar-event detail panel (not task editing)
  const [editForm, setEditForm]        = useState({});
  const [editSaving, setEditSaving]    = useState(false);
  // Drag from sidebar
  const [dragOverInfo, setDragOverInfo]   = useState(null); // { dayIndex, mins }
  const [dragNoSlot, setDragNoSlot]       = useState('');
  // Auto-schedule
  const [autoScheduling, setAutoScheduling] = useState(new Set());
  // Work hours warning
  const [workHoursWarning, setWorkHoursWarning] = useState(null); // { task, day, mins }
  // Task split
  const [splitTask,     setSplitTask]     = useState(null);
  const [splitSpent,    setSplitSpent]    = useState('');
  const [splitRemaining,setSplitRemaining]= useState('');
  const [splitSaving,   setSplitSaving]   = useState(false);

  const scrollRef               = useRef(null);
  const fetched                 = useRef(new Set());
  const dragRef                 = useRef(null);
  const tasksRef                = useRef(tasks);
  const eventsRef               = useRef([]);
  const draggedSidebarTask      = useRef(null);
  const isDraggingFromSidebar   = useRef(false);
  const draggedCalendarTask     = useRef(null);  // task block being re-dragged from the grid
  const [dragState, setDragState] = useState(null);
  const resizeRef = useRef(null);
  const justResized = useRef(false);
  const [resizeState, setResizeState] = useState(null);
  const [optimisticTaskEnds, setOptimisticTaskEnds] = useState({});
  const [completionNote, setCompletionNote] = useState({ open: false, task: null, text: '' });

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
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, 8 - gridStart) * HOUR_HEIGHT;
  }, [gridStart]); // re-scroll when user changes grid start hour

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  // Clear optimistic resize overrides once Firestore confirms the new scheduledEnd
  useEffect(() => {
    if (Object.keys(optimisticTaskEnds).length === 0) return;
    setOptimisticTaskEnds(prev => {
      const next = { ...prev };
      let changed = false;
      for (const [taskId, end] of Object.entries(prev)) {
        const task = tasks.find(t => t.id === taskId);
        if (task?.scheduledEnd === end) { delete next[taskId]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const zip = userProfile?.zip || DEFAULT_ZIP;
    fetchWeeklyWeather(zip).then(data => { if (data) setWeatherForecast(data); }).catch(() => {});
  }, [userProfile?.zip]); // eslint-disable-line react-hooks/exhaustive-deps -- fetchWeeklyWeather is a stable import; only the zip value should trigger a refetch

  // ── Unscheduled tasks for sidebar ─────────────────────────────────────────
  // Show tasks that have no time slot yet (no scheduledStart), regardless of whether
  // they have a date. A task with a date but no time needs to be dragged onto the grid.
  const unscheduledTasks = useMemo(() => tasks
    .filter(t => {
      if (t.done) return false;
      if (isDeferred(t)) return false;
      if (t.scheduledStart) return false; // has a time → shows on grid
      return true;
    })
    .sort((a, b) => {
      const po = { critical: 0, high: 1, medium: 2, low: 3 };
      return (po[a.priority] ?? 9) - (po[b.priority] ?? 9);
    }),
  [tasks]);

  // ── All tasks for sidebar "All" view ─────────────────────────────────────
  const allSidebarTasks = useMemo(() => tasks
    .filter(t => !t.done && !isDeferred(t))
    .sort((a, b) => {
      // scheduled first (by scheduledDate then scheduledStart), then by priority
      const aDate = a.scheduledDate || a.scheduledStart?.split('T')[0] || 'z';
      const bDate = b.scheduledDate || b.scheduledStart?.split('T')[0] || 'z';
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      const po = { critical: 0, high: 1, medium: 2, low: 3 };
      return (po[a.priority] ?? 9) - (po[b.priority] ?? 9);
    }),
  [tasks]);

  // ── Sidebar filtered tasks ────────────────────────────────────────────────
  const filteredSidebarTasks = useMemo(() => {
    const base = sidebarFilter === 'unscheduled' ? unscheduledTasks : allSidebarTasks;
    return base.filter(t => {
      if (sidebarPriority && t.priority !== sidebarPriority) return false;
      if (sidebarProjectId && t.projectId !== sidebarProjectId) return false;
      if (sidebarSearch) {
        const q = sidebarSearch.toLowerCase();
        return t.title?.toLowerCase().includes(q) || t.project?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [sidebarFilter, unscheduledTasks, allSidebarTasks, sidebarSearch, sidebarPriority, sidebarProjectId]);

  // ── Task-derived calendar blocks (tasks with a scheduled time slot) ────────
  const taskCalEvents = useMemo(() => {
    // Compute the visible date range based on current view so tasks on week-boundary
    // days (e.g. Sunday in 3-day view starting on Saturday) are not clipped.
    let rangeStart, rangeEnd;
    if (calView === 'week') {
      rangeStart = weekStart(ws);
      rangeEnd   = new Date(rangeStart); rangeEnd.setDate(rangeEnd.getDate() + 7);
    } else {
      rangeStart = new Date(ws); rangeStart.setHours(0, 0, 0, 0);
      const rangeDays = calView === '3day' ? 3 : 1;
      rangeEnd = new Date(rangeStart); rangeEnd.setDate(rangeEnd.getDate() + rangeDays);
    }
    // Active tasks: show Anchor block only if no fetched GCal event (dedup).
    // Done tasks: always show the green Anchor block (GCal event hidden separately).
    const gcalIds = new Set(events.map(e => e.id));
    return tasks
      .filter(t => t.scheduledStart)
      .filter(t => t.done || !t.calendarEventId || !gcalIds.has(t.calendarEventId))
      .filter(t => {
        const s = new Date(t.scheduledStart);
        return s >= rangeStart && s < rangeEnd;
      })
      .map(t => {
        const startMs = new Date(t.scheduledStart).getTime();
        const endIso  = optimisticTaskEnds[t.id] || t.scheduledEnd || new Date(startMs + (t.estimatedMinutes || 45) * 60000).toISOString();
        return {
          id: `task-${t.id}`,
          _taskId: t.id,
          _isTask: true,
          _anchor: true,
          _done: !!t.done,
          _outdoor: !!t.outdoor,
          summary: t.title,
          priority: t.priority,
          start: { dateTime: t.scheduledStart },
          end:   { dateTime: endIso },
        };
      });
  }, [tasks, ws, calView, events, optimisticTaskEnds]);

  // GCal event IDs for done tasks — used to hide the GCal block so only the green Anchor block shows
  const doneTaskCalEventIds = useMemo(() =>
    new Set(tasks.filter(t => t.done && t.calendarEventId).map(t => t.calendarEventId)),
    [tasks]
  );

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
      if (resizeRef.current) {
        const deltaY = e.clientY - resizeRef.current.startY;
        const deltaEndMins = Math.round(deltaY / 15) * 15;
        setResizeState(prev => prev ? { ...prev, deltaEndMins } : null);
        return;
      }
      if (!dragRef.current) return;
      const deltaY = e.clientY - dragRef.current.startY;
      if (Math.abs(deltaY) > 4) dragRef.current.hasMoved = true;
      const deltaMins = Math.round(deltaY / 15) * 15;
      setDragState(prev => prev ? { ...prev, deltaMins } : null);
    };

    const onMouseUp = (e) => {
      // ── Resize commit ────────────────────────────────────────────────────────
      if (resizeRef.current) {
        const ref = resizeRef.current;
        resizeRef.current = null;
        const rawDelta = e.clientY - ref.startY;
        const deltaEndMins = Math.round(rawDelta / 15) * 15;
        justResized.current = true;
        setTimeout(() => { justResized.current = false; }, 200);

        if (deltaEndMins === 0) { setResizeState(null); return; }

        const ev = ref.event;
        const origStart = new Date(ev.start.dateTime);
        const origEnd   = new Date(ev.end.dateTime);
        const rawNewEnd = new Date(origEnd.getTime() + deltaEndMins * 60000);
        const minEnd    = new Date(origStart.getTime() + 15 * 60000);
        const newEnd    = rawNewEnd < minEnd ? minEnd : rawNewEnd;
        const tz        = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // ── Optimistic updates BEFORE clearing resize state ─────────────────
        if (ev._isTask) {
          setOptimisticTaskEnds(prev => ({ ...prev, [ev._taskId]: newEnd.toISOString() }));
          const linkedCalId = (tasksRef.current || []).find(t => t.id === ev._taskId)?.calendarEventId;
          if (linkedCalId) {
            setEvents(prev => prev.map(e =>
              e.id === linkedCalId ? { ...e, end: { dateTime: newEnd.toISOString() } } : e
            ));
          }
        } else {
          setEvents(prev => prev.map(e =>
            e.id === ev.id ? { ...e, end: { dateTime: newEnd.toISOString() } } : e
          ));
        }
        setResizeState(null); // clear after optimistic update — no snap-back

        // ── Async saves (fire-and-forget) ────────────────────────────────────
        (async () => {
          try {
            if (!ev._isTask) {
              const token = await getValidAccessToken(user.uid, calendarIntegration);
              if (token) await updateEvent(token, ev.id, { end: { dateTime: newEnd.toISOString(), timeZone: tz } });
              const linked = (tasksRef.current || []).find(t => t.calendarEventId === ev.id);
              if (linked) await updateTask(user.uid, linked.id, {
                scheduledEnd: newEnd.toISOString(),
                estimatedMinutes: Math.round((newEnd - origStart) / 60000),
              });
            } else {
              await updateTask(user.uid, ev._taskId, {
                scheduledEnd: newEnd.toISOString(),
                estimatedMinutes: Math.round((newEnd - origStart) / 60000),
              });
              const task = (tasksRef.current || []).find(t => t.id === ev._taskId);
              if (task?.calendarEventId && calendarIntegration?.connected) {
                try {
                  const token = await getValidAccessToken(user.uid, calendarIntegration);
                  if (token) await updateEvent(token, task.calendarEventId, { end: { dateTime: newEnd.toISOString(), timeZone: tz } });
                } catch (err) { if (isDev) console.warn('GCal resize sync failed:', err); }
              }
            }
          } catch (err) {
            if (isDev) console.error('Resize failed:', err);
            // Rollback on error
            if (ev._isTask) {
              setOptimisticTaskEnds(prev => { const n = { ...prev }; delete n[ev._taskId]; return n; });
            } else {
              setEvents(prev => prev.map(e => e.id === ev.id ? ev : e));
            }
          }

          // ── Cascade-bump tasks displaced by extension ──────────────────────
          if (deltaEndMins > 0) {
            const sameDay = origStart.toISOString().split('T')[0];
            const BUFFER_MS = 10 * 60000;
            const displaced = (tasksRef.current || [])
              .filter(t => {
                if (t.done || !t.scheduledStart) return false;
                if (!t.scheduledStart.startsWith(sameDay)) return false;
                const tStart = new Date(t.scheduledStart);
                return tStart >= origEnd && tStart < newEnd;
              })
              .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));

            // GCal events on this day (non-task) used to skip over blocked time
            const dayGcalEvents = (eventsRef.current || [])
              .filter(e => {
                if (e._isTask || !e.start?.dateTime) return false;
                const eDay = e.start.dateTime.split('T')[0];
                return eDay === sameDay;
              });

            const advancePastGcal = (start, durationMs) => {
              let s = start;
              let changed = true;
              while (changed) {
                changed = false;
                for (const gcal of dayGcalEvents) {
                  const gcalStart = new Date(gcal.start.dateTime);
                  const gcalEnd   = new Date(gcal.end.dateTime);
                  const proposedEnd = new Date(s.getTime() + durationMs);
                  // overlap: s < gcalEnd && proposedEnd > gcalStart
                  if (s < gcalEnd && proposedEnd > gcalStart) {
                    s = new Date(gcalEnd.getTime() + BUFFER_MS);
                    changed = true;
                    break;
                  }
                }
              }
              return s;
            };

            let cascadeCursor = newEnd;
            for (const t of displaced) {
              const tStart   = new Date(t.scheduledStart);
              const duration = t.scheduledEnd
                ? new Date(t.scheduledEnd).getTime() - tStart.getTime()
                : (t.estimatedMinutes || 45) * 60000;
              if (tStart.getTime() >= cascadeCursor.getTime()) break;
              const rawBumpedStart = new Date(cascadeCursor.getTime() + BUFFER_MS);
              const bumpedStart = advancePastGcal(rawBumpedStart, duration);
              const bumpedEnd   = new Date(bumpedStart.getTime() + duration);
              cascadeCursor = bumpedEnd;
              try {
                await updateTask(user.uid, t.id, {
                  scheduledStart: bumpedStart.toISOString(),
                  scheduledEnd:   bumpedEnd.toISOString(),
                  scheduledDate:  sameDay,
                });
                if (t.calendarEventId && calendarIntegration?.connected) {
                  const token = await getValidAccessToken(user.uid, calendarIntegration);
                  if (token) await updateEvent(token, t.calendarEventId, {
                    start: { dateTime: bumpedStart.toISOString(), timeZone: tz },
                    end:   { dateTime: bumpedEnd.toISOString(),   timeZone: tz },
                  });
                }
              } catch (err) { if (isDev) console.warn('Cascade bump failed for', t.title, err); }
            }
          }
        })();
        return;
      }

      // ── Drag-to-move commit ─────────────────────────────────────────────────
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

      (async () => {
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
          if (isDev) console.error('Drag reschedule failed:', err);
          setEvents(prev => prev.map(e => e.id === ev.id ? ev : e));
        }
      })();
    };

    const onTouchMove = (e) => {
      if (resizeRef.current || dragRef.current) {
        e.preventDefault();
        const t = e.touches[0];
        onMouseMove({ clientY: t.clientY });
      }
    };
    const onTouchEnd = (e) => {
      if (resizeRef.current || dragRef.current) {
        const t = e.changedTouches[0];
        onMouseUp({ clientY: t.clientY });
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend',  onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend',  onTouchEnd);
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
          if (isDev) console.error('Sync task error:', err);
        }
      }
    }

    const detected = [];
    const anchorTasks = (tasksRef.current || []).filter(t => t.calendarEventId && t.scheduledStart && t.scheduledEnd);
    const anchorGcalIds = new Set(anchorTasks.map(t => t.calendarEventId));
    for (const ev of fetchedEvents.filter(e => !e._anchor && e.start?.dateTime && !anchorGcalIds.has(e.id))) {
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

  useEffect(() => {
    fetchWeek(weekStart(ws));
    // In day/3-day view ws is today; if the visible window crosses into a new
    // week (e.g. 3-day starting Saturday spans into Sunday = next week), also
    // fetch that week so GCal events and task blocks on those days load correctly.
    if (calView !== 'week') {
      const lastVisible = new Date(ws);
      lastVisible.setDate(lastVisible.getDate() + (calView === '3day' ? 2 : 0));
      const nextWs = weekStart(lastVisible);
      if (nextWs.toDateString() !== weekStart(ws).toDateString()) {
        fetchWeek(nextWs);
      }
    }
  }, [ws, calView, fetchWeek]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Task edit/create (unified) ────────────────────────────────────────────
  const openEdit     = (task) => setEditingTask(task);
  const openNewTask  = ()     => setEditingTask('new');
  const closeTask    = ()     => setEditingTask(null);

  const handleTaskSave = async (formData) => {
    setTaskSaving(true);
    try {
      if (!editingTask || editingTask === 'new') {
        await addTask(user.uid, { ...formData, source: 'manual', status: 'pending' });
      } else {
        const updates = { ...formData };
        if (editingTask.scheduledStart && formData.estimatedMinutes) {
          updates.scheduledEnd = new Date(
            new Date(editingTask.scheduledStart).getTime() + formData.estimatedMinutes * 60000
          ).toISOString();
        }
        await updateTask(user.uid, editingTask.id, updates);
        if (editingTask.calendarEventId && calendarIntegration?.connected) {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const gcalUpdates = {};
          if (formData.title !== editingTask.title) gcalUpdates.summary = formData.title;
          if (updates.scheduledEnd) gcalUpdates.end = { dateTime: updates.scheduledEnd, timeZone: tz };
          if (Object.keys(gcalUpdates).length > 0) {
            try {
              const token = await getValidAccessToken(user.uid, calendarIntegration);
              if (token) {
                await updateEvent(token, editingTask.calendarEventId, gcalUpdates);
                if (gcalUpdates.summary) setEvents(prev => prev.map(e => e.id === editingTask.calendarEventId ? { ...e, summary: gcalUpdates.summary } : e));
              }
            } catch (err) { if (isDev) console.warn('GCal update failed:', err); }
          }
        }
      }
      setEditingTask(null);
    } catch (err) {
      if (isDev) console.error('Task save error:', err);
    } finally {
      setTaskSaving(false);
    }
  };

  const handleTaskAutoSave = async (formData) => {
    if (!editingTask || editingTask === 'new') return;
    const updates = { ...formData };
    if (editingTask.scheduledStart && formData.estimatedMinutes) {
      updates.scheduledEnd = new Date(
        new Date(editingTask.scheduledStart).getTime() + formData.estimatedMinutes * 60000
      ).toISOString();
    }
    await updateTask(user.uid, editingTask.id, updates);
    if (editingTask.calendarEventId && calendarIntegration?.connected) {
      const gcalUpdates = {};
      if (formData.title !== editingTask.title) gcalUpdates.summary = formData.title;
      if (updates.scheduledEnd && updates.scheduledEnd !== editingTask.scheduledEnd) {
        gcalUpdates.end = { dateTime: updates.scheduledEnd, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      }
      if (Object.keys(gcalUpdates).length > 0) {
        try {
          const token = await getValidAccessToken(user.uid, calendarIntegration);
          if (token) {
            await updateEvent(token, editingTask.calendarEventId, gcalUpdates);
            if (gcalUpdates.summary) setEvents(prev => prev.map(e => e.id === editingTask.calendarEventId ? { ...e, summary: gcalUpdates.summary } : e));
          }
        } catch (err) { if (isDev) console.warn('GCal auto-save sync failed:', err); }
      }
    }
  };

  const handleMarkComplete = async (task) => {
    const now = new Date();
    const updates = { done: true, status: 'completed', completedAt: now.toISOString() };
    // Trim end to actual completion time if task hasn't ended yet
    if (task.scheduledEnd && new Date(task.scheduledEnd) > now) {
      updates.scheduledEnd = now.toISOString();
      if (task.calendarEventId && calendarIntegration?.connected) {
        try {
          const token = await getValidAccessToken(user.uid, calendarIntegration);
          if (token) await updateEvent(token, task.calendarEventId, {
            end: { dateTime: now.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          });
        } catch (err) { if (isDev) console.warn('GCal end trim failed:', err); }
      }
    }
    await updateTask(user.uid, task.id, updates);
    setCompletionNote({ open: true, task, text: '' });
  };

  const handleSaveCompletionNote = async () => {
    if (completionNote.text.trim()) {
      await updateTask(user.uid, completionNote.task.id, { completionNote: completionNote.text.trim() });
    }
    setCompletionNote({ open: false, task: null, text: '' });
  };

  const handleUnschedule = async () => {
    if (!editingTask) return;
    setEditSaving(true);
    try {
      // Delete GCal event if linked
      if (editingTask.calendarEventId && calendarIntegration?.connected) {
        try {
          const token = await getValidAccessToken(user.uid, calendarIntegration);
          if (token) await deleteEvent(token, editingTask.calendarEventId);
        } catch (err) { if (isDev) console.warn('GCal delete failed:', err); }
        // Remove from local events state
        setEvents(prev => prev.filter(e => e.id !== editingTask.calendarEventId));
      }
      await updateTask(user.uid, editingTask.id, {
        status:          'pending',
        scheduledDate:   null,
        scheduledStart:  null,
        scheduledEnd:    null,
        calendarEventId: null,
      });
      setEditingTask(null);
    } catch (err) {
      if (isDev) console.error('Unschedule error:', err);
    } finally {
      setEditSaving(false);
    }
  };

  // ── Auto-schedule single task ──────────────────────────────────────────────
  const handleAutoSchedule = async (task) => {
    if (isTaskBlocked(task, tasks)) {
      setDragNoSlot(`"${task.title}" is blocked — complete its dependencies first.`);
      setTimeout(() => setDragNoSlot(''), 4000);
      return;
    }
    setAutoScheduling(prev => new Set([...prev, task.id]));
    setDragNoSlot('');

    try {
      const workHours = userProfile?.workHours || null;
      const todayDate = new Date();
      const tomDate   = new Date(todayDate); tomDate.setDate(tomDate.getDate() + 1);

      const todayEvs = events.filter(e => e.start?.dateTime?.startsWith(ymd(todayDate)));
      const tomEvs   = events.filter(e => e.start?.dateTime?.startsWith(ymd(tomDate)));

      const now = new Date();
      const todaySlotsRaw = getFreeSlots(todayEvs, todayDate.toISOString(), workHours);
      const todaySlots = todaySlotsRaw
        .map(s => {
          const slotStart = new Date(s.start) < now ? now : new Date(s.start);
          const slotEnd   = new Date(s.end);
          const durationMins = Math.round((slotEnd - slotStart) / 60000);
          return { start: slotStart.toISOString(), end: s.end, durationMins };
        })
        .filter(s => s.durationMins >= 15);
      const tomSlots = getFreeSlots(tomEvs, tomDate.toISOString(), workHours);

      const needed = task.estimatedMinutes || 45;

      // Energy-aware slot ordering: deep work → morning; shallow/admin → afternoon
      const energy    = userProfile?.energyToday || 5;
      const focusType = task.focusType || 'deep';
      const noonIso   = (slots) => slots.map(s => ({
        ...s,
        isMorning: new Date(s.start).getHours() < 12,
      }));

      const allSlots = [...noonIso(todaySlots), ...noonIso(tomSlots)];
      let orderedSlots;
      if (focusType === 'deep' || energy >= 7) {
        // Prefer morning for deep/high-energy
        orderedSlots = [...allSlots.filter(s => s.isMorning), ...allSlots.filter(s => !s.isMorning)];
      } else if (focusType === 'shallow' || focusType === 'admin') {
        // Prefer afternoon for shallow/admin (save morning for deep)
        orderedSlots = [...allSlots.filter(s => !s.isMorning), ...allSlots.filter(s => s.isMorning)];
      } else {
        orderedSlots = allSlots;
      }
      const slot = orderedSlots.find(s => s.durationMins >= needed);

      if (!slot) {
        setDragNoSlot(`No free slot found for "${task.title}" today or tomorrow.`);
        setTimeout(() => setDragNoSlot(''), 4000);
        return;
      }

      const start = new Date(slot.start);
      const end   = new Date(start.getTime() + needed * 60000);
      const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const updates = {
        status:         'scheduled',
        scheduledDate:  ymd(start),
        scheduledStart: start.toISOString(),
        scheduledEnd:   end.toISOString(),
      };

      if (calendarIntegration?.connected) {
        try {
          const token = await getValidAccessToken(user.uid, calendarIntegration);
          if (token) {
            const created = await createEvent(token, {
              summary:     task.title,
              description: task.notes || '',
              start: { dateTime: start.toISOString(), timeZone: tz },
              end:   { dateTime: end.toISOString(),   timeZone: tz },
              colorId: '5',
            });
            updates.calendarEventId = created.id;
            fetched.current.delete(weekStart(ws).toISOString());
            fetchWeek(ws);
          }
        } catch (err) { if (isDev) console.warn('GCal auto-schedule create failed:', err); }
      }

      await updateTask(user.uid, task.id, updates);
    } finally {
      setAutoScheduling(prev => { const n = new Set(prev); n.delete(task.id); return n; });
    }
  };

  // ── Drag from sidebar ──────────────────────────────────────────────────────
  const handleSidebarDragStart = (e, task) => {
    draggedSidebarTask.current = task;
    isDraggingFromSidebar.current = true;
    draggedCalendarTask.current = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
  };

  const handleSidebarDragEnd = () => {
    draggedSidebarTask.current = null;
    isDraggingFromSidebar.current = false;
    setDragOverInfo(null);
  };

  // ── Drag from calendar grid (task block reschedule) ────────────────────────
  const handleCalendarTaskDragStart = (e, task) => {
    draggedCalendarTask.current = task;
    isDraggingFromSidebar.current = false;
    draggedSidebarTask.current = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    e.stopPropagation();
  };

  const handleCalendarTaskDragEnd = () => {
    draggedCalendarTask.current = null;
    setDragOverInfo(null);
  };

  const handleCalendarDragOver = useCallback((e, dayIndex, day) => {
    if (!isDraggingFromSidebar.current && !draggedCalendarTask.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const y    = e.clientY - rect.top;
    const rawMins  = Math.floor((y / HOUR_HEIGHT) * 60) + gridStart * 60;
    const snapped  = Math.max(gridStart * 60, Math.min(gridEnd * 60 - 30, Math.round(rawMins / 15) * 15));
    setDragOverInfo({ dayIndex, day, mins: snapped });
  }, [gridStart, gridEnd]);

  const handleCalendarDrop = useCallback(async (e, dayIndex, day) => {
    e.preventDefault();
    const sidebarTask  = draggedSidebarTask.current;
    const calendarTask = draggedCalendarTask.current;
    const task = sidebarTask || calendarTask;
    if (!task) return;

    draggedSidebarTask.current = null;
    isDraggingFromSidebar.current = false;
    draggedCalendarTask.current = null;

    const rect = e.currentTarget.getBoundingClientRect();
    const y    = e.clientY - rect.top;
    const rawMins = Math.floor((y / HOUR_HEIGHT) * 60) + gridStart * 60;
    const mins    = Math.max(gridStart * 60, Math.min(gridEnd * 60 - 30, Math.round(rawMins / 15) * 15));

    setDragOverInfo(null);

    // Warn if dropped on a non-work day
    const wh = userProfile?.workHours;
    if (wh && !isWorkDay(day, wh)) {
      setWorkHoursWarning({ task, day, mins });
      return;
    }

    if (calendarTask) {
      await rescheduleCalendarTask(calendarTask, day, mins);
    } else {
      await scheduleTaskAtSlot(task, day, mins);
    }
  }, [userProfile]); // eslint-disable-line react-hooks/exhaustive-deps -- rescheduleCalendarTask/scheduleTaskAtSlot are defined without useCallback; only userProfile (work hours) is a meaningful trigger

  const scheduleTaskAtSlot = async (task, day, mins) => {
    const start = new Date(day);
    start.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    const end   = new Date(start.getTime() + (task.estimatedMinutes || 45) * 60000);
    const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const updates = {
      status:         'scheduled',
      scheduledDate:  ymd(start),
      scheduledStart: start.toISOString(),
      scheduledEnd:   end.toISOString(),
    };

    // Auto-create Google Calendar event if connected
    if (calendarIntegration?.connected) {
      try {
        const token = await getValidAccessToken(user.uid, calendarIntegration);
        if (token) {
          const created = await createEvent(token, {
            summary:     task.title,
            description: task.notes || '',
            start: { dateTime: start.toISOString(), timeZone: tz },
            end:   { dateTime: end.toISOString(),   timeZone: tz },
            colorId: '5',
          });
          updates.calendarEventId = created.id;
          fetched.current.delete(weekStart(ws).toISOString());
          fetchWeek(ws);
        }
      } catch (err) { if (isDev) console.warn('GCal event create failed:', err); }
    }

    await updateTask(user.uid, task.id, updates);
  };

  const rescheduleCalendarTask = async (calEv, day, mins) => {
    const realTask = tasks.find(t => t.id === calEv._taskId);
    if (!realTask) return;
    if (realTask.calendarEventId && calendarIntegration?.connected) {
      try {
        const token = await getValidAccessToken(user.uid, calendarIntegration);
        if (token) await deleteEvent(token, realTask.calendarEventId);
      } catch (err) { if (isDev) console.warn('Delete old GCal event failed on reschedule:', err); }
    }
    await scheduleTaskAtSlot(realTask, day, mins);
  };

  const handleSplitTask = async () => {
    if (!splitTask || splitSaving) return;
    setSplitSaving(true);
    try {
      const remaining = parseInt(splitRemaining, 10) || splitTask.estimatedMinutes || 45;
      const updates = {
        status: 'pending',
        scheduledDate: null, scheduledStart: null, scheduledEnd: null, calendarEventId: null,
        estimatedMinutes: remaining,
      };
      if (splitTask.calendarEventId && calendarIntegration?.connected) {
        try {
          const token = await getValidAccessToken(user.uid, calendarIntegration);
          if (token) await deleteEvent(token, splitTask.calendarEventId);
        } catch (err) { if (isDev) console.warn('Delete GCal event failed on split:', err); }
      }
      await updateTask(user.uid, splitTask.id, updates);
      setSplitTask(null); setSplitSpent(''); setSplitRemaining('');
    } finally {
      setSplitSaving(false);
    }
  };

  const confirmWorkHoursOverride = async () => {
    if (!workHoursWarning) return;
    const { task, day, mins } = workHoursWarning;
    setWorkHoursWarning(null);
    await scheduleTaskAtSlot(task, day, mins);
  };

  const days    = weekDays(weekStart(ws));
  const today   = new Date();

  // Visible day columns — changes with calView
  const visible = isMobile ? [mobileDay] :
    calView === 'day'  ? [ws] :
    calView === '3day' ? Array.from({ length: 3 }, (_, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return d; }) :
    days;

  // Map calendarEventId → active task so GCal events can get checkbox/edit behavior
  const calEventTaskMap = useMemo(() => {
    const map = new Map();
    tasks.forEach(t => { if (t.calendarEventId && !t.done) map.set(t.calendarEventId, t); });
    return map;
  }, [tasks]);

  const timedForDay = (day) => [
    ...events
      .filter(e => e.start?.dateTime && sameDay(new Date(e.start.dateTime), day) && !doneTaskCalEventIds.has(e.id))
      .map(e => {
        const linkedTask = calEventTaskMap.get(e.id);
        if (linkedTask) return { ...e, _isTask: true, _anchor: true, _taskId: linkedTask.id, _done: false };
        return e;
      }),
    ...taskCalEvents.filter(e => sameDay(new Date(e.start.dateTime), day)),
  ];
  const allDayForDay = (day) => events.filter(e => !e.start?.dateTime && e.start?.date && sameDay(new Date(e.start.date + 'T12:00:00'), day));

  const stepDays = isMobile ? 1 : calView === 'day' ? 1 : calView === '3day' ? 3 : 7;
  const prevPeriod = () => {
    const d = new Date(ws); d.setDate(d.getDate() - stepDays);
    setWs(calView === 'week' ? weekStart(d) : d);
    if (isMobile) { const m = new Date(mobileDay); m.setDate(m.getDate() - 1); setMobileDay(m); }
  };
  const nextPeriod = () => {
    const d = new Date(ws); d.setDate(d.getDate() + stepDays);
    setWs(calView === 'week' ? weekStart(d) : d);
    if (isMobile) { const m = new Date(mobileDay); m.setDate(m.getDate() + 1); setMobileDay(m); }
  };
  const goToday = () => {
    setWs(calView === 'week' ? weekStart(new Date()) : new Date());
    setMobileDay(new Date());
  };
  const switchView = (view) => {
    setCalView(view);
    localStorage.setItem('anchor_calendar_view', view);
    if (view === 'week') setWs(weekStart(ws));
    else setWs(new Date());
  };

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
      fetched.current.delete(weekStart(ws).toISOString());
      fetchWeek(ws);
    } catch (err) {
      if (isDev) console.error('Create event error:', err);
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
      // Unschedule the linked Anchor task in the same action
      const linkedTask = tasks.find(t => t.calendarEventId === detail.id);
      if (linkedTask) {
        await updateTask(user.uid, linkedTask.id, {
          status: 'pending', scheduledDate: null, scheduledStart: null,
          scheduledEnd: null, calendarEventId: null,
        });
      }
      setDetail(null);
    } catch (err) {
      if (isDev) console.error('Delete error:', err);
    } finally {
      setDeleting(false);
    }
  };

  const gridHeight = (gridEnd - gridStart) * HOUR_HEIGHT;
  const nowMins    = today.getHours() * 60 + today.getMinutes();
  const nowTop     = minsToTop(nowMins, gridStart);
  const showNow    = nowMins >= gridStart * 60 && nowMins < gridEnd * 60;

  const monthLabel = (() => {
    if (calView === 'day') {
      return ws.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }
    if (calView === '3day') {
      const end = new Date(ws); end.setDate(end.getDate() + 2);
      return `${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
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
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {!isMobile && (
            <div style={{ display: 'flex', background: tokens.bgCard, border: `1px solid ${tokens.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              {[['day', 'Day'], ['3day', '3 Day'], ['week', 'Week']].map(([v, label]) => (
                <button key={v} onClick={() => switchView(v)}
                  style={{ padding: '5px 11px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', background: calView === v ? tokens.accentDim : 'transparent', color: calView === v ? tokens.accent : tokens.textMuted, border: 'none', borderRight: v !== 'week' ? `1px solid ${tokens.border}` : 'none', cursor: 'pointer', fontFamily: fonts.body, transition: 'all 0.12s' }}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <Button onClick={() => setPlanOpen(true)} variant="accent" size="sm">✦ Plan Schedule</Button>
          <Button onClick={() => setImportOpen(true)} variant="ghost" size="sm" title="Import work schedule from photo">📷</Button>
          <Button onClick={() => { fetched.current.delete(weekStart(ws).toISOString()); fetchWeek(weekStart(ws)); }} variant="ghost" size="sm" title="Force re-sync Google Calendar">↻</Button>
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
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${tokens.border}`, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <Button onClick={() => setPlanOpen(true)} style={{ flex: 1, justifyContent: 'center' }}>
                  ✦ Plan My Schedule
                </Button>
                <Button onClick={openNewTask} variant="ghost" style={{ flexShrink: 0 }} title="New Task">
                  + Task
                </Button>
              </div>
              <button onClick={() => setImportOpen(true)}
                style={{ width: '100%', padding: '7px', background: tokens.bgGlass, border: `1px solid ${tokens.border}`, borderRadius: '8px', color: tokens.textSecondary, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: fonts.body, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.borderHover; e.currentTarget.style.color = tokens.textPrimary; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = tokens.textSecondary; }}>
                📷 Import Work Schedule
              </button>
            </div>
            <div style={{ padding: '8px 10px', borderBottom: `1px solid ${tokens.border}`, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {/* Search bar */}
              <input
                type="text"
                placeholder="Search tasks…"
                value={sidebarSearch}
                onChange={e => setSidebarSearch(e.target.value)}
                style={{ width: '100%', padding: '5px 9px', background: tokens.bgGlass, border: `1px solid ${tokens.border}`, borderRadius: '6px', color: tokens.textPrimary, fontSize: '11px', fontFamily: fonts.body, outline: 'none', boxSizing: 'border-box' }}
              />
              {/* Unscheduled / All toggle */}
              <div style={{ display: 'flex', gap: '4px' }}>
                {['unscheduled', 'all'].map(f => (
                  <button key={f} onClick={() => setSidebarFilter(f)} style={{
                    flex: 1, padding: '4px 0', fontSize: '10px', fontWeight: 600,
                    background: sidebarFilter === f ? tokens.accentDim : 'transparent',
                    border: `1px solid ${sidebarFilter === f ? tokens.accent : tokens.border}`,
                    borderRadius: '5px', color: sidebarFilter === f ? tokens.accent : tokens.textMuted,
                    cursor: 'pointer', fontFamily: fonts.body, transition: 'all 0.12s',
                  }}>{f === 'unscheduled' ? 'Unscheduled' : 'All'}</button>
                ))}
              </div>
              {/* Priority filter chips */}
              <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                {['', 'critical', 'high', 'medium', 'low'].map(p => {
                  const active = sidebarPriority === p;
                  const label = p === '' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1);
                  return (
                    <button key={p} onClick={() => setSidebarPriority(p)} style={{
                      padding: '2px 8px', fontSize: '9px', fontWeight: 700, borderRadius: '4px',
                      background: active ? tokens.accentDim : 'transparent',
                      border: `1px solid ${active ? tokens.accent : tokens.border}`,
                      color: active ? tokens.accent : tokens.textMuted,
                      cursor: 'pointer', fontFamily: fonts.body, transition: 'all 0.1s',
                    }}>{label}</button>
                  );
                })}
              </div>
              {/* Project filter */}
              {projects.length > 0 && (
                <select
                  value={sidebarProjectId}
                  onChange={e => setSidebarProjectId(e.target.value)}
                  style={{ width: '100%', padding: '4px 7px', background: tokens.bgGlass, border: `1px solid ${tokens.border}`, borderRadius: '6px', color: sidebarProjectId ? tokens.textPrimary : tokens.textMuted, fontSize: '10px', fontFamily: fonts.body, outline: 'none', cursor: 'pointer' }}>
                  <option value="">All Projects</option>
                  {projects.filter(p => p.status !== 'complete').map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              )}
              <div style={{ fontSize: '9px', color: tokens.textMuted }}>
                {filteredSidebarTasks.length} task{filteredSidebarTasks.length !== 1 ? 's' : ''}
                {sidebarFilter === 'unscheduled' && filteredSidebarTasks.length > 0 && ' · drag to place'}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredSidebarTasks.length === 0 && (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: tokens.textMuted, fontSize: '12px' }}>
                  {sidebarSearch || sidebarPriority || sidebarProjectId
                    ? 'No tasks match filters'
                    : sidebarFilter === 'unscheduled' ? 'All tasks have time slots ✓' : 'No tasks'}
                </div>
              )}
              {filteredSidebarTasks.slice(0, 80).map(task => {
                const pc      = priorityColors[task.priority] || {};
                const overdue = task.scheduledDate && task.scheduledDate < yesterdayStr;
                const yest    = task.scheduledDate === yesterdayStr;
                const isAutoSched = autoScheduling.has(task.id);
                const isScheduled = !!task.scheduledStart;

                return (
                  <div
                    key={task.id}
                    draggable={!isScheduled}
                    onDragStart={e => !isScheduled && handleSidebarDragStart(e, task)}
                    onDragEnd={!isScheduled ? handleSidebarDragEnd : undefined}
                    style={{
                      padding: '9px 12px', borderBottom: `1px solid ${tokens.border}`,
                      cursor: isScheduled ? 'pointer' : 'grab', userSelect: 'none',
                      opacity: isAutoSched ? 0.5 : 1,
                      transition: 'background 0.1s',
                      borderLeft: isScheduled ? `3px solid ${tokens.accentDim}` : 'none',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = tokens.bgCardHover}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                      {/* Complete checkbox */}
                      <div
                        onClick={e => { e.stopPropagation(); handleMarkComplete(task); }}
                        title="Mark complete"
                        style={{ width: 16, height: 16, borderRadius: '4px', flexShrink: 0, marginTop: '1px', border: `1.5px solid ${tokens.border}`, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.12s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.green; e.currentTarget.style.background = tokens.greenDim; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.background = 'transparent'; }}
                      />
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
                      {isScheduled && (
                        <span style={{ fontSize: '9px', color: tokens.accent, fontWeight: 600, cursor: 'pointer' }}
                          onClick={e => {
                            e.stopPropagation();
                            // Navigate to the week containing this task
                            const taskDay = new Date(task.scheduledStart);
                            const targetWs = weekStart(taskDay);
                            setWs(targetWs);
                            if (isMobile) setMobileDay(taskDay);
                          }}
                          title="Click to navigate to this date">
                          {new Date(task.scheduledStart).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {formatEventTime(task.scheduledStart)}
                        </span>
                      )}
                      {isTaskBlocked(task, tasks) && (
                        <span style={{ fontSize: '9px', fontWeight: 700, color: tokens.amber, background: 'rgba(200,160,50,0.15)', padding: '1px 5px', borderRadius: '3px' }}>
                          ⊘ Blocked
                        </span>
                      )}
                      {yest    && !isScheduled && <span style={{ fontSize: '9px', color: tokens.amber, fontWeight: 600 }}>⚡ yesterday</span>}
                      {overdue && !yest && !isScheduled && <span style={{ fontSize: '9px', color: tokens.red, fontWeight: 600 }}>overdue</span>}
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
                const active       = sameDay(d, mobileDay);
                const isToday      = sameDay(d, today);
                const dayFc        = weatherForecast?.forecast?.find(f => f.date === ymd(d));
                const tooltipText  = dayFc ? `${dayFc.label} · ${dayFc.maxTemp}°/${dayFc.minTemp}°F · ${dayFc.precipProbability}% rain · ${dayFc.windSpeed}mph · ${dayFc.outdoorFriendly ? '✓ outdoor ok' : '✗ no outdoor'}` : '';
                return (
                  <button key={i} onClick={() => setMobileDay(d)}
                    title={tooltipText}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '5px 9px', borderRadius: '8px', border: `1px solid ${active ? 'rgba(200,169,110,0.3)' : tokens.border}`, background: active ? tokens.accentDim : 'transparent', cursor: 'pointer', flexShrink: 0 }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: active ? tokens.accent : tokens.textMuted }}>{DAY_SHORT[d.getDay()]}</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: isToday ? tokens.accent : active ? tokens.textPrimary : tokens.textSecondary, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: isToday && !active ? tokens.accentDim : 'transparent' }}>
                      {d.getDate()}
                    </span>
                    {dayFc && <span style={{ fontSize: '11px', lineHeight: 1 }}>{weatherCodeToEmoji(dayFc.code)}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Desktop day headers */}
          {!isMobile && (
            <div style={{ display: 'flex', flexShrink: 0, borderBottom: `1px solid ${tokens.border}` }}>
              <div style={{ width: 48, flexShrink: 0 }} />
              {visible.map((d, i) => {
                const isToday    = sameDay(d, today);
                const isNonWork  = userProfile?.workHours && !isWorkDay(d, userProfile.workHours);
                const dayFc      = weatherForecast?.forecast?.find(f => f.date === ymd(d));
                const tooltipText = dayFc
                  ? `${dayFc.label} · High ${dayFc.maxTemp}°F / Low ${dayFc.minTemp}°F · ${dayFc.precipProbability}% chance of rain · Wind ${dayFc.windSpeed}mph · ${dayFc.outdoorFriendly ? '✓ Outdoor ok' : '✗ Not ideal for outdoor tasks'}`
                  : '';
                return (
                  <div key={i} style={{ flex: 1, textAlign: 'center', padding: '6px 2px 8px', borderLeft: i > 0 ? `1px solid ${tokens.border}` : 'none', background: isNonWork ? 'rgba(0,0,0,0.02)' : isToday ? 'rgba(200,169,110,0.03)' : 'transparent' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: isNonWork ? tokens.textDisabled : tokens.textMuted }}>{DAY_SHORT[d.getDay()]}</div>
                    <div style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: isToday ? tokens.accent : isNonWork ? tokens.textDisabled : tokens.textPrimary, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: isToday ? tokens.accentDim : 'transparent', margin: '3px auto 0' }}>
                      {d.getDate()}
                    </div>
                    {dayFc && (
                      <div title={tooltipText} style={{ fontSize: '13px', marginTop: '4px', cursor: 'help', lineHeight: 1, opacity: 0.9 }}>
                        {weatherCodeToEmoji(dayFc.code)}
                      </div>
                    )}
                    {dayFc && (
                      <div style={{ fontSize: '9px', color: isNonWork ? tokens.textDisabled : tokens.textMuted, marginTop: '2px', whiteSpace: 'nowrap' }}>
                        {dayFc.maxTemp}°
                      </div>
                    )}
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
                {gridHours.map(h => (
                  <div key={h} style={{ position: 'absolute', top: (h - gridStart) * HOUR_HEIGHT - 8, right: 8, fontSize: '10px', color: tokens.textMuted, lineHeight: 1, userSelect: 'none', whiteSpace: 'nowrap' }}>
                    {fmtHour(h)}
                  </div>
                ))}
              </div>

              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${visible.length}, 1fr)`, position: 'relative', borderLeft: `1px solid ${tokens.border}` }}>
                {gridHours.map(h => (
                  <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - gridStart) * HOUR_HEIGHT, borderTop: `1px solid ${tokens.border}`, pointerEvents: 'none', zIndex: 1 }} />
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
                        const hr   = Math.floor(y / HOUR_HEIGHT) + gridStart;
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
                      {gridHours.map(h => (
                        <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - gridStart) * HOUR_HEIGHT + HOUR_HEIGHT / 2, borderTop: `1px dashed rgba(0,0,0,0.05)`, pointerEvents: 'none' }} />
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
                          top: minsToTop(ghostInfo.mins, gridStart) + 1,
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
                            {draggedSidebarTask.current?.title || draggedCalendarTask.current?.summary}
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
                          : gridStart * 60;
                        const eMins = ev.end?.dateTime
                          ? new Date(ev.end.dateTime).getHours() * 60 + new Date(ev.end.dateTime).getMinutes()
                          : gridEnd * 60;
                        const baseTop    = minsToTop(Math.max(sMins, gridStart * 60), gridStart);
                        const baseHeight = Math.max(((Math.min(eMins, gridEnd * 60) - Math.max(sMins, gridStart * 60)) / 60) * HOUR_HEIGHT - 2, 18);
                        const color      = eventColor(ev, ei);
                        const pct        = 100 / ev._totalCols;
                        const isDragging = dragState?.eventId === ev.id;
                        const isResizing = resizeState?.eventId === ev.id;
                        const top        = isDragging ? baseTop + dragState.deltaMins : baseTop;
                        const resizeDeltaH = isResizing ? (resizeState.deltaEndMins / 60) * HOUR_HEIGHT : 0;
                        const height     = Math.max(baseHeight + resizeDeltaH, 18);
                        const liveEndMs  = isResizing
                          ? new Date(ev.end.dateTime).getTime() + resizeState.deltaEndMins * 60000
                          : null;
                        const liveEndIso = liveEndMs ? new Date(Math.max(liveEndMs, new Date(ev.start.dateTime).getTime() + 15 * 60000)).toISOString() : null;
                        const dayFc      = weatherForecast?.forecast?.find(f => f.date === ymd(day));
                        const weatherAlert = ev._isTask && ev._outdoor && dayFc && !dayFc.outdoorFriendly;
                        return (
                          <div key={ev.id}
                            draggable={ev._isTask && !ev._done}
                            onDragStart={ev._isTask && !ev._done ? (e) => { e.stopPropagation(); handleCalendarTaskDragStart(e, ev); } : undefined}
                            onDragEnd={ev._isTask && !ev._done ? handleCalendarTaskDragEnd : undefined}
                            onMouseDown={(e) => { if (!isDragging && !isResizing && !ev._isTask) onEventMouseDown(e, ev); }}
                            onTouchStart={(e) => {
                              if (ev._isTask || isDragging || isResizing) return;
                              const t = e.touches[0];
                              onEventMouseDown({ clientY: t.clientY, clientX: t.clientX, preventDefault: () => {}, stopPropagation: () => {} }, ev);
                            }}
                            onTouchMove={(e) => { if (dragRef.current || resizeRef.current) e.preventDefault(); }}
                            onTouchEnd={(e) => {
                              if (dragRef.current || resizeRef.current) {
                                const t = e.changedTouches[0];
                                document.dispatchEvent(new MouseEvent('mouseup', { clientY: t.clientY, clientX: t.clientX, bubbles: true }));
                              }
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (dragRef.current || resizeRef.current || justResized.current || dragState?.eventId === ev.id || resizeState?.eventId === ev.id) return;
                              if (ev._isTask) {
                                const t = tasks.find(tk => tk.id === ev._taskId);
                                if (t) openEdit(t);
                              } else {
                                setDetail(ev);
                              }
                            }}
                            onMouseEnter={e => { if (!dragState && !resizeState) e.currentTarget.style.filter = 'brightness(1.18)'; }}
                            onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                            style={{ position: 'absolute', top: top + 1, left: `calc(${pct * ev._col}% + 2px)`, width: `calc(${pct}% - 4px)`, height, background: color.bg, borderLeft: `3px solid ${color.border}`, borderRadius: '5px', padding: '3px 6px', overflow: 'hidden', cursor: isResizing ? 'ns-resize' : ev._isTask && !ev._done ? 'grab' : ev._isTask ? 'pointer' : isDragging ? 'grabbing' : 'grab', zIndex: isResizing ? 25 : isDragging ? 20 : 5, boxShadow: isResizing ? '0 6px 20px rgba(0,0,0,0.55)' : isDragging ? '0 4px 16px rgba(0,0,0,0.5)' : '0 1px 4px rgba(0,0,0,0.35)', opacity: ev._done ? 0.7 : isDragging ? 0.9 : 1, transition: isDragging || isResizing ? 'none' : 'filter 0.12s, box-shadow 0.12s', userSelect: 'none', touchAction: 'none' }}>
                            {/* Weather alert badge */}
                            {weatherAlert && (
                              <div title={`${dayFc.label} — not ideal for outdoor tasks`} style={{ position: 'absolute', top: 2, right: 4, fontSize: '10px', lineHeight: 1, zIndex: 2 }}>⚠</div>
                            )}
                            <div style={{ fontSize: '11px', fontWeight: 700, color: color.text, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', paddingRight: weatherAlert ? '14px' : 0 }}>
                              {ev._isTask && (
                                <span
                                  onClick={e => {
                                    e.stopPropagation();
                                    const t = tasks.find(tk => tk.id === ev._taskId);
                                    if (!t) return;
                                    if (t.done) {
                                      updateTask(user.uid, t.id, { done: false, status: 'pending', completedAt: null });
                                    } else {
                                      handleMarkComplete(t);
                                    }
                                  }}
                                  title={ev._done ? 'Mark incomplete' : 'Mark complete'}
                                  style={{ opacity: 0.85, marginRight: 4, cursor: 'pointer', flexShrink: 0, fontSize: '13px', lineHeight: 1 }}
                                >{ev._done ? '☑' : '☐'}</span>
                              )}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: ev._done ? 'line-through' : 'none' }}>{ev.summary}</span>
                            </div>
                            {height > 32 && (
                              <div style={{ fontSize: '10px', color: color.text, opacity: 0.85, marginTop: '2px', whiteSpace: 'nowrap' }}>
                                {formatEventTime(ev.start.dateTime)}
                                {(liveEndIso || ev.end?.dateTime) ? ` – ${formatEventTime(liveEndIso || ev.end.dateTime)}` : ''}
                                {isResizing && liveEndIso && (
                                  <span style={{ opacity: 0.65, marginLeft: 5 }}>
                                    {Math.round((new Date(liveEndIso) - new Date(ev.start.dateTime)) / 60000)}m
                                  </span>
                                )}
                              </div>
                            )}
                            {height > 52 && ev.location && (
                              <div style={{ fontSize: '10px', color: color.text, opacity: 0.7, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                📍 {ev.location}
                              </div>
                            )}
                            {/* Checklist progress badge */}
                            {ev._isTask && height > 44 && (() => {
                              const t = tasks.find(tk => tk.id === ev._taskId);
                              if (!t?.checklist?.length) return null;
                              const done = t.checklist.filter(i => i.done).length;
                              return (
                                <div style={{ fontSize: '10px', color: color.text, opacity: done === t.checklist.length ? 1 : 0.75, marginTop: '2px', fontWeight: 600 }}>
                                  ☑ {done}/{t.checklist.length}
                                </div>
                              );
                            })()}
                            {/* Split button — only for active anchor task blocks with enough height */}
                            {ev._isTask && !ev._done && height > 44 && !isResizing && (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  const t = tasks.find(tk => tk.id === ev._taskId);
                                  if (!t) return;
                                  setSplitTask(t);
                                  setSplitSpent('');
                                  setSplitRemaining(String(t.estimatedMinutes || 45));
                                }}
                                title="Split task — mark partial progress and re-schedule remainder"
                                style={{ position: 'absolute', bottom: 12, right: 4, background: 'rgba(0,0,0,0.28)', border: 'none', color: color.text, borderRadius: '4px', padding: '1px 5px', fontSize: '9px', cursor: 'pointer', fontFamily: fonts.body, lineHeight: 1.4, opacity: 0.75 }}
                                onMouseEnter={e => { e.stopPropagation(); e.currentTarget.style.opacity = '1'; }}
                                onMouseLeave={e => e.currentTarget.style.opacity = '0.75'}
                              >✂ split</button>
                            )}
                            {/* Resize handle — drag bottom edge to extend/shorten duration */}
                            {!ev._done && (
                              <div
                                draggable={false}
                                onMouseDown={e => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  resizeRef.current = { event: ev, startY: e.clientY };
                                  setResizeState({ eventId: ev.id, deltaEndMins: 0 });
                                }}
                                onTouchStart={e => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const t = e.touches[0];
                                  resizeRef.current = { event: ev, startY: t.clientY };
                                  setResizeState({ eventId: ev.id, deltaEndMins: 0 });
                                }}
                                onClick={e => e.stopPropagation()}
                                title="Drag to resize"
                                style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 12, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 0 4px 4px', touchAction: 'none' }}
                              >
                                <div style={{ display: 'flex', gap: '3px' }}>
                                  {[0,1,2,3,4].map(i => <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: color.text, opacity: isResizing ? 0.8 : 0.30 }} />)}
                                </div>
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
        weatherForecast={weatherForecast}
      />

      {/* ── Work Schedule Import ── */}
      <WorkScheduleImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        calendarIntegration={calendarIntegration}
        onImported={() => {
          fetched.current.clear();
          fetchWeek(ws);
        }}
      />

      {/* ── Task Edit / Create Modal ── */}
      <TaskModal
        open={!!editingTask}
        onClose={closeTask}
        onSave={handleTaskSave}
        onAutoSave={handleTaskAutoSave}
        task={editingTask && editingTask !== 'new' ? editingTask : null}
        saving={taskSaving}
        modalTitle={editingTask === 'new' ? 'New Task' : 'Edit Task'}
        extraActions={editingTask && editingTask !== 'new' ? (
          <>
            <Button
              variant="ghost"
              onClick={async () => { const t = editingTask; closeTask(); await handleMarkComplete(t); }}
              style={{ color: tokens.green, borderColor: tokens.green }}
            >✓ Done</Button>
            {editingTask?.scheduledStart && (
              <Button variant="ghost" onClick={handleUnschedule} style={{ color: tokens.red, borderColor: tokens.red }}>
                Unschedule
              </Button>
            )}
          </>
        ) : null}
      />

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

      {/* ── Split Task Modal ── */}
      <Modal open={!!splitTask} onClose={() => { setSplitTask(null); setSplitSpent(''); setSplitRemaining(''); }} title="Split Task">
        {splitTask && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '10px 14px', background: tokens.bgGlass, borderRadius: '8px', border: `1px solid ${tokens.border}`, fontSize: '13px', color: tokens.textPrimary, fontWeight: 500 }}>
              {splitTask.title}
            </div>
            <p style={{ fontSize: '13px', color: tokens.textSecondary, margin: 0, lineHeight: 1.6 }}>
              Mark partial progress on this task. It will be unscheduled and moved back to your sidebar so you can reschedule the remaining time.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Time Spent (min)</label>
                <input type="number" min="1" max="480" value={splitSpent}
                  onChange={e => {
                    setSplitSpent(e.target.value);
                    const spent = parseInt(e.target.value, 10);
                    const orig  = splitTask.estimatedMinutes || 45;
                    if (!isNaN(spent) && spent > 0) setSplitRemaining(String(Math.max(5, orig - spent)));
                  }}
                  placeholder={`of ${splitTask.estimatedMinutes || 45}`}
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted, display: 'block', marginBottom: '6px' }}>Remaining (min)</label>
                <input type="number" min="5" max="480" value={splitRemaining}
                  onChange={e => setSplitRemaining(e.target.value)}
                  placeholder="45"
                  style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '9px 10px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ fontSize: '12px', color: tokens.textMuted }}>
              The task will return to your sidebar with <strong style={{ color: tokens.textPrimary }}>{splitRemaining || (splitTask.estimatedMinutes || 45)} min</strong> remaining — drag it back to the calendar when ready.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => { setSplitTask(null); setSplitSpent(''); setSplitRemaining(''); }} variant="ghost">Cancel</Button>
              <Button onClick={handleSplitTask} loading={splitSaving}>✂ Split &amp; Unschedule</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Completion Note Modal ── */}
      <Modal open={completionNote.open} onClose={() => setCompletionNote({ open: false, task: null, text: '' })} title="Task Done ✓">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '13px', color: tokens.textSecondary, lineHeight: 1.6 }}>
            Optional: capture what you found, decided, or learned while doing this.
          </div>
          <textarea
            value={completionNote.text}
            onChange={e => setCompletionNote(n => ({ ...n, text: e.target.value }))}
            placeholder="e.g. Called vendor — price is $420, need approval from Mike..."
            autoFocus
            rows={3}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSaveCompletionNote(); }}
            style={{ width: '100%', background: tokens.bgInput, border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '10px 12px', color: tokens.textPrimary, fontSize: '13px', outline: 'none', fontFamily: fonts.body, resize: 'vertical', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = tokens.borderFocus}
            onBlur={e => e.target.style.borderColor = tokens.border}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" onClick={() => setCompletionNote({ open: false, task: null, text: '' })}>Skip</Button>
            <Button onClick={handleSaveCompletionNote}>Save Note</Button>
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
