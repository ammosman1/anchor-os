// api/goals/score.js
// Scores each active goal 0-100 using Claude.
// Accepts optional plaidData and reviewHistory for richer accuracy.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { goals, tasks = [], brainDumps = [], plaidData = null, reviewHistory = [] } = req.body;
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
      if (plaidData?.monthlySurplus) currentPerMo = Math.round(plaidData.monthlySurplus);
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
    };
  });

  const dumpSnippets = brainDumps
    .slice(0, 5)
    .map(d => (d.rawText || d.text || '').slice(0, 300))
    .filter(Boolean);

  // Review execution patterns (last 4 weeks)
  const recentReviews = reviewHistory.slice(0, 4);
  const avgEnergy    = recentReviews.length
    ? Math.round(recentReviews.reduce((s, r) => s + (r.energyScore || 50), 0) / recentReviews.length)
    : null;
  const avgExecution = recentReviews.length
    ? Math.round(recentReviews.reduce((s, r) => s + (r.executionScore || 50), 0) / recentReviews.length)
    : null;

  const financialContext = plaidData
    ? `FINANCIAL REALITY (Plaid):
- Monthly surplus: $${plaidData.monthlySurplus?.toLocaleString() || 'unknown'}
- Monthly spending: $${plaidData.monthlySpending?.toLocaleString() || 'unknown'}
- Monthly income: $${plaidData.monthlyIncome?.toLocaleString() || 'unknown'}`
    : '';

  const reviewContext = avgEnergy != null
    ? `EXECUTION PATTERNS (last 4 weeks):
- Avg energy score: ${avgEnergy}/100
- Avg execution score: ${avgExecution}/100`
    : '';

  const prompt = `Score the likelihood that Andrew achieves each of his active goals.

TODAY: ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

GOALS (with linked task counts and pacing data):
${JSON.stringify(goalContext, null, 2)}

${financialContext}

${reviewContext}

RECENT BRAIN DUMPS (last 5):
${dumpSnippets.length ? dumpSnippets.map((d, i) => `${i + 1}. ${d}`).join('\n') : 'None on file.'}

Scoring rules by goal type:
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

trend: compare to previousScore. "up" if clearly improving, "down" if declining, "flat" if stable or no prior score.
Be honest. Do not inflate scores. A financial goal behind pace by 50%+ should score below 50.

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
