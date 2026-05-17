// api/agent/eod.js
// Cron: 9:00pm CST (02:00 UTC next day) daily
// Sends an end-of-day check-in with task execution breakdown and tomorrow preview.

import { getAdminDb, getAdminMessaging } from '../_firebase-admin.js';

const SYSTEM = `You are Anchor — Andrew Mosman's personal AI operating system.
Be brief, direct, strategic. No fluff.`;

async function callAI(prompt, maxTokens = 200) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || '';
}

async function sendPush(fcmToken, title, body, link = '/review') {
  if (!fcmToken) return;
  const messaging = getAdminMessaging();
  try {
    await messaging.send({
      token: fcmToken,
      notification: { title, body },
      webpush: {
        notification: { title, body, icon: '/logo192.png' },
        fcmOptions: { link },
      },
    });
  } catch (err) {
    console.error('FCM send error:', err.message);
  }
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db        = getAdminDb();
    const usersSnap = await db.collection('users').get();
    const results   = [];

    for (const userDoc of usersSnap.docs) {
      const uid  = userDoc.id;
      const user = userDoc.data();

      const today    = new Date();
      const todayStr = ymd(today);
      const tom      = new Date(today); tom.setDate(tom.getDate() + 1);
      const tomStr   = ymd(tom);

      // ── Today's tasks ─────────────────────────────────────────────────────
      const todayTasksSnap = await db.collection('users').doc(uid).collection('tasks')
        .where('scheduledDate', '==', todayStr)
        .limit(30)
        .get();
      const todayTasks  = todayTasksSnap.docs.map(d => d.data());
      const completed   = todayTasks.filter(t => t.done);
      const unfinished  = todayTasks.filter(t => !t.done);

      // Also grab tasks completed today by completedAt (catch tasks without scheduledDate)
      const completedSnap = await db.collection('users').doc(uid).collection('tasks')
        .where('done', '==', true)
        .orderBy('completedAt', 'desc')
        .limit(20)
        .get();
      const completedToday = completedSnap.docs.map(d => d.data())
        .filter(t => t.completedAt?.startsWith(todayStr));

      // Breakdown by focusType
      const deepDone    = completedToday.filter(t => !t.focusType || t.focusType === 'deep').length;
      const shallowDone = completedToday.filter(t => t.focusType === 'shallow').length;
      const adminDone   = completedToday.filter(t => t.focusType === 'admin').length;

      // ── Tomorrow's schedule ───────────────────────────────────────────────
      const tomTasksSnap = await db.collection('users').doc(uid).collection('tasks')
        .where('scheduledDate', '==', tomStr)
        .where('done', '==', false)
        .limit(10)
        .get();
      const tomTasks = tomTasksSnap.docs.map(d => d.data())
        .sort((a, b) => (a.scheduledStart || '').localeCompare(b.scheduledStart || ''));

      // ── Goals with recent task activity ───────────────────────────────────
      const goalsSnap = await db.collection('users').doc(uid).collection('goals')
        .where('status', '==', 'active')
        .limit(8)
        .get();
      const goals = goalsSnap.docs.map(d => d.data());
      const atRiskGoals = goals.filter(g => g.likelihoodScore != null && g.likelihoodScore < 50);

      const prompt = `EOD check-in for ${user.displayName || 'Andrew'}.
TODAY: ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}

EXECUTION TODAY:
- ${completed.length}/${todayTasks.length} scheduled tasks completed
- Deep work done: ${deepDone} | Shallow: ${shallowDone} | Admin: ${adminDone}
- Completed: ${completedToday.slice(0,5).map(t => t.title).join(', ') || 'none tracked'}
${unfinished.length > 0 ? `- Left unfinished: ${unfinished.map(t => t.title).join(', ')}` : '- All scheduled tasks complete'}

TOMORROW PREVIEW (${tomTasks.length} scheduled):
${tomTasks.slice(0,3).map(t => `- ${t.title}`).join('\n') || '- Nothing scheduled yet'}

GOALS (${atRiskGoals.length} at risk):
${atRiskGoals.map(g => `- ${g.title}: ${g.likelihoodScore}%`).join('\n') || '- All on track'}

Write a sharp 1-sentence EOD push notification. Acknowledge today's output, note what's ahead. Under 120 chars.`;

      const msg = (await callAI(prompt)).split('\n').filter(Boolean)[0]?.slice(0, 120) || 'Day done. Tap to review and set tomorrow's intentions.';
      await sendPush(user.fcmToken, '◷ EOD Check-In', msg);

      // Store EOD summary for the app to use in review screen
      await db.collection('users').doc(uid).collection('aiCache').doc('eod-briefing').set({
        text:           msg,
        completedCount: completedToday.length,
        unfinishedCount: unfinished.length,
        deepDone, shallowDone, adminDone,
        cachedAt:      new Date(),
        cachedAtMs:    Date.now(),
      });

      results.push({ uid, completed: completedToday.length, unfinished: unfinished.length, sent: !!user.fcmToken });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('EOD cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
