// api/agent/weekly.js
// Cron: Sunday 7pm CDT / 6pm CST (00:00 UTC Monday) — weekly momentum review
// Generates a weekly synthesis with Plaid data, goal trajectory, and execution breakdown.
// Sends a push notification (first line) + HTML email (full synthesis via Resend).

import { getAdminDb, getAdminMessaging } from '../_firebase-admin.js';
import { sendEmail, buildWeeklyEmail } from '../_email.js';

const SYSTEM = `You are Anchor — Andrew Mosman's personal AI operating system.
Be brief, direct, strategic. No fluff. Think chief of staff, not life coach.`;

async function callAI(prompt, maxTokens = 400) {
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

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekStartStr = ymd(sevenDaysAgo);

    for (const userDoc of usersSnap.docs) {
      const uid  = userDoc.id;
      const user = userDoc.data();

      // ── Completed tasks this week ─────────────────────────────────────────
      const completedSnap = await db.collection('users').doc(uid).collection('tasks')
        .where('done', '==', true)
        .orderBy('completedAt', 'desc')
        .limit(50)
        .get();
      const completedThisWeek = completedSnap.docs.map(d => d.data())
        .filter(t => t.completedAt && t.completedAt >= weekStartStr);

      const deepDone    = completedThisWeek.filter(t => !t.focusType || t.focusType === 'deep').length;
      const shallowDone = completedThisWeek.filter(t => t.focusType === 'shallow').length;
      const adminDone   = completedThisWeek.filter(t => t.focusType === 'admin').length;

      // ── Active goals with trajectory ──────────────────────────────────────
      const goalsSnap = await db.collection('users').doc(uid).collection('goals')
        .where('status', '==', 'active')
        .limit(10)
        .get();
      const goals     = goalsSnap.docs.map(d => d.data());
      const atRisk    = goals.filter(g => g.likelihoodScore != null && g.likelihoodScore < 50);
      const onTrack   = goals.filter(g => g.likelihoodScore != null && g.likelihoodScore >= 70);
      const improving = goals.filter(g => g.likelihoodTrend === 'up');
      const declining = goals.filter(g => g.likelihoodTrend === 'down');

      // ── Last weekly review (user-submitted) ───────────────────────────────
      const reviewSnap = await db.collection('users').doc(uid).collection('weeklyReviews')
        .orderBy('createdAt', 'desc')
        .limit(2)
        .get();
      const reviews = reviewSnap.docs.map(d => d.data());
      const lastReview = reviews[0] || null;
      const prevReview = reviews[1] || null;

      // Trend vs prior week
      const energyTrend = lastReview && prevReview
        ? lastReview.energyScore - prevReview.energyScore
        : null;
      const execTrend = lastReview && prevReview
        ? lastReview.executionScore - prevReview.executionScore
        : null;

      // ── Teller cash flow ─────────────────────────────────────────────────
      let plaidSummary = '';
      const plaidSnap = await db.collection('users').doc(uid).collection('plaidItems')
        .limit(1).get();
      if (!plaidSnap.empty) {
        const tellerItem = plaidSnap.docs[0].data();
        if (tellerItem?.accessToken) {
          try {
            const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
            const txRes = await fetch(`${appUrl}/api/teller/transactions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accessToken: tellerItem.accessToken, days: 30 }),
            });
            if (txRes.ok) {
              const { transactions } = await txRes.json();
              if (transactions?.length) {
                // Normalized to Plaid convention: negative=income, positive=spending
                const income   = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
                const spending = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
                const surplus  = income - spending;
                plaidSummary = `Monthly: $${Math.round(income).toLocaleString()} income / $${Math.round(spending).toLocaleString()} spending / $${Math.round(surplus).toLocaleString()} surplus.`;
              }
            }
          } catch { /* skip */ }
        }
      }

      // ── Rolled-over tasks ─────────────────────────────────────────────────
      const rolledSnap = await db.collection('users').doc(uid).collection('tasks')
        .where('status', '==', 'rolled_over')
        .limit(10)
        .get();

      // ── Build prompt ──────────────────────────────────────────────────────
      const weekEnd = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      const prompt  = `Weekly synthesis for ${user.displayName || 'Andrew'}.
WEEK ENDING: ${weekEnd}

EXECUTION (${completedThisWeek.length} tasks completed):
- Deep work: ${deepDone} | Shallow: ${shallowDone} | Admin: ${adminDone}
- Notable completions: ${completedThisWeek.slice(0,8).map(t => t.title).join(', ') || 'none'}
- Rolled over: ${rolledSnap.docs.length}

GOAL TRAJECTORY:
- On track (≥70%): ${onTrack.length} goals — ${onTrack.map(g => g.title).join(', ') || 'none'}
- At risk (<50%): ${atRisk.length} goals — ${atRisk.map(g => `${g.title} (${g.likelihoodScore}%)`).join(', ') || 'none'}
- Improving (trend up): ${improving.map(g => g.title).join(', ') || 'none'}
- Declining (trend down): ${declining.map(g => g.title).join(', ') || 'none'}

${lastReview ? `LAST WEEKLY REVIEW:
- Energy: ${lastReview.energyScore}/100${energyTrend != null ? ` (${energyTrend >= 0 ? '+' : ''}${energyTrend} vs prior week)` : ''}
- Execution: ${lastReview.executionScore}/100${execTrend != null ? ` (${execTrend >= 0 ? '+' : ''}${execTrend})` : ''}
- Wins: ${(lastReview.wins || []).join(', ') || 'not recorded'}
- Bottlenecks: ${(lastReview.bottlenecks || []).join(', ') || 'none'}` : ''}

${plaidSummary ? `FINANCIALS: ${plaidSummary}` : ''}

Write a weekly synthesis. Format:
Line 1: One sentence — the week's headline (win + risk), under 160 chars.
Then 2-4 lines covering: execution quality, goal trajectory, top risk heading into next week, and what to focus on.
Be specific — name actual tasks, goals, and metrics. No fluff. Max 200 words total.`;

      const fullSummary = await callAI(prompt, 500) || 'Week complete. Tap to review and plan the next one.';
      const summaryLines = fullSummary.split('\n').filter(Boolean);
      const pushLine     = summaryLines[0]?.slice(0, 160) || fullSummary.slice(0, 160);

      await sendPush(user.fcmToken, '◆ Weekly Digest', pushLine);

      // ── Weekly email ─────────────────────────────────────────────────────
      const userEmail = user.email;
      if (userEmail) {
        const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
        const html   = buildWeeklyEmail({
          weekEnd,
          synthesis:      fullSummary,
          completedCount: completedThisWeek.length,
          deepDone, shallowDone, adminDone,
          onTrack, atRisk, improving, declining,
          plaidSummary,
          appUrl,
        });
        await sendEmail({
          to:      userEmail,
          subject: `◆ Weekly Digest — ${weekEnd}`,
          html,
          text:    fullSummary,
        });
      }

      // Save to AI cache
      await db.collection('users').doc(uid).collection('aiCache').doc('weekly-review').set({
        text:             fullSummary,
        completedCount:   completedThisWeek.length,
        deepDone, shallowDone, adminDone,
        atRiskCount:      atRisk.length,
        onTrackCount:     onTrack.length,
        cachedAt:         new Date(),
        cachedAtMs:       Date.now(),
      });

      results.push({ uid, completedCount: completedThisWeek.length, atRisk: atRisk.length, sent: !!user.fcmToken, emailed: !!userEmail });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Weekly cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
