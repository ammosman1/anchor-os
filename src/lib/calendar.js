// src/lib/calendar.js
// Client-side Google Calendar helpers — all API calls go through Vercel functions

import { saveCalendarTokens } from './db';

// ─── OAuth ────────────────────────────────────────────────────────────────────

export function initiateCalendarAuth(uid) {
  window.location.href = `/api/calendar/auth?uid=${uid}`;
}

// Called once on app load after the OAuth redirect lands back on the app.
// Reads tokens from URL params, saves to Firestore, clears URL.
export async function handleCalendarCallback(uid) {
  const params = new URLSearchParams(window.location.search);
  if (!params.get('calendarConnected')) return false;

  const at  = params.get('at');
  const rt  = params.get('rt');
  const exp = parseInt(params.get('exp'), 10);

  // Clear tokens from URL immediately — don't leave them in browser history
  window.history.replaceState({}, '', window.location.pathname);

  if (!uid || !at || !rt) return false;

  await saveCalendarTokens(uid, {
    accessToken:  at,
    refreshToken: rt,
    expiresAt:    exp,
    connected:    true,
    connectedAt:  Date.now(),
  });

  return true;
}

// ─── Token management ─────────────────────────────────────────────────────────

// Returns a valid access token, transparently refreshing if within 2 minutes of expiry.
// Pass the calendarIntegration object from Firestore/DataContext.
export async function getValidAccessToken(uid, calendarTokens) {
  if (!calendarTokens?.refreshToken) return null;

  const twoMinBuffer = 2 * 60 * 1000;
  if (calendarTokens.expiresAt && calendarTokens.expiresAt > Date.now() + twoMinBuffer) {
    return calendarTokens.accessToken;
  }

  try {
    const res = await fetch('/api/calendar/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: calendarTokens.refreshToken }),
    });

    if (!res.ok) return null;
    const data = await res.json();

    await saveCalendarTokens(uid, {
      ...calendarTokens,
      accessToken: data.accessToken,
      expiresAt:   data.expiresAt,
    });

    return data.accessToken;
  } catch {
    return null;
  }
}

// ─── Calendar API calls ───────────────────────────────────────────────────────

export async function getEvents(accessToken, timeMin, timeMax) {
  const res = await fetch('/api/calendar/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, timeMin, timeMax }),
  });
  if (!res.ok) throw new Error('Failed to fetch calendar events');
  return res.json(); // { events: [...] }
}

// event shape: { summary, description, start: { dateTime }, end: { dateTime }, location? }
export async function createEvent(accessToken, event) {
  const res = await fetch('/api/calendar/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, event }),
  });
  if (!res.ok) throw new Error('Failed to create calendar event');
  return res.json(); // created event object with id
}

export async function deleteEvent(accessToken, eventId) {
  const res = await fetch('/api/calendar/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, eventId }),
  });
  if (!res.ok) throw new Error('Failed to delete calendar event');
  return res.json();
}

// ─── Free slot detection ──────────────────────────────────────────────────────

// Given a list of events for a day, returns free time slots >= 30 min within work hours.
// workHours shape: { monday: { enabled, start: 'HH:MM', end: 'HH:MM' }, ... }
export function getFreeSlots(events, date, workHours = null) {
  const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayName   = DAY_NAMES[new Date(date).getDay()];

  let startH = 7, startM = 0, endH = 21, endM = 0;
  if (workHours?.[dayName]) {
    const cfg = workHours[dayName];
    if (!cfg.enabled) return [];
    [startH, startM] = cfg.start.split(':').map(Number);
    [endH,   endM  ] = cfg.end.split(':').map(Number);
  }

  const dayStart = new Date(new Date(date).setHours(startH, startM, 0, 0));
  const dayEnd   = new Date(new Date(date).setHours(endH,   endM,   0, 0));

  const busy = events
    .filter(e => e.start?.dateTime) // skip all-day events
    .map(e => ({ start: new Date(e.start.dateTime), end: new Date(e.end.dateTime) }))
    .filter(e => e.start < dayEnd && e.end > dayStart)
    .sort((a, b) => a.start - b.start);

  const slots = [];
  let cursor = dayStart;

  for (const event of busy) {
    if (event.start > cursor) {
      const mins = Math.round((event.start - cursor) / 60000);
      if (mins >= 30) slots.push({ start: cursor.toISOString(), end: event.start.toISOString(), durationMins: mins });
    }
    if (event.end > cursor) cursor = event.end;
  }

  if (cursor < dayEnd) {
    const mins = Math.round((dayEnd - cursor) / 60000);
    if (mins >= 30) slots.push({ start: cursor.toISOString(), end: dayEnd.toISOString(), durationMins: mins });
  }

  return slots;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function formatEventTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatEventDuration(startIso, endIso) {
  const mins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
