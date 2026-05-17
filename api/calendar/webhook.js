// api/calendar/webhook.js
// Receives Google Calendar push notifications and syncs updated events back to Anchor tasks.
// Google sends a POST with headers: X-Goog-Channel-Id, X-Goog-Resource-State, X-Goog-Resource-Id

import { getAdminDb } from '../_firebase-admin.js';

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  return data.access_token;
}

async function fetchUpdatedEvents(accessToken, timeMin) {
  const timeMax = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '100');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  return data.items || [];
}

export default async function handler(req, res) {
  // Google sends both POST (notification) and GET (verification) requests
  if (req.method === 'GET') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const channelId     = req.headers['x-goog-channel-id'];
  const resourceState = req.headers['x-goog-resource-state'];

  // 'sync' is the initial handshake — just acknowledge
  if (resourceState === 'sync') return res.status(200).end();
  if (resourceState !== 'exists') return res.status(200).end();
  if (!channelId) return res.status(400).json({ error: 'missing channel id' });

  try {
    const db = getAdminDb();

    // Find the user whose channel this belongs to
    const usersSnap = await db.collection('users')
      .where('calendarWatch.channelId', '==', channelId)
      .limit(1)
      .get();

    if (usersSnap.empty) {
      console.warn('webhook: no user found for channelId', channelId);
      return res.status(200).end();
    }

    const userDoc = usersSnap.docs[0];
    const uid     = userDoc.id;
    const user    = userDoc.data();

    if (!user.calendarIntegration?.refreshToken) {
      return res.status(200).end();
    }

    // Get a fresh access token
    const accessToken = await refreshAccessToken(user.calendarIntegration.refreshToken);
    if (!accessToken) return res.status(200).end();

    // Fetch events updated in the next 2 weeks
    const timeMin = new Date().toISOString();
    const events  = await fetchUpdatedEvents(accessToken, timeMin);

    // Find tasks linked to these events and sync times
    const tasksSnap = await db.collection('users').doc(uid).collection('tasks')
      .where('done', '==', false)
      .get();

    const tasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const linkedTasks = tasks.filter(t => t.calendarEventId);

    const batch = db.batch();
    let synced = 0;

    for (const task of linkedTasks) {
      const ev = events.find(e => e.id === task.calendarEventId);
      if (!ev?.start?.dateTime) continue;

      const newStart = ev.start.dateTime;
      const newEnd   = ev.end?.dateTime;

      if (newStart !== task.scheduledStart || newEnd !== task.scheduledEnd) {
        const taskRef = db.collection('users').doc(uid).collection('tasks').doc(task.id);
        batch.update(taskRef, {
          scheduledDate:  newStart.split('T')[0],
          scheduledStart: newStart,
          scheduledEnd:   newEnd,
          updatedAt:      new Date(),
        });
        synced++;
      }
    }

    if (synced > 0) {
      await batch.commit();
      console.log(`webhook: synced ${synced} task(s) for uid ${uid}`);
    }

    return res.status(200).end();
  } catch (err) {
    console.error('webhook error:', err);
    // Always return 200 to Google so it doesn't retry aggressively
    return res.status(200).end();
  }
}
