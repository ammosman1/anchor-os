// api/schedule/parse-photo.js
// Accepts a base64 image of a work calendar and extracts events using Claude Vision.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64, mediaType = 'image/jpeg' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const prompt = `You are analyzing a screenshot or photo of a work calendar. This is likely Microsoft Outlook, Teams, or a printed/displayed schedule.

TODAY'S DATE FOR REFERENCE: ${today}

Extract ALL visible calendar events and meetings from this image. For each one:
- title: the meeting/event name (exactly as shown)
- date: YYYY-MM-DD (infer the year from context; if unclear use the current year)
- startTime: 24-hour HH:MM (e.g. "09:00", "14:30") — use the grid position if no time label is visible
- endTime: 24-hour HH:MM
- allDay: true only if it's an explicit all-day banner with no start/end time
- location: room name, "Teams", "Zoom", or "" if not shown

Also identify the full date range visible in the image:
- rangeStart: earliest visible date YYYY-MM-DD
- rangeEnd: latest visible date YYYY-MM-DD

Guidelines:
- A week view will show 5-7 days. A day view shows one day. Identify which.
- If a meeting spans multiple days, create one entry per day it appears on.
- If start/end times are ambiguous, use the block height/position to estimate duration (default 30 min if truly unknown).
- Exclude all-day "Out of Office" or holiday banners unless they are actual meetings.

Return ONLY valid JSON — no markdown, no explanation:
{
  "rangeStart": "YYYY-MM-DD",
  "rangeEnd": "YYYY-MM-DD",
  "viewType": "day" | "week" | "month" | "list",
  "events": [
    {
      "title": "Meeting name",
      "date": "YYYY-MM-DD",
      "startTime": "09:00",
      "endTime": "10:00",
      "allDay": false,
      "location": ""
    }
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic vision error:', err);
      return res.status(500).json({ error: 'AI parsing failed' });
    }

    const data   = await response.json();
    const raw    = data?.content?.[0]?.text || '{}';
    const clean  = raw.replace(/```json|```/g, '').trim();
    const match  = clean.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { events: [], rangeStart: null, rangeEnd: null };

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Photo parse error:', err);
    return res.status(500).json({ error: 'Parsing failed' });
  }
}
