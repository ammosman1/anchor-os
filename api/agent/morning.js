// api/agent/morning.js
// Cron: 6:30am CST (11:30 UTC) daily
// Generates a morning briefing with full context: goals, Plaid, reviews, deadline risks.
// Sends a push notification (short teaser) + HTML email (full briefing via Resend).

import { getAdminDb, getAdminMessaging } from '../_firebase-admin.js';
import { sendEmail, buildMorningEmail } from '../_email.js';

const SYSTEM = `You are Anchor — Andrew Mosman's personal AI operating system.
Be brief, direct, strategic. No fluff. Think chief of staff, not life coach.`;

async function callAI(prompt, maxTokens = 300) {
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

async function sendPush(fcmToken, title, body, link = '/') {
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
    const db      = getAdminDb();
    const usersSnap = await db.collection('users').get();
    const results = [];

    for (const userDoc of usersSnap.docs) {
      const uid  = userDoc.id;
      const user = userDoc.data();

      const today     = new Date();
      const todayStr  = ymd(today);
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const yesterStr = ymd(yesterday);
      const in7       = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

      // ── Tasks ─────────────────────────────────────────────────────────────
      const tasksSnap = await db.collection('users').doc(uid).collection('tasks')
        .where('done', '==', false)
        .limit(40)
        .get();
      const tasks        = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const scheduledToday = tasks.filter(t =>
        t.scheduledDate === todayStr ||
        (t.scheduledStart && t.scheduledStart.startsWith(todayStr))
      ).sort((a, b) => (a.scheduledStart || '').localeCompare(b.scheduledStart || ''));

      const highPriority = tasks
        .filter(t => t.priority === 'critical' || t.priority === 'high')
        .slice(0, 5);

      const reworkTasks = tasks.filter(t =>
        t.scheduledDate === yesterStr && (t.priority === 'critical' || t.priority === 'high')
      );

      const deadlineRisk = tasks.filter(t => {
        if (!t.dueDate) return false;
        const due = new Date(t.dueDate);
        return due >= today && due <= in7 && !t.scheduledStart && !t.scheduledDate;
      }).map(t => `${t.title} (due ${t.dueDate})`);

      // ── Goals ─────────────────────────────────────────────────────────────
      const goalsSnap = await db.collection('users').doc(uid).collection('goals')
        .where('status', '==', 'active')
        .limit(10)
        .get();
      const goals     = goalsSnap.docs.map(d => d.data());
      const atRisk    = goals.filter(g => g.likelihoodScore != null && g.likelihoodScore < 50);
      const onTrack   = goals.filter(g => g.likelihoodScore != null && g.likelihoodScore >= 70);

      // ── Last weekly review ────────────────────────────────────────────────
      const reviewSnap = await db.collection('users').doc(uid).collection('weeklyReviews')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      const lastReview = reviewSnap.docs[0]?.data() || null;

      // ── Teller cash flow (if available) ──────────────────────────────────
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
                plaidSummary = `Monthly cash flow: $${Math.round(income).toLocaleString()} income, $${Math.round(spending).toLocaleString()} spending, $${Math.round(surplus).toLocaleString()} surplus.`;
              }
            }
          } catch { /* skip */ }
        }
      }

      // ── Build prompt ──────────────────────────────────────────────────────
      const prompt = `Morning briefing for ${user.displayName || 'Andrew'}.
TODAY: ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}

SCHEDULED TODAY (${scheduledToday.length}):
${scheduledToday.map(t => `- ${t.title}${t.scheduledStart ? ` @ ${new Date(t.scheduledStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}`).join('\n') || '- Nothing scheduled'}

TOP PRIORITIES:
${highPriority.map(t => `- [${t.priority}] ${t.title}${t.focusType ? ` (${t.focusType})` : ''}`).join('\n') || '- None'}

GOALS (${goals.length} active):
- On track (≥70): ${onTrack.map(g => g.title).join(', ') || 'none'}
- At risk (<50): ${atRisk.map(g => `${g.title} (${g.likelihoodScore}%)`).join(', ') || 'none'}

${reworkTasks.length > 0 ? `REWORK NEEDED: ${reworkTasks.map(t => t.title).join(', ')}\n` : ''}${deadlineRisk.length > 0 ? `DEADLINE RISK (unscheduled, due <7 days): ${deadlineRisk.join(', ')}\n` : ''}${plaidSummary ? `\nFINANCIALS: ${plaidSummary}` : ''}${lastReview ? `\nLAST REVIEW: energy ${lastReview.energyScore}/100, execution ${lastReview.executionScore}/100` : ''}

Write a sharp 2-sentence morning briefing. What is the single most important thing to move forward today, and what is the key risk or opportunity to address. Be specific — reference actual tasks and goals by name.`;

      const briefing  = await callAI(prompt, 350);
      const firstLine = briefing.split('\n').filter(Boolean)[0]?.slice(0, 150) || briefing.slice(0, 150);

      await sendPush(user.fcmToken, '☀ Morning Anchor', firstLine, '/');

      // ── Morning email ─────────────────────────────────────────────────────
      const userEmail = user.email;
      if (userEmail) {
        const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
        const html   = buildMorningEmail({
          date:           today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
          briefing,
          scheduledToday,
          highPriority,
          atRisk,
          deadlineRisk:   deadlineRisk.map(d => d),
          reworkTasks,
          plaidSummary,
          appUrl,
        });
        await sendEmail({
          to:      userEmail,
          subject: `☀ Morning Briefing — ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
          html,
          text:    briefing,
        });
      }

      if (reworkTasks.length > 0) {
        const reworkMsg = reworkTasks.length === 1
          ? `"${reworkTasks[0].title}" wasn't completed yesterday — reschedule it now`
          : `${reworkTasks.length} high-priority tasks from yesterday need rescheduling`;
        await sendPush(user.fcmToken, '⚑ Rework needed', reworkMsg, '/calendar');
      }

      if (deadlineRisk.length > 0) {
        await sendPush(
          user.fcmToken,
          `⏱ ${deadlineRisk.length} deadline${deadlineRisk.length > 1 ? 's' : ''} approaching`,
          `Unscheduled tasks due this week. Tap to plan.`,
          '/calendar'
        );
      }

      await db.collection('users').doc(uid).collection('aiCache').doc('morning-briefing').set({
        text:       briefing,
        cachedAt:   new Date(),
        cachedAtMs: Date.now(),
      });

      // Renew Google Calendar webhook if expiring within 4 hours
      const watch = user.calendarWatch;
      if (watch?.channelId && watch.expiration) {
        const fourHours = 4 * 60 * 60 * 1000;
        if (watch.expiration - Date.now() < fourHours && user.calendarIntegration?.refreshToken) {
          try {
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

      results.push({ uid, sent: !!user.fcmToken, goals: goals.length, atRisk: atRisk.length });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Morning cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
