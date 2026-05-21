// src/lib/ai.js
// All Anthropic API calls route through here
// In production: calls go to /api/chat (Vercel serverless function)
// In development: calls go directly to Anthropic (requires REACT_APP_ANTHROPIC_KEY in .env)

import { auth } from './firebase.js';

const isDev = process.env.NODE_ENV !== 'production';

let _userPersona = '';
export function setUserPersona(text) { _userPersona = text || ''; }

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
  const personaAddition = _userPersona ? `\n\nUSER PERSONA NOTES (Andrew added these — factor them into all responses):\n${_userPersona}` : '';
  const system = ANDREW_CONTEXT + personaAddition + (systemExtra ? '\n\n' + systemExtra : '');

  // Try Vercel serverless function first (production), fall back to direct call
  try {
    const endpoint = process.env.NODE_ENV === 'production'
      ? '/api/chat'
      : 'https://api.anthropic.com/v1/messages';

    let authHeader = {};
    if (process.env.NODE_ENV === 'production' && auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      authHeader = { 'Authorization': `Bearer ${token}` };
    }

    const headers = process.env.NODE_ENV === 'production'
      ? { 'Content-Type': 'application/json', ...authHeader }
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
    if (isDev) console.error('AI call failed:', err);
    return null;
  }
}

// ─── Specific AI workflows ────────────────────────────────────────────────────

export async function getAIFocusRecommendation({ energy, topTasks, projects, holisticContext }) {
  const content = `Energy today: ${energy}/10.
Top tasks: ${topTasks.map(t => t.title).join(', ')}.
Active projects: ${projects.map(p => `${p.title} (${(p._mScore ?? p.momentum ?? 0)}% momentum, ${p.status})`).join(', ')}.

Build today's briefing. Return ONLY valid JSON:
{
  "headline": "One sharp sentence (under 12 words) — the strategic priority for today",
  "actions": [
    {
      "task": "Specific thing to do (under 10 words, verb-first)",
      "goal": "Name of the goal this advances, or null if none",
      "reason": "One phrase: why it matters today (deadline, risk, momentum)"
    }
  ],
  "driftFlag": "One sentence calling out any goal at risk with no active work — or null if none"
}

Rules:
- 2-4 action items, ordered by importance
- Every action that has a goal tie must name it explicitly
- Items with no goal tie go last and are marked as goal: null
- driftFlag must name the specific goal and its score if at risk
- No fluff, no encouragement`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 500,
    systemExtra: (holisticContext ? `FULL USER CONTEXT:\n${holisticContext}\n\n` : '') + 'Return ONLY valid JSON. No markdown. No explanation.',
  });

  try {
    const clean = (raw || '{}').replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

export async function generateWeeklyBrainDumpDigest(entries) {
  const entryText = entries
    .map(e => `- ${e.summary || e.rawText?.slice(0, 300) || ''}`)
    .filter(Boolean)
    .join('\n');

  const content = `Based on these brain dump entries from a single week, write a 3-4 sentence summary of what was on this person's mind. Be specific about the actual topics, concerns, and themes — not generic. This will be used as long-term memory context for an AI assistant.

Brain dumps:
${entryText}`;

  return callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 200,
    systemExtra: 'Return only the summary paragraph. No labels, no preamble.',
  });
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

