// src/lib/ai.js
// All Anthropic API calls route through here
// In production: calls go to /api/chat (Vercel serverless function)
// In development: calls go directly to Anthropic (requires REACT_APP_ANTHROPIC_KEY in .env)

const ANDREW_CONTEXT = `
You are Anchor — Andrew Mosman's personal AI operating system and strategic advisor.

WHO ANDREW IS:
- Senior operational/process leader at Wells Fargo (Identity & Access Management)
- Systems thinker, builder, operator — naturally thinks in inputs/processes/outputs
- Coming out of a failed residential remodeling business with significant tax and personal debt
- In rebuilding mode — focused on financial recovery, then eventually investing/entrepreneurship
- Deeply entrepreneurial burn still intact despite the setback
- Interested in: SaaS, automation tools, real estate, operationally efficient businesses

ANDREW'S COMMUNICATION STYLE:
- The 3 B's: Be Brief, Be Bright, Be Gone
- No fluff, no cheerleading, no "great question!"
- Direct, strategic, practical
- Acknowledge hard things briefly then pivot to what to do about them
- Think like a chief of staff or strategic operator, not a coach

CURRENT LIFE CONTEXT:
- Debt load: mix of personal, business, and substantial tax debt — highest priority to resolve
- Tanked Up (mobile fuel delivery business) on back burner during rebuild
- Wife runs a horse business — standalone app planned separately
- Working to rebuild financial foundation before making investment moves
- Strong skills: Power BI, Power Automate, Alteryx, SQL, process engineering, Lean Six Sigma

ANCHOR'S TONE:
- Calm, grounded, intelligent
- Brief responses unless depth is specifically requested
- Strategic over motivational
- Honest including about hard things
- Never toxic productivity energy
- Never filler, never padding
`;

export async function callAI({ messages, systemExtra = '', maxTokens = 500 }) {
  const system = ANDREW_CONTEXT + (systemExtra ? '\n\n' + systemExtra : '');

  // Try Vercel serverless function first (production), fall back to direct call
  try {
    const endpoint = process.env.NODE_ENV === 'production'
      ? '/api/chat'
      : 'https://api.anthropic.com/v1/messages';

    const headers = process.env.NODE_ENV === 'production'
      ? { 'Content-Type': 'application/json' }
      : {
          'Content-Type': 'application/json',
          'x-api-key': process.env.REACT_APP_ANTHROPIC_KEY || '',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        };

    const body = process.env.NODE_ENV === 'production'
      ? JSON.stringify({ messages, system, maxTokens })
      : JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system,
          messages,
        });

    const res = await fetch(endpoint, { method: 'POST', headers, body });
    const data = await res.json();

    if (process.env.NODE_ENV === 'production') {
      return data.text || '';
    } else {
      return data?.content?.[0]?.text || '';
    }
  } catch (err) {
    console.error('AI call failed:', err);
    return null;
  }
}

// ─── Specific AI workflows ────────────────────────────────────────────────────

export async function getAIFocusRecommendation({ energy, topTasks, projects }) {
  const content = `Energy today: ${energy}/10.
Top tasks: ${topTasks.map(t => t.title).join(', ')}.
Active projects: ${projects.map(p => `${p.title} (${p.momentum}% momentum, ${p.status})`).join(', ')}.
What should I focus on right now? 2-3 sentences max.`;

  return callAI({ messages: [{ role: 'user', content }], maxTokens: 200 });
}

