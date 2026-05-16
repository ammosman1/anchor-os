// api/schedule/build.js
// AI-powered schedule builder — assigns tasks to free calendar slots

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { tasks, slots, focusProfile, today, tomorrow } = req.body;
  if (!tasks?.length) return res.status(400).json({ error: 'tasks required' });

  const energyLevel = focusProfile?.recentEnergy ?? 70;
  const energyNote =
    energyLevel < 45 ? 'Low energy week — schedule light, leave breathing room between blocks.' :
    energyLevel > 75 ? 'High energy week — Andrew can handle more complex and back-to-back blocks.' :
    'Moderate energy — mix deep and lighter tasks, avoid over-scheduling.';

  const prompt = `Build a realistic time-blocked schedule for Andrew.

TODAY: ${today}
TOMORROW: ${tomorrow}

TASKS TO SCHEDULE (in priority order — schedule earlier in the day accordingly):
${JSON.stringify(tasks, null, 2)}

FREE TIME SLOTS:
Today: ${JSON.stringify(slots.today || [])}
Tomorrow: ${JSON.stringify(slots.tomorrow || [])}

FOCUS WINDOWS (assign tasks to matching windows):
- Morning 8am–12pm → deep work (financial review, planning, drafting, strategic decisions)
- Early afternoon 1pm–3pm → medium tasks (calls, research, follow-ups)
- Late afternoon 3pm–6pm → quick tasks (emails, admin, short actions)

ENERGY CONTEXT: ${energyNote}

RULES:
- Critical and high priority tasks get the best available slots
- Never put deep work in an afternoon low-focus slot if a morning slot is free
- Add 10-minute buffers between consecutive blocks — don't stack them back-to-back
- Do not schedule more than 5 hours of focused work per day
- If a task won't fit today, move it to tomorrow
- If it won't fit either day, omit it — do not overload
- estimatedMinutes is the actual working time needed, not elapsed calendar time
- Respect the exact start/end boundaries of each free slot

Return ONLY valid JSON — no markdown, no explanation:
{
  "schedule": [
    {
      "taskTitle": "exact task title",
      "taskId": "firestore id or null",
      "day": "today",
      "start": "ISO 8601 datetime",
      "end": "ISO 8601 datetime",
      "durationMinutes": 60,
      "focusType": "deep",
      "reason": "one brief sentence"
    }
  ]
}

Allowed: day = "today" | "tomorrow", focusType = "deep" | "medium" | "quick"`;

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
        max_tokens: 1200,
        system: 'You are a precise scheduling engine. Return only valid JSON.',
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
    const parsed = JSON.parse(clean);

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Schedule build error:', err);
    return res.status(500).json({ error: 'Schedule build failed' });
  }
}
