// api/_email.js
// Sends email via the Resend REST API (no SDK dependency).
//
// Required env var:  RESEND_API_KEY
// Optional env var:  EMAIL_FROM  (default: 'Anchor <onboarding@resend.dev>')
//
// NOTE: The shared Resend domain (onboarding@resend.dev) only delivers to the
// email address that owns the Resend account.  For reliable delivery to any
// address, verify a custom domain in the Resend dashboard and set EMAIL_FROM
// to something like:  Anchor <briefings@yourdomain.com>

export async function sendEmail({ to, subject, html, text = '' }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log('[email] RESEND_API_KEY not configured — skipping email to', to);
    return null;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Anchor <onboarding@resend.dev>',
        to:   Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[email] Resend error:', res.status, JSON.stringify(data));
      return null;
    }
    return data;
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    return null;
  }
}

// ─── HTML email helpers ────────────────────────────────────────────────────────

function emailWrap(bodyContent, appUrl = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a1a;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <div style="background:#ffffff;border-radius:10px;border:1px solid #e0ddd6;overflow:hidden;">
    ${bodyContent}
    <div style="padding:16px 24px;text-align:center;background:#f8f7f4;border-top:1px solid #e0ddd6;">
      <span style="font-size:11px;color:#9b9b9b;">Anchor · Your AI Operating System</span>
      ${appUrl ? `&nbsp;·&nbsp;<a href="${appUrl}" style="font-size:11px;color:#8b7355;text-decoration:none;">Open app →</a>` : ''}
    </div>
  </div>
</div>
</body>
</html>`;
}

function section(title, rows, color = '#8b8b8b') {
  if (!rows || rows.length === 0) return '';
  return `
  <div style="padding:16px 24px;border-top:1px solid #eeece8;">
    <div style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">${title}</div>
    ${rows.map(r => `<div style="padding:8px 12px;background:#f8f7f4;border-radius:6px;border:1px solid #e8e5e0;margin-bottom:6px;font-size:13px;line-height:1.5;color:#2a2a2a;">${r}</div>`).join('')}
  </div>`;
}

export function buildMorningEmail({ date, briefing, scheduledToday, highPriority, atRisk, deadlineRisk, reworkTasks, plaidSummary, appUrl }) {
  const header = `
  <div style="padding:20px 24px 16px;border-bottom:1px solid #e0ddd6;">
    <div style="font-size:10px;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">${date}</div>
    <h1 style="margin:0;font-size:20px;font-weight:700;color:#1a1a1a;">☀ Morning Briefing</h1>
  </div>
  <div style="padding:20px 24px;background:#faf9f6;border-bottom:1px solid #e0ddd6;">
    <div style="font-size:10px;font-weight:700;color:#8b7355;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">ANCHOR SAYS</div>
    <div style="font-size:14px;line-height:1.7;color:#2a2a2a;">${(briefing || '').replace(/\n/g, '<br>')}</div>
  </div>`;

  const schedRows   = (scheduledToday || []).map(t =>
    `${appUrl && t.id ? `<a href="${appUrl}/tasks?complete=${t.id}" style="float:right;font-size:11px;color:#5a8f5a;text-decoration:none;font-weight:600;margin-top:1px;">✓ Done</a>` : ''}${t.title}${t.scheduledStart ? ` <span style="color:#8b8b8b;font-size:11px;">· ${new Date(t.scheduledStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>` : ''}`
  );
  const prioRows    = (highPriority || []).map(t =>
    `<span style="float:right;font-size:10px;font-weight:700;text-transform:uppercase;color:${t.priority === 'critical' ? '#c0392b' : '#c8a96e'};">${t.priority}</span>${appUrl && t.id ? `<a href="${appUrl}/tasks?complete=${t.id}" style="float:right;font-size:11px;color:#5a8f5a;text-decoration:none;font-weight:600;margin-right:8px;margin-top:1px;">✓ Done</a>` : ''}${t.title}`
  );
  const reworkRows  = (reworkTasks || []).map(t => `⚑ ${t.title}`);
  const deadlineRows = (deadlineRisk || []).map(d => `⏱ ${d}`);
  const atRiskRows  = (atRisk || []).map(g => `${g.title} <span style="color:#c0392b;font-size:11px;">${g.likelihoodScore}%</span>`);
  const finRows     = plaidSummary ? [plaidSummary] : [];

  const body = header
    + section(`Scheduled Today (${schedRows.length})`, schedRows)
    + section('Top Priorities', prioRows)
    + section('⚑ Rework from Yesterday', reworkRows, '#c0392b')
    + section('⏱ Deadline Risk', deadlineRows, '#c8a96e')
    + section('Goals at Risk', atRiskRows, '#c0392b')
    + section('Financials', finRows, '#5a8f5a');

  return emailWrap(body, appUrl);
}

export function buildWeeklyEmail({ weekEnd, synthesis, completedCount, deepDone, shallowDone, adminDone, onTrack, atRisk, improving, declining, plaidSummary, appUrl }) {
  const header = `
  <div style="padding:20px 24px 16px;border-bottom:1px solid #e0ddd6;">
    <div style="font-size:10px;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Week ending ${weekEnd}</div>
    <h1 style="margin:0;font-size:20px;font-weight:700;color:#1a1a1a;">◆ Weekly Digest</h1>
  </div>
  <div style="padding:20px 24px;background:#faf9f6;border-bottom:1px solid #e0ddd6;">
    <div style="font-size:10px;font-weight:700;color:#8b7355;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">THIS WEEK</div>
    <div style="font-size:14px;line-height:1.7;color:#2a2a2a;">${(synthesis || '').replace(/\n/g, '<br>')}</div>
  </div>`;

  const execRows  = [
    `${completedCount} tasks completed — ${deepDone} deep · ${shallowDone} shallow · ${adminDone} admin`,
  ];
  const goalRows  = [
    ...(onTrack  || []).map(g => `✓ ${g.title} <span style="color:#5a8f5a;font-size:11px;">${g.likelihoodScore != null ? g.likelihoodScore + '%' : 'on track'}</span>`),
    ...(atRisk   || []).map(g => `⚑ ${g.title} <span style="color:#c0392b;font-size:11px;">${g.likelihoodScore}%</span>`),
    ...(improving || []).filter(g => !(onTrack || []).find(o => o.title === g.title)).map(g => `↑ ${g.title}`),
    ...(declining || []).map(g => `↓ ${g.title}`),
  ];
  const finRows   = plaidSummary ? [plaidSummary] : [];

  const body = header
    + section('Execution', execRows, '#5a8f5a')
    + section('Goal Trajectory', goalRows)
    + section('Financials', finRows, '#5a8f5a');

  return emailWrap(body, appUrl);
}