export async function processBrainDump(rawText) {
  const content = `Process this brain dump and return ONLY valid JSON, no markdown, no preamble:
{
  "summary": "2-3 sentence sharp summary of what's really going on",
  "mostUrgent": "single most important item",
  "categories": {
    "Work": [],
    "Money": [],
    "Family": [],
    "Health": [],
    "Home": [],
    "Ideas": [],
    "Emotional": [],
    "Later": []
  },
  "actionItems": ["item1", "item2"],
  "emotionalThemes": ["theme1"],
  "urgentFlags": ["item1"]
}
Only include categories with actual items. Keep each item under 10 words.

BRAIN DUMP:
${rawText}`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 800,
    systemExtra: 'Return ONLY valid JSON. No markdown fences. No explanation.',
  });

  try {
    const clean = (raw || '{}').replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

export async function getProjectAdvice(project) {
  const content = `Project: "${project.title}"
Status: ${project.status} | Momentum: ${project.momentum}% | Last active: ${project.lastActive || 'unknown'}
Blocker: ${project.blockers || 'none'} | Sentiment: ${project.sentiment || 'neutral'}
Next action on file: ${project.nextAction || 'none'}

Give me a sharp strategic recommendation. Max 3 sentences.`;

  return callAI({ messages: [{ role: 'user', content }], maxTokens: 200 });
}

export async function getWeeklyReviewInsight({ wins, bottlenecks, energyScore, executionScore }) {
  const content = `Weekly review data:
Wins: ${wins.join('; ')}
Bottlenecks: ${bottlenecks.join('; ')}
Energy score: ${energyScore}/100
Execution score: ${executionScore}/100

Give me a sharp executive summary of this week and the single most important shift for next week. Max 4 sentences.`;

  return callAI({ messages: [{ role: 'user', content }], maxTokens: 300 });
}

export async function evaluateIdea(idea) {
  const content = `Evaluate this idea for Andrew given his current context (rebuilding financially, strong operator background, limited bandwidth):
Idea: "${idea.title}"
Notes: ${idea.notes || 'none'}
Tags: ${(idea.tags || []).join(', ')}

Return ONLY valid JSON:
{
  "verdict": "one sharp sentence",
  "tinyTest": "one small low-risk experiment to validate",
  "fitScore": 0-100,
  "timing": "now|soon|later|wrong season",
  "timingReason": "one sentence"
}`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 300,
    systemExtra: 'Return ONLY valid JSON. No markdown.',
  });

  try {
    const clean = (raw || '{}').replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

export async function getDebtAdvice(accounts) {
  const total = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const content = `Debt accounts:
${accounts.map(a => `- ${a.name}: $${a.balance?.toLocaleString()} @ ${a.interestRate || 0}% (${a.type})`).join('\n')}
Total: $${total.toLocaleString()}

Give me the optimal payoff sequence and one actionable move for this week. Max 4 sentences.`;

  return callAI({ messages: [{ role: 'user', content }], maxTokens: 300 });
}

export async function buildSchedule({ tasks, slots, focusProfile, today, tomorrow }) {
  const energyLevel = focusProfile?.recentEnergy ?? 70;
  const energyNote =
    energyLevel < 45 ? 'Low energy week — schedule light, leave breathing room between blocks.' :
    energyLevel > 75 ? 'High energy week — can handle more complex and back-to-back blocks.' :
    'Moderate energy — mix deep and lighter tasks, avoid over-scheduling.';

  const content = `Build a realistic time-blocked schedule.

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

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 2000,
    systemExtra: 'You are a precise scheduling engine. Return only valid JSON. No preamble, no explanation, no markdown.',
  });

  console.log('[buildSchedule] raw response:', raw?.slice(0, 300));

  try {
    const stripped = (raw || '').replace(/```json|```/g, '').trim();
    // Extract JSON object even if model added surrounding text
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return { schedule: [] };
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('[buildSchedule] parse error:', err, 'raw:', raw?.slice(0, 500));
    return null;
  }
}

export async function scoreGoals({ goals, tasks, brainDumps }) {
  try {
    const res = await fetch('/api/goals/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goals,
        tasks:      tasks.slice(0, 50),
        brainDumps: brainDumps.slice(0, 5),
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.scores || [];
  } catch (err) {
    console.error('scoreGoals error:', err);
    return [];
  }
}
