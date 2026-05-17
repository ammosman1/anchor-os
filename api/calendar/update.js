// api/calendar/update.js
// Patches an existing calendar event (PATCH = partial update)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { accessToken, eventId, updates } = req.body;
  if (!accessToken || !eventId || !updates) {
    return res.status(400).json({ error: 'accessToken, eventId, and updates required' });
  }

  try {
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      }
    );

    if (!calRes.ok) {
      const err = await calRes.json();
      return res.status(calRes.status).json({ error: err.error?.message || 'Calendar API error' });
    }

    const data = await calRes.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('Calendar update error:', err);
    return res.status(500).json({ error: 'Failed to update event' });
  }
}
