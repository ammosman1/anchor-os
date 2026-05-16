// api/calendar/refresh.js
// Exchanges a refresh token for a new access token — keeps client secret server-side

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id:     process.env.GOOGLE_CALENDAR_CLIENT_ID,
        client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
        grant_type:    'refresh_token',
      }),
    });

    const data = await tokenRes.json();
    if (data.error) return res.status(400).json({ error: data.error });

    return res.status(200).json({
      accessToken: data.access_token,
      expiresAt:   Date.now() + data.expires_in * 1000,
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    return res.status(500).json({ error: 'Token refresh failed' });
  }
}
