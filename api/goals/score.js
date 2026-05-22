// api/goals/score.js
// Scores each active goal 0-100 using Claude.

import { verifyAuthToken } from '../_firebase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    await verifyAuthToken(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { goals, tasks = [], brainDumps = [], plaidData = null, manualCashFlow = null, reviewHistory = [] } = req.body;
  // Prefer Plaid data; fall back to manually imported cash flow
  const effectivePlaidData = plaidData || (manualCashFlow ? {
    monthlySurplus:  manualCashFlow.monthlySurplus  || 0,
    monthlySpending: manualCashFlow.monthlySpending || 0,
    monthlyIncome:   manualCashFlow.monthlyIncome   || 0,
  } : null);
  if (!goals || !goals.length) return res.status(400).json({ error: 'goals required' });

  const now = new Date();

  const goalContext = goals.map(g => {
    const months = g.targetDate
      ? (() => {
          const [y, m] = g.targetDate.split('-').map(Number);
          return (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1));
        })()
      : null;

    const progressPct =
      g.targetAmount && g.currentAmount != null
        ? Math.round((g.currentAmount / g.targetAmount) * 100)
        : null;

    // Goal age in days — handles Firestore Timestamp, ISO string, or missing
    const goalAgeDays = (() => {
      const raw = g.createdAt;
      if (!raw) return null;
      let ms;
      if (typeof raw === 'string') ms = new Date(raw).getTime();
      else if (raw._seconds != null) ms = raw._seconds * 1000;
      else if (raw.seconds != null) ms = raw.seconds * 1000;
      else return null;
      return isNaN(ms) ? null : Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24));
    })();

    // Per-goal task metrics — more accurate than global task counts
    const goalTasks      = tasks.filter(t => t.goalId === g.id);
    const goalDone       = goalTasks.filter(t => t.done);
    const goalActive     = goalTasks.filter(t => !t.done);
    const globalActive   = tasks.filter(t => !t.done);
    const globalDone     = tasks.filter(t => t.done);

    // Financial pace calculation (if target amount + months)
    let pacingContext = null;
    if (g.goalType === 'financial' && g.targetAmount && g.currentAmount != null && months > 0) {
      const needed         = g.targetAmount - g.currentAmount;
      const requiredPerMo  = Math.round(needed / months);
      let currentPerMo     = null;
      if (effectivePlaidData?.monthlySurplus) currentPerMo = Math.round(effectivePlaidData.monthlySurplus);
      pacingContext = {
        amountNeeded:    needed,
        requiredPerMonth: requiredPerMo,
        currentMonthlyPace: currentPerMo,
        paceGap: currentPerMo != null ? requiredPerMo - currentPerMo : null,
      };
    }

    return {
      id:                g.id,
      title:             g.title,
      goalType:          g.goalType || 'project',
      why:               g.why || null,
      status:            g.status,
      monthsRemaining:   months,
      financialProgress: progressPct != null ? `${progressPct}% ($${g.currentAmount?.toLocaleString()} of $${g.targetAmount?.toLocaleString()})` : null,
      linkedTasksTotal:  goalTasks.length,
      linkedTasksDone:   goalDone.length,
      linkedTasksActive: goalActive.slice(0, 5).map(t => t.title),
      allTasksActive:    globalActive.length,
      allTasksDone:      globalDone.length,
      previousScore:     g.likelihoodScore ?? null,
      pacing:            pacingContext,
      goalAgeDays,
    };
  });

  const dumpSnippets = brainDumps
    .slice(0, 5)
    .map(d => (d.rawText || d.text || '').slice(0, 300))
    .filter(Boolean);

  // Review execution patterns (last 4 weeks)
  const recentReviews = reviewHistory.slice(0, 4);
  // Support both new weekRating (1-5 → normalize to 0-100) and old energyScore/executionScore
  const avgRating = recentReviews.length
    ? Math.round(recentReviews.reduce((s, r) => s + (r.weekRating != null ? r.weekRating * 20 : (r.energyScore || 50)), 0) / recentReviews.length)
    : null;

  const financialContext = effectivePlaidData
    ? `FINANCIAL REALITY (${plaidData ? 'Teller' : 'manually imported'}):
- Monthly surplus: $${effectivePlaidData.monthlySurplus?.toLocaleString() || 'unknown'}
- Monthly spending: $${effectivePlaidData.monthlySpending?.toLocaleString() || 'unknown'}
- Monthly income: $${effectivePlaidData.monthlyIncome?.toLocaleString() || 'unknown'}`
    : '';

  const reviewContext = avgRating != null
    ? `EXECUTION PATTERNS (last 4 weeks):
- Avg weekly rating: ${avgRating}/100 (normalized)`
    : '';

  const prompt = `Score the likelihood that Andrew achieves each of his active goals.

TODAY: ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

GOALS (with linked task counts and pacing data):
${JSON.stringify(goalContext, null, 2)}

${financialContext}

${reviewContext}

RECENT BRAIN DUMPS (last 5):
${dumpSnippets.length ? dumpSnippets.map((d, i) => `${i + 1}. ${d}`).join('\n') : 'None on file.'}

NEW GOAL RULE (highest priority — apply before all other rules):
- If goalAgeDays is 0-20 AND linkedTasksActive > 0: score MUST be 45-55. This goal was just created and already has tasks — there is not enough execution history to score it lower. Do not penalize for zero completions. Use reasoning like "Newly started with active tasks — scoring neutral pending execution data."
- If goalAgeDays is 0-20 AND linkedTasksActive === 0: score 35-45. Created recently but no tasks yet — flag that tasks are needed.
- If goalAgeDays is null AND linkedTasksTotal === 0 AND linkedTasksDone === 0: treat as potentially new; score 40-50 rather than near-zero.

Scoring rules by goal type (apply only when goal is NOT new per rules above):
- financial: Weight heavily on pacing data. If paceGap > 0 (behind pace), score should reflect that mathematically. A $500/mo gap on a 36-month goal is more serious than on a 120-month goal.
- project: Weight on linked task completion rate and whether active tasks exist.
- income: Weight on milestone progression and whether exploratory tasks are happening.
- qualitative: Weight on review energy/execution scores and whether the schedule has space for it.

Return a JSON array — one entry per goal:
[
  {
    "goalId": "id string",
    "score": 0-100,
    "trend": "up" | "down" | "flat",
    "reasoning": "one blunt sentence explaining the score"
  }
]

Scoring rubric:
- 70-100: On track. Momentum is real, timeline is achievable.
- 40-69: Possible but needs attention or acceleration.
- 0-39: At risk — timeline, resources, or focus are misaligned.

trend: compare to previousScore. "up" if clearly improving, "down" if declining, "flat" if stable or no prior score. New goals with no prior score should use "flat".
Be honest. Do not inflate scores. A financial goal behind pace by 50%+ should score below 50.
EXCEPTION: Never score a goal < 21 days old below 35, regardless of completion data — there is no data yet to justify it.

Return ONLY the JSON array. No markdown. No explanation outside the array.`;

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
        max_tokens: 800,
        system: 'You are a precise scoring engine. Return only valid JSON arrays.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return res.status(500).json({ error: 'AI request failed' });
    }

    const data  = await response.json();
    const raw   = data?.content?.[0]?.text || '[]';
    const clean = raw.replace(/```json|```/g, '').trim();
    const scores = JSON.parse(clean);

    return res.status(200).json({ scores });
  } catch (err) {
    console.error('Goal scoring error:', err);
    return res.status(500).json({ error: 'Scoring failed' });
  }
}