export async function getProjectAdvice(project, momentumScore = null) {
  const momentum = momentumScore ?? project._mScore ?? project.momentum ?? 0;
  const content = `Project: "${project.title}"
Status: ${project.status} | Momentum: ${momentum}% | Last active: ${project.lastActive || 'unknown'}
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

export async function generateWeeklySummary({ weekMetrics, goals }) {
  const activeGoals = (goals || []).filter(g => g.status === 'active');
  const atRiskGoals = activeGoals.filter(g => g.likelihoodScore != null && g.likelihoodScore < 50);

  const content = `Analyze this past week for Andrew and produce a structured summary.

WEEK METRICS:
- Tasks completed: ${weekMetrics.completed}
- Tasks missed/unfinished: ${weekMetrics.missed}
- Tasks pushed (backlog): ${weekMetrics.pushed}
- Context breakdown (completed): ${Object.entries(weekMetrics.byContext || {}).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'}
- Goals with task activity: ${weekMetrics.activeGoalTitles?.join(', ') || 'none'}
- Stalled projects: ${weekMetrics.stalledProjects?.join(', ') || 'none'}

ACTIVE GOALS (${activeGoals.length}):
${activeGoals.map(g => `- "${g.title}" (${g.likelihoodScore ?? 'unscored'}/100)`).join('\n') || 'none'}

AT-RISK GOALS:
${atRiskGoals.map(g => `- "${g.title}": ${g.likelihoodScore}/100`).join('\n') || 'none'}

Return ONLY valid JSON:
{
  "narrative": "2-3 sentence honest read of the week — what actually happened, no fluff",
  "wins": ["Specific win 1", "Specific win 2"],
  "stalled": ["What stalled and why it matters for the goals"],
  "goalAlignment": "One sentence: were you working on the right things this week?",
  "nextWeekFocus": ["Priority 1 (specific, verb-first)", "Priority 2", "Priority 3"]
}`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 600,
    systemExtra: 'Return ONLY valid JSON. No markdown. No explanation.',
  });

  try {
    const clean = (raw || '{}').replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
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

  try {
    const stripped = (raw || '').replace(/```json|```/g, '').trim();
    // Extract JSON object even if model added surrounding text
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return { schedule: [] };
    return JSON.parse(match[0]);
  } catch (err) {
    if (isDev) console.error('[buildSchedule] parse error:', err, 'raw:', raw?.slice(0, 500));
    return null;
  }
}

export async function generateGoalScenarios({ goal, tasks, brainDumps }) {
  const content = `Goal at risk: "${goal.title}"
Likelihood score: ${goal.likelihoodScore}/100
Why it matters: ${goal.why || 'not specified'}
Target date: ${goal.targetDate || 'none'}
Description: ${goal.description || 'none'}
Recent tasks related: ${tasks.filter(t => !t.done && (t.goalId === goal.id || t.project?.toLowerCase().includes(goal.title?.toLowerCase()?.slice(0,10)))).slice(0,5).map(t => t.title).join(', ') || 'none'}
Recent brain dumps: ${brainDumps.slice(0,3).map(b => b.summary || b.rawText?.slice(0,100)).filter(Boolean).join(' | ') || 'none'}

Generate 3 distinct recovery scenarios to get this goal back on track. Each should be meaningfully different in approach (e.g., accelerate timeline, reduce scope, change strategy).

Return ONLY valid JSON:
{
  "scenarios": [
    {
      "id": "s1",
      "title": "Scenario name (5 words max)",
      "description": "One sharp sentence on the approach",
      "likelihoodBoost": 15,
      "steps": ["Concrete action 1", "Concrete action 2", "Concrete action 3"]
    }
  ]
}`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 800,
    systemExtra: 'Return ONLY valid JSON. No markdown. No explanation.',
  });

  try {
    const clean = (raw || '{}').replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { scenarios: [] };
  } catch {
    return { scenarios: [] };
  }
}

export async function buildScheduleForDays({ tasks, slotsMap, days, focusProfile, currentTime }) {
  if (process.env.NODE_ENV === 'production') {
    try {
      const res = await fetch('/api/schedule/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks, slotsMap, days, focusProfile, currentTime }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (err) {
      if (isDev) console.error('buildScheduleForDays error:', err);
      return { schedule: [] };
    }
  }

  // Dev: call Anthropic directly via callAI
  const energyLevel = focusProfile?.recentEnergy ?? 70;
  const energyNote =
    energyLevel < 45 ? 'Low energy — schedule light, leave breathing room.' :
    energyLevel > 75 ? 'High energy — can handle complex back-to-back blocks.' :
    'Moderate energy — mix deep and lighter tasks.';

  const daysJson = days.map(d => ({ date: d, slots: slotsMap[d] || [] }));

  const content = `Build a realistic time-blocked schedule.

SCHEDULING WINDOW: ${days[0]} through ${days[days.length - 1]} (${days.length} day${days.length > 1 ? 's' : ''})

TASKS TO SCHEDULE (priority order):
${JSON.stringify(tasks, null, 2)}

FREE TIME SLOTS PER DAY:
${JSON.stringify(daysJson, null, 2)}

ENERGY CONTEXT: ${energyNote}

RULES:
- Critical/high priority tasks get earliest available slots
- Add 10-minute buffers between consecutive blocks
- Max 5 hours focused work per day
- Roll tasks to next day if today is full; omit if nothing fits
- Distribute tasks evenly — don't pile everything on day 1

Return ONLY valid JSON:
{
  "summary": "2-3 sentences explaining key scheduling decisions: why certain tasks got priority, how energy/urgency shaped the plan, and anything left unscheduled and why",
  "schedule": [
    {
      "taskTitle": "exact task title",
      "taskId": "firestore id or null",
      "date": "YYYY-MM-DD",
      "start": "ISO 8601 datetime",
      "end": "ISO 8601 datetime",
      "durationMinutes": 60,
      "focusType": "deep|medium|quick",
      "reason": "one brief sentence"
    }
  ]
}`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 3000,
    systemExtra: 'You are a precise scheduling engine. Return only valid JSON. No preamble, no markdown.',
  });

  try {
    const stripped = (raw || '').replace(/```json|```/g, '').trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { schedule: [] };
  } catch (err) {
    if (isDev) console.error('[buildScheduleForDays] parse error:', err);
    return { schedule: [] };
  }
}

export async function processSmartCapture({ text, projects }) {
  const projList = (projects || []).filter(p => p.status === 'active').map(p => p.title);
  const content = `Process this quick capture note and extract actionable tasks.

Text: "${text}"
Available projects: ${projList.length > 0 ? projList.join(', ') : 'Inbox only'}

Return ONLY valid JSON:
{
  "tasks": [
    {
      "title": "concise action-oriented title (under 10 words)",
      "priority": "critical|high|medium|low",
      "project": "exact project name from available list, or Inbox",
      "notes": "any important context, or empty string"
    }
  ]
}

Rules:
- Extract 1-5 separate tasks. Break compound items into individual tasks.
- Priority: urgent/ASAP/critical → critical; important/need to → high; default → medium; someday/later → low
- Route to most relevant available project; if unclear use Inbox
- Titles must start with action verbs: Call, Send, Review, Schedule, Draft, Follow up, etc.`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 600,
    systemExtra: 'Return ONLY valid JSON. No markdown fences. No explanation.',
  });

  try {
    const clean = (raw || '{}').replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { tasks: [] };
  } catch {
    return { tasks: [] };
  }
}

export async function getWeeklyFocusStatement({ goals, tasks, weeklyReviews, holisticContext }) {
  const activeGoals     = (goals || []).filter(g => g.status === 'active');
  const atRiskGoals     = activeGoals.filter(g => g.likelihoodScore != null && g.likelihoodScore < 50);
  const highPriorityTasks = tasks.filter(t => !t.done && (t.priority === 'critical' || t.priority === 'high')).slice(0, 8);
  const recentReview    = weeklyReviews?.[0];

  const content = `Based on Andrew's goals and task load, what are the 3 most important things to move forward this week?

ACTIVE GOALS:
${activeGoals.map(g => `- ${g.title} (${g.likelihoodScore ?? 'unscored'}/100, ${g.goalType || 'general'})`).join('\n') || 'none'}

AT-RISK GOALS (score <50):
${atRiskGoals.map(g => `- ${g.title}: ${g.likelihoodScore}/100`).join('\n') || 'none'}

HIGH PRIORITY OPEN TASKS:
${highPriorityTasks.map(t => `- ${t.title} [${t.priority}]`).join('\n') || 'none'}

${recentReview ? `LAST WEEKLY REVIEW: ${recentReview.weekRating != null ? `rated ${recentReview.weekRating}/5` : `energy ${recentReview.energyScore ?? '?'}/100`}\nStalled/Blockers: ${(Array.isArray(recentReview.stalled) ? recentReview.stalled : recentReview.bottlenecks ? [recentReview.bottlenecks] : []).join(', ') || 'none'}` : ''}

Return ONLY valid JSON:
{
  "thisWeekFocus": ["Action 1 (specific, verb-first, under 12 words)", "Action 2", "Action 3"],
  "whatToIgnore": "One specific thing to deprioritize this week",
  "headline": "One sharp sentence (10 words max) capturing the week's strategic priority"
}`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 400,
    systemExtra: (holisticContext ? `FULL USER CONTEXT:\n${holisticContext}\n\n` : '') + 'Return ONLY valid JSON. No markdown. No explanation.',
  });

  try {
    const clean = (raw || '{}').replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

export async function generateGoalInsights({ goal, linkedTasks, completedTasks, weeklyReviews, plaidData, holisticContext }) {
  const taskCompletionRate = linkedTasks.length > 0
    ? Math.round((completedTasks.length / linkedTasks.length) * 100) : null;

  const recentReviews = (weeklyReviews || []).slice(0, 4);
  // Support both new weekRating (1-5, multiply by 20) and old energyScore (0-100)
  const avgRating = recentReviews.length
    ? Math.round(recentReviews.reduce((s, r) => s + (r.weekRating != null ? r.weekRating * 20 : (r.energyScore || 50)), 0) / recentReviews.length) : null;

  const content = `Analyze this goal for Andrew and answer five critical questions.

GOAL: "${goal.title}"
TYPE: ${goal.goalType || 'general'}
WHY: ${goal.why || 'not specified'}
TARGET DATE: ${goal.targetDate || 'none set'}
CURRENT LIKELIHOOD: ${goal.likelihoodScore ?? 'not scored'}/100
TREND: ${goal.likelihoodTrend || 'unknown'}
${goal.targetAmount ? `FINANCIAL TARGET: $${goal.targetAmount.toLocaleString()}` : ''}
${goal.currentAmount != null ? `CURRENT AMOUNT: $${goal.currentAmount.toLocaleString()}` : ''}
${goal.description ? `DESCRIPTION: ${goal.description}` : ''}

LINKED TASKS:
- Total: ${linkedTasks.length} | Completed: ${completedTasks.length}
- Completion rate: ${taskCompletionRate ?? 'n/a'}%

EXISTING ACTIVE TASKS — do NOT re-suggest any of these in thisWeekActions, they are already being tracked:
${linkedTasks.filter(t => !t.done).length > 0 ? linkedTasks.filter(t => !t.done).slice(0, 8).map(t => `- ${t.title}`).join('\n') : 'none'}

RECENTLY COMPLETED TASKS — do NOT re-suggest these either, they are already done:
${completedTasks.slice(-8).map(t => `- ${t.title}${t.completionNote ? ` (outcome: ${t.completionNote})` : ''}`).join('\n') || 'none'}

CRITICAL: thisWeekActions must be genuinely new actions not already captured in either list above. Use the completion notes to inform what is actually resolved vs still open.

EXECUTION DATA (last 4 weeks):
- Avg weekly rating: ${avgRating ?? 'n/a'}/100 (normalized)
${plaidData ? `PLAID: Monthly surplus $${plaidData.monthlySurplus?.toLocaleString()}, spending $${plaidData.monthlySpending?.toLocaleString()}` : ''}

Return ONLY valid JSON:
{
  "onTrack": true,
  "onTrackStatement": "One direct sentence: Am I on track?",
  "projectedDate": "YYYY-MM or null",
  "gapStatement": "One sentence: target vs projected, what the gap is",
  "requiredPaceStatement": "What pace is needed (financial/project goals)",
  "currentPaceStatement": "Current pace based on data",
  "topRisks": ["Risk 1", "Risk 2"],
  "thisWeekActions": ["Action 1", "Action 2", "Action 3"],
  "whatToIgnore": "One specific thing to deprioritize right now"
}`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 700,
    systemExtra: (holisticContext ? `FULL USER CONTEXT:\n${holisticContext}\n\n` : '') + 'Return ONLY valid JSON. No markdown. No explanation.',
  });

  try {
    const clean = (raw || '{}').replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

export async function generateProjectAnalysis({ project, linkedTasks, completedTasks, linkedGoal, holisticContext, momentumScore }) {
  const taskCompletionRate = linkedTasks.length > 0
    ? Math.round((completedTasks.length / linkedTasks.length) * 100) : null;

  const activeTasks = linkedTasks.filter(t => !t.done);

  const content = `Analyze this project for Andrew and provide strategic guidance.

PROJECT: "${project.title}"
STATUS: ${project.status} | CALCULATED MOMENTUM: ${momentumScore ?? 'n/a'}/100
NEXT ACTION: ${project.nextAction || 'none'}
BLOCKER: ${project.blockers || 'none'}
${linkedGoal ? `LINKED GOAL: "${linkedGoal.title}" (${linkedGoal.likelihoodScore ?? 'unscored'}/100)` : 'LINKED GOAL: none'}
${project.description ? `DESCRIPTION: ${project.description}` : ''}

LINKED TASKS (only tasks explicitly assigned to this project):
- Total: ${linkedTasks.length} | Completed: ${completedTasks.length}
- Completion rate: ${taskCompletionRate ?? 'n/a'}%

EXISTING ACTIVE TASKS — do NOT re-suggest any of these, they are already being tracked:
${activeTasks.length > 0 ? activeTasks.map(t => `- ${t.title}`).join('\n') : 'none'}

CRITICAL: Only suggest thisWeekActions that are directly relevant to THIS project based on the linked tasks and project description above. Do not reference tasks, people, or items from other projects or goals even if they appear in the broader context. Keep actions scoped strictly to what moves this specific project forward. Never suggest actions that duplicate the existing active tasks listed above.

Return ONLY valid JSON:
{
  "onTrack": true,
  "statusStatement": "One direct sentence on where this project stands",
  "topRisks": ["Risk 1", "Risk 2"],
  "thisWeekActions": ["Action 1", "Action 2", "Action 3"],
  "momentumAdvice": "One sentence on how to increase or maintain momentum",
  "whatToIgnore": "One specific thing to deprioritize right now for this project"
}`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 600,
    systemExtra: (holisticContext ? `FULL USER CONTEXT:\n${holisticContext}\n\n` : '') + 'Return ONLY valid JSON. No markdown. No explanation.',
  });

  try {
    const clean = (raw || '{}').replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

export async function generateGoalExecutionPlan({ goal, existingTasks, projects, daysAvailablePerWeek }) {
  const content = `Create a concrete execution plan to achieve this goal.

GOAL: "${goal.title}"
TYPE: ${goal.goalType || 'general'}
WHY: ${goal.why || 'not specified'}
TARGET DATE: ${goal.targetDate || 'none set'}
${goal.targetAmount ? `TARGET: $${goal.targetAmount.toLocaleString()}` : ''}
${goal.currentAmount != null && goal.targetAmount ? `CURRENT: $${goal.currentAmount.toLocaleString()} (${Math.round((goal.currentAmount / goal.targetAmount) * 100)}% complete)` : goal.currentAmount != null ? `CURRENT: $${goal.currentAmount.toLocaleString()}` : ''}
${goal.description ? `CONTEXT: ${goal.description}` : ''}

EXISTING LINKED TASKS: ${existingTasks.filter(t => !t.done).length} open, ${existingTasks.filter(t => t.done).length} completed
AVAILABLE CAPACITY: ~${daysAvailablePerWeek || 3} focused days/week
ACTIVE PROJECTS: ${(projects || []).filter(p => p.status === 'active').map(p => p.title).join(', ') || 'none'}

Return ONLY valid JSON:
{
  "milestones": [
    { "title": "Milestone name", "targetMonth": "YYYY-MM", "description": "What done looks like" }
  ],
  "tasks": [
    {
      "title": "Action verb + task (under 10 words)",
      "priority": "critical|high|medium|low",
      "estimatedMinutes": 60,
      "milestoneIndex": 0,
      "project": "project name or Inbox",
      "notes": "context or empty string"
    }
  ],
  "summary": "One paragraph: what this plan achieves and key assumptions",
  "warnings": ["Risk or assumption worth flagging"]
}

Rules: 2-4 milestones, 5-15 specific tasks, task titles start with action verbs, be realistic about limited bandwidth.`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 2500,
    systemExtra: 'Return ONLY valid JSON. No markdown. No explanation.',
  });

  if (!raw) return null;
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return (parsed.tasks?.length > 0 || parsed.milestones?.length > 0) ? parsed : null;
  } catch {
    return null;
  }
}

export async function getTodaysPulse({ holisticContext, tasks, goals, habits, dailyReviews }) {
  const today   = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const openTasks     = (tasks || []).filter(t => !t.done);
  const criticalTasks = openTasks.filter(t => t.priority === 'critical').slice(0, 4);
  const in5           = new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000);
  const deadlineRisk  = openTasks.filter(t => {
    if (!t.dueDate) return false;
    const due = new Date(t.dueDate + 'T23:59:59');
    return due >= today && due <= in5 && !t.scheduledStart && !t.scheduledDate;
  }).slice(0, 3);

  const activeGoals = (goals || []).filter(g => g.status === 'active');
  const atRiskGoals = activeGoals.filter(g => g.likelihoodScore != null && g.likelihoodScore < 50);

  const morningDone  = (dailyReviews || []).some(r => r.type === 'morning' && r.date === today.toDateString());
  const activeHabits = (habits || []).filter(h => h.active !== false);

  const content = `Generate Today's Pulse for ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.

Today's Pulse surfaces what needs ATTENTION — not what to work on (that's the Daily Briefing).
Focus on: risks, things being neglected, streaks at risk, imminent deadlines, drifting goals.
If everything looks genuinely healthy, surface one positive momentum observation.

DATA:
- Critical open tasks: ${criticalTasks.map(t => t.title).join(', ') || 'none'}
- Unscheduled tasks due within 5 days: ${deadlineRisk.map(t => `${t.title} (due ${t.dueDate})`).join(', ') || 'none'}
- Goals at risk (<50%): ${atRiskGoals.map(g => `${g.title} (${g.likelihoodScore}%)`).join(', ') || 'none'}
- Morning review done today: ${morningDone ? 'yes' : 'no'}
- Active habits tracked: ${activeHabits.length}

Return ONLY valid JSON:
{
  "headline": "One sharp sentence under 12 words — what today's intelligence picture looks like",
  "items": [
    {
      "type": "risk|task|goal|habit|finance|opportunity",
      "icon": "⚑|⏱|◎|○|$|✦",
      "text": "Specific named observation (1-2 sentences). Must name actual tasks/goals/habits from the data.",
      "actionLabel": "Short label e.g. 'Schedule →' or null",
      "link": "/goals|/calendar|/tasks|/debt|/review or null"
    }
  ]
}

Rules: 2-3 items max. Ordered by urgency. Every item names something specific. No generic advice.`;

  const raw = await callAI({
    messages: [{ role: 'user', content }],
    maxTokens: 500,
    systemExtra: (holisticContext ? `FULL USER CONTEXT:\n${holisticContext}\n\n` : '') + 'Return ONLY valid JSON. No markdown. No explanation.',
  });

  try {
    const clean = (raw || '{}').replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

export async function scoreGoals({ goals, tasks, brainDumps, plaidData = null, manualCashFlow = null, reviewHistory = [] }) {
  try {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    const res = await fetch('/api/goals/score', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        goals,
        tasks:          tasks.slice(0, 50),
        brainDumps:     brainDumps.slice(0, 5),
        plaidData:      plaidData || null,
        manualCashFlow: manualCashFlow || null,
        reviewHistory:  reviewHistory.slice(0, 4),
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.scores || [];
  } catch (err) {
    if (isDev) console.error('scoreGoals error:', err);
    return [];
  }
}
