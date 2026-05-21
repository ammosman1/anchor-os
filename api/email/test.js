// api/email/test.js
// Sends a test email to verify Resend delivery is working end-to-end.
// Requires a valid Firebase ID token in the Authorization header.

import { getAdminDb, verifyAuthToken } from '../_firebase-admin.js';
import { sendEmail } from '../_email.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let uid;
  try {
    const decoded = await verifyAuthToken(req);
    uid = decoded.uid;
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db      = getAdminDb();
  const userDoc = await db.collection('users').doc(uid).get();
  const email   = userDoc.data()?.email;

  if (!email) {
    return res.status(400).json({
      error: 'No email address on file. Sign out and back in to sync your email, then try again.',
    });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY is not configured in Vercel environment variables.' });
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:24px 16px;">
  <div style="background:#fff;border-radius:10px;border:1px solid #e0ddd6;overflow:hidden;">
    <div style="padding:24px;border-bottom:1px solid #e0ddd6;">
      <h1 style="margin:0;font-size:20px;font-weight:700;color:#1a1a1a;">✓ Anchor email is working</h1>
      <p style="margin:12px 0 0;font-size:14px;color:#555;line-height:1.6;">
        Your morning briefings and weekly digests will arrive at this address.
        Morning emails go out at 6:30am CST; weekly digests arrive Sunday evenings.
      </p>
    </div>
    <div style="padding:16px 24px;background:#f8f7f4;text-align:center;">
      <span style="font-size:11px;color:#9b9b9b;">Anchor · Your AI Operating System</span>
    </div>
  </div>
</div>
</body></html>`;

  const result = await sendEmail({
    to:      email,
    subject: '✓ Anchor email test — briefings are active',
    html,
    text:    'Your Anchor email briefings are working. Morning emails go out at 6:30am CST; weekly digests arrive Sunday evenings.',
  });

  if (!result) {
    return res.status(500).json({ error: 'Email send failed. Check Vercel function logs for details.' });
  }

  return res.status(200).json({ ok: true, sentTo: email });
}
