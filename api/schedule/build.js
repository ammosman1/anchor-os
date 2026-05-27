// api/schedule/build.js
// AI-powered schedule builder — assigns tasks to free calendar slots
// Supports multi-day scheduling (today / tomorrow / this week)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { tasks, slotsMap, days, focusProfile, weatherForecast, currentTime, intent, habits, healthLogs } = req.body;
  if (!tasks?.length) return res.status(400).json({ error: 'tasks required' });
  if (!slotsMap || !days?.length) return res.status(400).json({ error: 'slotsMap and days required' });

  const energyLevel = focusProfile?.recentEnergy ?? 70;
  const energyNote =
    energyLevel < 45 ? 'Low energy — schedule light, leave breathing room between blocks.' :
    energyLevel > 75 ? 'High energy — can handle more complex and back-to-back blocks.' :
    'Moderate energy — mix deep and lighter tasks, avoid over-scheduling.';

  const daysJson = days.map(d => ({ date: d, slots: slotsMap[d] || [] }));

  // Build due date urgency notes
  const today = new Date(); today.setHours(0,0,0,0);
  const tasksWithUrgency = tasks.map(t => {
    const notes = [];
    if (t.dueDate) {
      const diff = Math.floor((new Date(t.dueDate + 'T00:00:00') - today) / (1000 * 60 * 60 * 24));
      if (diff < 0) notes.push(`OVERDUE by ${Math.abs(diff)}d`);
      else if (diff === 0) notes.push('DUE TODAY');
      else if (diff <= 2) notes.push(`due in ${diff}d`);
      else notes.push(`due ${t.dueDate}`);
    }
    if (t.pushCount >= 2) notes.push(`pushed ${t.pushCount}x — must be scheduled`);
    if (t.outdoor) notes.push('OUTDOOR TASK');
    if (t.context === 'work') notes.push('WORK TASK — schedule Mon–Fri business hours only');
    return { ...t, urgencyNotes: notes.join(' | ') };
  });

  // Weather context for outdoor tasks
  let weatherNote = '';
  if (weatherForecast?.length > 0) {
    const badDays = weatherForecast.filter(d => !d.outdoorFriendly).map(d => d.date);
    const goodDays = weatherForecast.filter(d => d.outdoorFriendly).map(d => `${d.date} (${d.label}, ${d.maxTemp}°F)`);
    if (badDays.length > 0) {
      weatherNote = `\nWEATHER CONSTRAINTS:\n- Outdoor tasks NOT suitable on: ${badDays.join(', ')}\n- Good outdoor days: ${goodDays.slice(0, 3).join(', ')}\n- Always schedule outdoor tasks on good-weather days only`;
    }
  }

  const prompt = `Build a realistic time-blocked schedule for Andrew.

SCHEDULING WINDOW: ${days[0]} through ${days[days.length - 1]} (${days.length} day${days.length > 1 ? 's' : ''})

TASKS TO SCHEDULE (sorted by urgency — schedule high-urgency items first):
${JSON.stringify(tasksWithUrgency, null, 2)}

FREE TIME SLOTS PER DAY:
${JSON.stringify(daysJson, null, 2)}

FOCUS WINDOWS:
- Morning 8am–12pm → deep work (financial review, planning, drafting, strategic decisions)
- Early afternoon 1pm–3pm → medium tasks (calls, research, follow-ups)
- Late afternoon 3pm–6pm → quick tasks (emails, admin, short actions)
${weatherNote}

ENERGY CONTEXT: ${energyNote}
${habits?.length ? `
ACTIVE HABITS (context for understanding Andrew's routine):
${habits.filter(h => h.active !== false).map(h => `- ${h.title}${h.description ? ` — ${h.description}` : ''}`).join('\n')}
` : ''}${healthLogs?.length ? `
RECENT HEALTH LOG (last 7 days — factor into energy/scheduling decisions):
${healthLogs.slice(0, 7).map(l => `- ${l.date}: energy ${l.energy ?? '?'}/5, sleep ${l.sleep ?? '?'}, exercise ${l.exercise === true ? 'yes' : l.exercise === false ? 'no' : '?'}`).join('\n')}
` : ''}${(intent?.topPriority || intent?.toDefer) ? `
ANDREW'S STATED PRIORITIES FOR TODAY:${intent.topPriority ? `\n- Most important: ${intent.topPriority}` : ''}${intent.toDefer ? `\n- Push off / avoid: ${intent.toDefer}` : ''}
` : ''}
RULES:
- Always honor Andrew's stated priorities — if he named something as most important, schedule it first in the best slot
${currentTime ? `- CURRENT TIME: ${currentTime}. Never schedule any block starting before this time — even if a slot begins earlier, your block must start at or after this timestamp.` : ''}
- Tasks marked WORK TASK must only be scheduled Monday–Friday during typical business hours (8am–5pm)
- Tasks marked OVERDUE or pushed 2+ times must be scheduled first, today if possible
- Tasks with due dates within 2 days get top priority in the schedule
- If a task has an "availableDays" array (e.g. ["sat","sun"]), it MUST only be scheduled on matching days of the week — never on other days. Day codes: mon=Monday, tue=Tuesday, wed=Wednesday, thu=Thursday, fri=Friday, sat=Saturday, sun=Sunday. An empty array means any day is fine.
- Tasks with goalDeadlineUrgent=true are linked to a goal with a near or at-risk deadline — treat them with the same urgency as "high" priority and schedule them in prime morning slots when possible

PRIORITY-FIRST ORDERING:
- Schedule ALL critical tasks before any high tasks; ALL high before medium; ALL medium before low
- Within the same priority tier, sort by: OVERDUE first, then due soonest, then by focusType fit for the time window
- Never schedule a medium or low task into a prime morning deep-work slot if any critical or high task is unscheduled

CONTEXT RUNS (consecutive focus blocks):
- If 3 or more tasks belong to the same project AND are all high or critical priority, schedule them back-to-back as a "context run" — group them in the same morning or afternoon window
- Context runs minimize context-switching and preserve focus
- Label context-run tasks in their "reason" field: "Context run: [Project Name]"
- Add a single 10-minute break after a context run, not between each task

GENERAL:
- OUTDOOR tasks must only be placed on weather-suitable days
- Never schedule deep work in an afternoon low-focus slot if a morning slot is available
- Add 10-minute buffers between standalone consecutive blocks — don't stack them back-to-back
- Do not schedule more than 5 hours of focused work per day
- If a task won't fit one day, roll it to the next available day
- If a task won't fit in the entire window, omit it — do not overload
- estimatedMinutes is the actual working time needed, not elapsed calendar time
- Respect the exact start/end boundaries of each free slot
- Distribute tasks evenly across days — don't pile everything on day 1

Return ONLY valid JSON — no markdown, no explanation:
{
  "summary": "2-3 sentences explaining key scheduling decisions: why certain tasks got priority, how energy/weather/urgency shaped the plan, and anything left unscheduled and why",
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
