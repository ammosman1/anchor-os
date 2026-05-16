// api/calendar/callback.js
// Handles Google OAuth callback, exchanges code for tokens, redirects to app

export default async function handler(req, res) {
  const { code, state: uid, error } = req.query;

  if (error || !code) {
    return res.redirect(`https://anchor-os-six.vercel.app/?calendarError=${encodeURIComponent(error || 'no_code')}`);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CALENDAR_CLIENT_ID,
        client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
        redirect_uri:  'https://anchor-os-six.vercel.app/api/calendar/callback',
        grant_type:    'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();

    if (tokens.error) {
      return res.redirect(`https://anchor-os-six.vercel.app/?calendarError=${encodeURIComponent(tokens.error)}`);
    }

    // Pass tokens back to client via URL — client immediately saves to Firestore and clears URL
    const params = new URLSearchParams({
      calendarConnected: '1',
      uid,
      at:  tokens.access_token,
      rt:  tokens.refresh_token,
      exp: String(Date.now() + tokens.expires_in * 1000),
    });

    res.redirect(`https://anchor-os-six.vercel.app/?${params}`);
  } catch (err) {
    console.error('Calendar callback error:', err);
    res.redirect('https://anchor-os-six.vercel.app/?calendarError=server_error');
  }
}
