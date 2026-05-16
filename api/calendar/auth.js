// api/calendar/auth.js
// Redirects user to Google OAuth consent screen

export default function handler(req, res) {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: 'uid required' });

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CALENDAR_CLIENT_ID,
    redirect_uri:  'https://anchor-os-six.vercel.app/api/calendar/callback',
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar.events',
    access_type:   'offline',
    prompt:        'consent', // Always return refresh token
    state:         uid,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
