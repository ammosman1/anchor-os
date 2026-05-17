// api/agent/eod.js
// Cron: 9:00pm CST (02:00 UTC next day) daily
// Sends an end-of-day check-in push reminding the user to do an EOD review.

import { getAdminDb, getAdminMessaging } from '../_firebase-admin.js';

const ANDREW_CONTEXT = `You are Anchor — Andrew Mosman's personal AI operating system.
Be brief, direct, strategic. No fluff.`;

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
      max_tokens: 150,
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
        fcmOptions: { link: '/review' },
      },
    });
  } catch (err) {
    console.error('FCM send error:', err.message);
  }
}

export default async function handler(req, res) {
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

      const today = new Date().toISOString().split('T')[0];

      // Count completed vs unfinished tasks today
      const tasksSnap = await db.collection('users').doc(uid).collection('tasks')
        .where('scheduledDate', '==', today)
        .limit(20)
        .get();
      const tasks     = tasksSnap.docs.map(d => d.data());
      const completed = tasks.filter(t => t.done).length;
      const total     = tasks.length;
      const unfinished = tasks.filter(t => !t.done).map(t => t.title).slice(0, 3);

      const prompt = `EOD check-in for ${user.displayName || 'Andrew'}.
Today ${today}: ${completed}/${total} scheduled tasks done.
${unfinished.length ? `Unfinished: ${unfinished.join(', ')}` : 'All tasks complete.'}

One sharp sentence for an end-of-day push notification. Acknowledge progress, prompt review. Under 100 chars.`;

      const msg = (await callAI(prompt)).split('\n')[0].slice(0, 100);
      await sendPush(user.fcmToken, '◷ EOD Check-In', msg || 'Time to review your day. Tap to open.');

      results.push({ uid, completed, total, sent: !!user.fcmToken });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('EOD cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
