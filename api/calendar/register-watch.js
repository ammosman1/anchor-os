// api/calendar/register-watch.js
// Registers a Google Calendar push notification channel for a user.
// Called after OAuth connects and renewed daily by the morning cron.
// POST body: { uid, accessToken }

import { getAdminDb } from '../_firebase-admin.js';
import { randomUUID } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { uid, accessToken } = req.body;
  if (!uid || !accessToken) return res.status(400).json({ error: 'uid and accessToken required' });

  const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
  const webhookUrl = `${appUrl}/api/calendar/webhook`;

  const channelId  = randomUUID();
  const expiration = Date.now() + 23 * 60 * 60 * 1000; // 23h (Google max is 24h)

  try {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/watch',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id:         channelId,
          type:       'web_hook',
          address:    webhookUrl,
          expiration: expiration.toString(),
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('GCal watch register error:', err);
      return res.status(500).json({ error: 'Failed to register watch channel', details: err });
    }

    const data = await response.json();
    const resourceId = data.resourceId;

    // Store channelId + resourceId so we can stop/renew the channel later
    const db = getAdminDb();
    await db.collection('users').doc(uid).set({
      calendarWatch: {
        channelId,
        resourceId,
        expiration,
        registeredAt: Date.now(),
      },
    }, { merge: true });

    return res.status(200).json({ ok: true, channelId, resourceId, expiration });
  } catch (err) {
    console.error('register-watch error:', err);
    return res.status(500).json({ error: err.message });
  }
}
