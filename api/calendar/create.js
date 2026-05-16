// api/calendar/create.js
// Creates a calendar event

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { accessToken, event } = req.body;
  if (!accessToken || !event) return res.status(400).json({ error: 'accessToken and event required' });

  try {
    const calRes = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    if (!calRes.ok) {
      const err = await calRes.json();
      return res.status(calRes.status).json({ error: err.error?.message || 'Calendar API error' });
    }

    const data = await calRes.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('Calendar create error:', err);
    return res.status(500).json({ error: 'Failed to create event' });
  }
}
