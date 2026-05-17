// src/components/screens/CalendarScreen.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import {
  getValidAccessToken, getEvents, createEvent, deleteEvent, updateEvent,
  formatEventTime, initiateCalendarAuth,
} from '../../lib/calendar';
import { Button, Modal, Input, Spinner } from '../ui';

const HOUR_HEIGHT = 60;
const GRID_START  = 6;
const GRID_END    = 22;
const HOURS = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i);
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EVENT_PALETTE = [
  { bg: 'rgba(91,143,212,0.88)',  border: '#5B8FD4',  text: '#fff' },
  { bg: 'rgba(109,191,158,0.88)', border: '#6DBF9E',  text: '#fff' },
  { bg: 'rgba(155,133,201,0.88)', border: '#9B85C9',  text: '#fff' },
  { bg: 'rgba(212,169,107,0.88)', border: '#D4A96B',  text: '#fff' },
  { bg: 'rgba(212,122,107,0.88)', border: '#D47A6B',  text: '#fff' },
];

function eventColor(ev, idx) {
  if (ev._anchor) return { bg: 'rgba(200,169,110,0.88)', border: '#C8A96E', text: '#0C0E12' };
  // Use colorId if GCal provides one
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
    const d = new Date(ws);
    d.setDate(d.getDate() + i);
    return d;
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
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function localISO(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
    const e = new Date(ev.end.dateTime).getTime();
    let col = 0;
    // Find first column where this event doesn't overlap the last event
    while (
      cols[col] &&
      new Date(sorted[cols[col][cols[col].length - 1]].end.dateTime).getTime() > s
    ) col++;
    if (!cols[col]) cols[col] = [];
    cols[col].push(sorted.indexOf(ev));
    return col;
  });

  // Determine total concurrent columns for each event
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
  const { user }                          = useAuth();
  const { calendarIntegration }           = useData();
  const [ws, setWs]                       = useState(() => weekStart(new Date()));
  const [events, setEvents]               = useState([]);
  const [loading, setLoading]             = useState(false);
  const [fetchError, setFetchError]       = useState('');
  const [isMobile, setIsMobile]           = useState(window.innerWidth < 768);
  const [mobileDay, setMobileDay]         = useState(new Date());
  const [createOpen, setCreateOpen]       = useState(false);
  const [newEv, setNewEv]                 = useState({ title: '', start: '', end: '', description: '' });
  const [saving, setSaving]               = useState(false);
  const [detail, setDetail]               = useState(null);
  const [deleting, setDeleting]           = useState(false);
  const scrollRef                         = useRef(null);
  const fetched                           = useRef(new Set());
  const dragRef                           = useRef(null);
  const [dragState, setDragState]         = useState(null); // { eventId, deltaMins }

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  // Scroll to 8am on first render
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = (8 - GRID_START) * HOUR_HEIGHT;
    }
  }, []);

  // ── Drag-to-reschedule (desktop only) ─────────────────────────────────────
  const onEventMouseDown = useCallback((e, ev) => {
    if (isMobile || !ev.start?.dateTime) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      event:    ev,
      startY:   e.clientY,
      hasMoved: false,
    };
    setDragState({ eventId: ev.id, deltaMins: 0 });
  }, [isMobile]);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragRef.current) return;
      const deltaY = e.clientY - dragRef.current.startY;
      if (Math.abs(deltaY) > 4) dragRef.current.hasMoved = true;
      // 1px = 1min (since HOUR_HEIGHT = 60), snap to 15 min
      const deltaMins = Math.round(deltaY / 15) * 15;
      setDragState(prev => prev ? { ...prev, deltaMins } : null);
    };

    const onMouseUp = async (e) => {
      if (!dragRef.current) return;
      const ref = dragRef.current;
      dragRef.current = null;

      const rawDelta = e.clientY - ref.startY;
      const deltaMins = Math.round(rawDelta / 15) * 15;
      setDragState(null);

      if (!ref.hasMoved || deltaMins === 0) return;

      const ev       = ref.event;
      const newStart = new Date(new Date(ev.start.dateTime).getTime() + deltaMins * 60000);
      const newEnd   = new Date(new Date(ev.end.dateTime).getTime()   + deltaMins * 60000);

      // Optimistic update
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
      } catch (err) {
        console.error('Drag reschedule failed:', err);
        // Revert on failure
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

  const fetchWeek = useCallback(async (start) => {
    const key = start.toISOString();
    if (fetched.current.has(key) || !calendarIntegration?.connected) return;
    setLoading(true);
    setFetchError('');
    try {
      const token = await getValidAccessToken(user.uid, calendarIntegration);
      if (!token) { setFetchError('Not connected'); return; }
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const { events: raw } = await getEvents(token, start.toISOString(), end.toISOString());
      fetched.current.add(key);
      setEvents(prev => {
        const outside = prev.filter(e => {
          const d = new Date(e.start?.dateTime || e.start?.date);
          return d < start || d >= end;
        });
        return [...outside, ...(raw || [])];
      });
    } catch {
      setFetchError('Could not load events');
    } finally {
      setLoading(false);
    }
  }, [user, calendarIntegration]);

  useEffect(() => { fetchWeek(ws); }, [ws, fetchWeek]);

  const days    = weekDays(ws);
  const today   = new Date();
  const visible = isMobile ? [mobileDay] : days;

  const timedForDay  = (day) => events.filter(e => e.start?.dateTime && sameDay(new Date(e.start.dateTime), day));
  const allDayForDay = (day) => events.filter(e => !e.start?.dateTime && e.start?.date && sameDay(new Date(e.start.date + 'T12:00:00'), day));

  const prevPeriod = () => {
    const d = new Date(ws);
    d.setDate(d.getDate() - 7);
    setWs(d);
    if (isMobile) { const m = new Date(mobileDay); m.setDate(m.getDate() - 1); setMobileDay(m); }
  };

  const nextPeriod = () => {
    const d = new Date(ws);
    d.setDate(d.getDate() + 7);
    setWs(d);
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
      // Clear cache and re-fetch so the new event appears
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

  const nowMins = today.getHours() * 60 + today.getMinutes();
  const nowTop  = minsToTop(nowMins);
  const showNow = nowMins >= GRID_START * 60 && nowMins < GRID_END * 60;

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

  // ── All-day strip ──────────────────────────────────────────────────────────
  const allDayEvs = visible.flatMap(d => allDayForDay(d));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: isMobile ? 'calc(100vh - 170px)' : 'calc(100vh - 110px)' }}>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexShrink: 0, gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h1 style={{ fontFamily: fonts.display, fontSize: isMobile ? '18px' : '22px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.02em', margin: 0, whiteSpace: 'nowrap' }}>
            {isMobile
              ? mobileDay.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
              : monthLabel}
          </h1>
          {loading && <Spinner size={13} />}
          {fetchError && <span style={{ fontSize: '11px', color: tokens.red }}>{fetchError}</span>}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button onClick={goToday} variant="ghost" size="sm">Today</Button>
          <button onClick={prevPeriod}
            style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, color: tokens.textSecondary, borderRadius: '7px', padding: '5px 11px', cursor: 'pointer', fontSize: '13px', fontFamily: fonts.body, lineHeight: 1 }}>‹</button>
          <button onClick={nextPeriod}
            style={{ background: tokens.bgCard, border: `1px solid ${tokens.border}`, color: tokens.textSecondary, borderRadius: '7px', padding: '5px 11px', cursor: 'pointer', fontSize: '13px', fontFamily: fonts.body, lineHeight: 1 }}>›</button>
          <Button size="sm" onClick={() => { const n = new Date(); openCreate(n, n.getHours() + 1); }}>+ Event</Button>
        </div>
      </div>

      {/* ── Mobile day pills ── */}
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

      {/* ── Desktop day headers ── */}
      {!isMobile && (
        <div style={{ display: 'flex', flexShrink: 0, borderBottom: `1px solid ${tokens.border}` }}>
          <div style={{ width: 48, flexShrink: 0 }} />
          {days.map((d, i) => {
            const isToday = sameDay(d, today);
            return (
              <div key={i} style={{ flex: 1, textAlign: 'center', padding: '6px 2px 8px', borderLeft: i > 0 ? `1px solid ${tokens.border}` : 'none', background: isToday ? 'rgba(200,169,110,0.03)' : 'transparent' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted }}>{DAY_SHORT[d.getDay()]}</div>
                <div style={{ fontFamily: fonts.display, fontSize: '20px', fontWeight: 700, color: isToday ? tokens.accent : tokens.textPrimary, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: isToday ? tokens.accentDim : 'transparent', margin: '3px auto 0' }}>
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── All-day row ── */}
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

      {/* ── Scrollable time grid ── */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
        <div style={{ display: 'flex' }}>

          {/* Hour labels */}
          <div style={{ width: 48, flexShrink: 0, position: 'relative', height: gridHeight }}>
            {HOURS.map(h => (
              <div key={h} style={{ position: 'absolute', top: (h - GRID_START) * HOUR_HEIGHT - 8, right: 8, fontSize: '10px', color: tokens.textMuted, lineHeight: 1, userSelect: 'none', whiteSpace: 'nowrap' }}>
                {fmtHour(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${visible.length}, 1fr)`, position: 'relative', borderLeft: `1px solid ${tokens.border}` }}>

            {/* Horizontal hour lines */}
            {HOURS.map(h => (
              <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - GRID_START) * HOUR_HEIGHT, borderTop: `1px solid ${tokens.border}`, pointerEvents: 'none', zIndex: 1 }} />
            ))}

            {visible.map((day, di) => {
              const laid    = layoutDay(timedForDay(day));
              const isToday = sameDay(day, today);

              return (
                <div key={di} onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (dragState) return; // skip if drag just finished
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y    = e.clientY - rect.top;
                    const hr   = Math.floor(y / HOUR_HEIGHT) + GRID_START;
                    const min  = Math.floor((y % HOUR_HEIGHT) / HOUR_HEIGHT * 4) * 15;
                    openCreate(day, hr, min);
                  }}
                  style={{ position: 'relative', height: gridHeight, borderLeft: di > 0 ? `1px solid ${tokens.border}` : 'none', cursor: 'crosshair', background: isToday ? 'rgba(200,169,110,0.015)' : 'transparent' }}
                >
                  {/* Half-hour dashed lines */}
                  {HOURS.map(h => (
                    <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - GRID_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2, borderTop: `1px dashed rgba(0,0,0,0.05)`, pointerEvents: 'none' }} />
                  ))}

                  {/* Current time line */}
                  {isToday && showNow && (
                    <div style={{ position: 'absolute', left: -1, right: 0, top: nowTop, zIndex: 10, pointerEvents: 'none' }}>
                      <div style={{ position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: '50%', background: tokens.red }} />
                      <div style={{ height: 2, background: tokens.red, opacity: 0.85 }} />
                    </div>
                  )}

                  {/* Events */}
                  {laid.map((ev, ei) => {
                    const sMins = ev.start?.dateTime
                      ? new Date(ev.start.dateTime).getHours() * 60 + new Date(ev.start.dateTime).getMinutes()
                      : GRID_START * 60;
                    const eMins = ev.end?.dateTime
                      ? new Date(ev.end.dateTime).getHours() * 60 + new Date(ev.end.dateTime).getMinutes()
                      : GRID_END * 60;

                    const baseTop    = minsToTop(Math.max(sMins, GRID_START * 60));
                    const height = Math.max(((Math.min(eMins, GRID_END * 60) - Math.max(sMins, GRID_START * 60)) / 60) * HOUR_HEIGHT - 2, 18);
                    const color  = eventColor(ev, ei);
                    const pct    = 100 / ev._totalCols;
                    const isDragging = dragState?.eventId === ev.id;
                    const top = isDragging ? baseTop + dragState.deltaMins : baseTop;

                    return (
                      <div key={ev.id}
                        onMouseDown={(e) => { if (!isDragging) onEventMouseDown(e, ev); }}
                        onClick={(e) => { e.stopPropagation(); if (!dragRef.current && !(dragState?.eventId === ev.id)) setDetail(ev); }}
                        onMouseEnter={e => { if (!dragState) e.currentTarget.style.filter = 'brightness(1.18)'; }}
                        onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                        style={{ position: 'absolute', top: top + 1, left: `calc(${pct * ev._col}% + 2px)`, width: `calc(${pct}% - 4px)`, height, background: color.bg, borderLeft: `3px solid ${color.border}`, borderRadius: '5px', padding: '3px 6px', overflow: 'hidden', cursor: isDragging ? 'grabbing' : 'grab', zIndex: isDragging ? 20 : 5, boxShadow: isDragging ? '0 4px 16px rgba(0,0,0,0.5)' : '0 1px 4px rgba(0,0,0,0.35)', opacity: isDragging ? 0.9 : 1, transition: isDragging ? 'none' : 'filter 0.12s, box-shadow 0.12s', userSelect: 'none' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: color.text, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
