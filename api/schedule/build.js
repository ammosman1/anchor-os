// api/schedule/build.js
// AI-powered schedule builder — assigns tasks to free calendar slots
// Supports multi-day scheduling (today / tomorrow / this week)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { tasks, slotsMap, days, focusProfile } = req.body;
  if (!tasks?.length) return res.status(400).json({ error: 'tasks required' });
  if (!slotsMap || !days?.length) return res.status(400).json({ error: 'slotsMap and days required' });

  const energyLevel = focusProfile?.recentEnergy ?? 70;
  const energyNote =
    energyLevel < 45 ? 'Low energy — schedule light, leave breathing room between blocks.' :
    energyLevel > 75 ? 'High energy — can handle more complex and back-to-back blocks.' :
    'Moderate energy — mix deep and lighter tasks, avoid over-scheduling.';

  const daysJson = days.map(d => ({ date: d, slots: slotsMap[d] || [] }));

  const prompt = `Build a realistic time-blocked schedule for Andrew.

SCHEDULING WINDOW: ${days[0]} through ${days[days.length - 1]} (${days.length} day${days.length > 1 ? 's' : ''})

TASKS TO SCHEDULE (sorted by priority — schedule critical/high earlier in the day/week):
${JSON.stringify(tasks, null, 2)}

FREE TIME SLOTS PER DAY:
${JSON.stringify(daysJson, null, 2)}

FOCUS WINDOWS:
- Morning 8am–12pm → deep work (financial review, planning, drafting, strategic decisions)
- Early afternoon 1pm–3pm → medium tasks (calls, research, follow-ups)
- Late afternoon 3pm–6pm → quick tasks (emails, admin, short actions)

ENERGY CONTEXT: ${energyNote}

RULES:
- Critical and high priority tasks get the earliest, best available slots
- Never schedule deep work in an afternoon low-focus slot if a morning slot is available
- Add 10-minute buffers between consecutive blocks — don't stack them back-to-back
- Do not schedule more than 5 hours of focused work per day
- If a task won't fit one day, roll it to the next available day
- If a task won't fit in the entire window, omit it — do not overload
- estimatedMinutes is the actual working time needed, not elapsed calendar time
- Respect the exact start/end boundaries of each free slot
- Distribute tasks evenly across days — don't pile everything on day 1

Return ONLY valid JSON — no markdown, no explanation:
{
  "schedule": [
    {
      "taskTitle": "exact task title",
      "taskId": "firestore id or null",
      "date": "YYYY-MM-DD",
      "start": "ISO 8601 datetime",
      "end": "ISO 8601 datetime",
      "durationMinutes": 60,
      "focusType": "deep",
      "reason": "one brief sentence"
    }
  ]
}

Allowed: focusType = "deep" | "medium" | "quick"`;

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
        max_tokens: 3000,
        system: 'You are a precise scheduling engine. Return only valid JSON. No preamble, no explanation, no markdown fences.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return res.status(500).json({ error: 'AI request failed' });
    }

    const data   = await response.json();
    const raw    = data?.content?.[0]?.text || '{"schedule":[]}';
    const clean  = raw.replace(/```json|```/g, '').trim();
    const match  = clean.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { schedule: [] };

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Schedule build error:', err);
    return res.status(500).json({ error: 'Schedule build failed' });
  }
}
