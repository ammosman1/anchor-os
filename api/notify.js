// api/notify.js
// Sends a push notification to a specific user via FCM.
// Called internally by cron routes.

import { getAdminDb, getAdminMessaging } from './_firebase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Require internal secret so this can't be called arbitrarily
  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { uid, title, body, data = {} } = req.body;
  if (!uid || !title || !body) {
    return res.status(400).json({ error: 'uid, title, and body required' });
  }

  try {
    const db = getAdminDb();
    const userDoc = await db.collection('users').doc(uid).get();
    const fcmToken = userDoc.data()?.fcmToken;

    if (!fcmToken) {
      return res.status(200).json({ sent: false, reason: 'no FCM token on file' });
    }

    const messaging = getAdminMessaging();
    await messaging.send({
      token: fcmToken,
      notification: { title, body },
      data,
      webpush: {
        notification: {
          title,
          body,
          icon: '/logo192.png',
          badge: '/logo192.png',
        },
        fcmOptions: { link: '/' },
      },
    });

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('notify error:', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
