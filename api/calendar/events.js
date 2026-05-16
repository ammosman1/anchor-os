// api/calendar/events.js
// Fetches calendar events for a time range using a client-supplied access token

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { accessToken, timeMin, timeMax } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' });

  const now = new Date();
  const params = new URLSearchParams({
    timeMin:      timeMin || new Date(now.setHours(0, 0, 0, 0)).toISOString(),
    timeMax:      timeMax || new Date(now.setHours(23, 59, 59, 999)).toISOString(),
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '50',
  });

  try {
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!calRes.ok) {
      const err = await calRes.json();
      return res.status(calRes.status).json({ error: err.error?.message || 'Calendar API error' });
    }

    const data = await calRes.json();
    return res.status(200).json({ events: data.items || [] });
  } catch (err) {
    console.error('Calendar events error:', err);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
}
