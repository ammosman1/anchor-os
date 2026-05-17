// api/agent/weekly.js
// Cron: Monday 6:00am CST (12:00 UTC Monday) — weekly momentum review
// Generates a weekly summary and sends FCM push.

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
      max_tokens: 400,
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

    // Last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const userDoc of usersSnap.docs) {
      const uid  = userDoc.id;
      const user = userDoc.data();

      // Completed tasks this week
      const tasksSnap = await db.collection('users').doc(uid).collection('tasks')
        .where('done', '==', true)
        .orderBy('updatedAt', 'desc')
        .limit(30)
        .get();
      const completedTasks = tasksSnap.docs
        .map(d => d.data())
        .filter(t => t.updatedAt?.toDate?.() >= sevenDaysAgo || (t.completedAt && new Date(t.completedAt) >= sevenDaysAgo));

      // Active goals
      const goalsSnap = await db.collection('users').doc(uid).collection('goals')
        .where('status', '==', 'active')
        .limit(5)
        .get();
      const goals = goalsSnap.docs.map(d => d.data());

      // Rolled over or dropped tasks
      const rolledSnap = await db.collection('users').doc(uid).collection('tasks')
        .where('status', '==', 'rolled_over')
        .limit(10)
        .get();

      const prompt = `Weekly review for ${user.displayName || 'Andrew'}.
Week ending: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}

Completed this week: ${completedTasks.slice(0,10).map(t => t.title).join(', ') || 'none tracked'}
Rolled over tasks: ${rolledSnap.docs.length}
Active goals: ${goals.map(g => `${g.title} (${g.likelihoodScore ?? '?'}/100)`).join(', ') || 'none'}

Write a sharp weekly summary push notification. What was the win, what needs attention this week. Max 2 sentences, under 150 chars total.`;

      const summary = (await callAI(prompt)).split('\n')[0].slice(0, 150);

      await sendPush(user.fcmToken, '◆ Weekly Review Ready', summary || 'Your week is done. Time to plan the next one.');

      // Save weekly summary to AI cache
      await db.collection('users').doc(uid).collection('aiCache').doc('weekly-review').set({
        text: summary,
        cachedAt: new Date(),
        cachedAtMs: Date.now(),
      });

      results.push({ uid, completedCount: completedTasks.length, sent: !!user.fcmToken });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Weekly cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
