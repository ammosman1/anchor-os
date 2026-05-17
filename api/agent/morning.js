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

      // Generate briefing
      const prompt = `Morning briefing for ${user.displayName || 'Andrew'}.
Today: ${today}
Scheduled today: ${scheduledToday.map(t => t.title).join(', ') || 'nothing scheduled'}
High priority tasks: ${highPriority.map(t => t.title).join(', ') || 'none'}

Give a sharp 2-sentence morning focus statement. What matters most today and why.`;

      const briefing = await callAI(prompt);
      const firstLine = briefing.split('\n')[0].slice(0, 120);

      await sendPush(user.fcmToken, '☀ Morning Anchor', firstLine);

      // Save briefing to AI cache
      await db.collection('users').doc(uid).collection('aiCache').doc('morning-briefing').set({
        text: briefing,
        cachedAt: new Date(),
        cachedAtMs: Date.now(),
      });

      results.push({ uid, sent: !!user.fcmToken });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Morning cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
