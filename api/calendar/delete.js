// api/calendar/delete.js
// Deletes a calendar event by ID

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { accessToken, eventId } = req.body;
  if (!accessToken || !eventId) return res.status(400).json({ error: 'accessToken and eventId required' });

  try {
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!calRes.ok && calRes.status !== 204) {
      return res.status(calRes.status).json({ error: 'Calendar API error' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Calendar delete error:', err);
    return res.status(500).json({ error: 'Failed to delete event' });
  }
}
