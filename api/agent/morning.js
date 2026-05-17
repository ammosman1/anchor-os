// api/agent/morning.js
// Cron: 6:30am CST (11:30 UTC) daily
// Generates a morning briefing and sends FCM push to each user.

import { getAdminDb, getAdminMessaging } from '../_firebase-admin.js';

const ANDREW_CONTEXT = `You are Anchor — Andrew Mosman's personal AI operating system.
Be brief, direct, strategic. No fluff. Think chief of staff, not life coach.`;

async function callAI(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: ANDREW_CONTEXT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || '';
}

async function sendPush(fcmToken, title, body) {
  if (!fcmToken) return;
  const messaging = getAdminMessaging();
  try {
    await messaging.send({
      token: fcmToken,
      notification: { title, body },
      webpush: {
        notification: { title, body, icon: '/logo192.png' },
        fcmOptions: { link: '/' },
      },
    });
  } catch (err) {
    console.error('FCM send error:', err.message);
  }
}

export default async function handler(req, res) {
  // Vercel sends authorization header with CRON_SECRET
  const authHeader = req.headers.authorization || '';
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getAdminDb();
    const usersSnap = await db.collection('users').get();

    const results = [];

    for (const userDoc of usersSnap.docs) {
      const uid  = userDoc.id;
      const user = userDoc.data();

      // Get today's tasks
      const today = new Date().toISOString().split('T')[0];
      const tasksSnap = await db.collection('users').doc(uid).collection('tasks')
        .where('done', '==', false)
        .orderBy('priority')
        .limit(20)
        .get();
      const tasks = tasksSnap.docs.map(d => d.data());

      const scheduledToday = tasks.filter(t => t.scheduledDate === today);
      const highPriority   = tasks.filter(t => t.priority === 'critical' || t.priority === 'high').slice(0, 3);

      // Detect incomplete high-priority tasks from yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const yesterdayStr = ymd(yesterday);
      const reworkTasks = tasks.filter(t =>
        !t.done &&
        t.scheduledDate === yesterdayStr &&
        (t.priority === 'critical' || t.priority === 'high')
      );

      // Generate briefing
      const prompt = `Morning briefing for ${user.displayName || 'Andrew'}.
Today: ${today}
Scheduled today: ${scheduledToday.map(t => t.title).join(', ') || 'nothing scheduled'}
High priority tasks: ${highPriority.map(t => t.title).join(', ') || 'none'}
${reworkTasks.length > 0 ? `Incomplete from yesterday: ${reworkTasks.map(t => t.title).join(', ')}` : ''}

Give a sharp 2-sentence morning focus statement. What matters most today and why.`;

      const briefing = await callAI(prompt);
      const firstLine = briefing.split('\n')[0].slice(0, 120);

      await sendPush(user.fcmToken, '☀ Morning Anchor', firstLine);

      // Send rework alert if high-priority tasks weren't completed yesterday
      if (reworkTasks.length > 0) {
        const reworkMsg = reworkTasks.length === 1
          ? `"${reworkTasks[0].title}" wasn't completed yesterday — reschedule it now`
          : `${reworkTasks.length} high-priority tasks from yesterday need rescheduling`;
        await sendPush(user.fcmToken, '⚑ Schedule rework needed', reworkMsg);
      }

      // Save briefing to AI cache
      await db.collection('users').doc(uid).collection('aiCache').doc('morning-briefing').set({
        text: briefing,
        cachedAt: new Date(),
        cachedAtMs: Date.now(),
      });

      // Phase 4: Renew Google Calendar webhook if expiring within 4 hours
      const watch = user.calendarWatch;
      if (watch?.channelId && watch.expiration) {
        const fourHours = 4 * 60 * 60 * 1000;
        if (watch.expiration - Date.now() < fourHours && user.calendarIntegration?.refreshToken) {
          try {
            // Refresh access token first
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id:     process.env.GOOGLE_CALENDAR_CLIENT_ID,
                client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
                refresh_token: user.calendarIntegration.refreshToken,
                grant_type:    'refresh_token',
              }),
            });
            const tokenData = await tokenRes.json();
            if (tokenData.access_token) {
              const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
              await fetch(`${appUrl}/api/calendar/register-watch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid, accessToken: tokenData.access_token }),
              });
            }
          } catch (err) {
            console.error('Webhook renewal error for', uid, err.message);
          }
        }
      }

      results.push({ uid, sent: !!user.fcmToken });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Morning cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
