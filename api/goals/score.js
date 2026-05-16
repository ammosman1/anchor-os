// api/goals/score.js
// Scores each active goal 0-100 using Claude, with trend direction

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { goals, tasks = [], brainDumps = [] } = req.body;
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

    const activeTasks = tasks.filter(t => !t.done);
    const doneTasks   = tasks.filter(t => t.done);

    return {
      id:                g.id,
      title:             g.title,
      why:               g.why || null,
      status:            g.status,
      monthsRemaining:   months,
      financialProgress: progressPct != null ? `${progressPct}% ($${g.currentAmount?.toLocaleString()} of $${g.targetAmount?.toLocaleString()})` : null,
      activeTasks:       activeTasks.length,
      completedTasks:    doneTasks.length,
      previousScore:     g.likelihoodScore ?? null,
    };
  });

  const dumpSnippets = brainDumps
    .slice(0, 5)
    .map(d => (d.rawText || d.text || '').slice(0, 300))
    .filter(Boolean);

  const prompt = `Score the likelihood that Andrew achieves each of his active goals.

TODAY: ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

GOALS:
${JSON.stringify(goalContext, null, 2)}

RECENT BRAIN DUMPS (last 5):
${dumpSnippets.length ? dumpSnippets.map((d, i) => `${i + 1}. ${d}`).join('\n') : 'None on file.'}

Return a JSON array — one entry per goal:
[
  {
    "goalId": "id string",
    "score": 0-100,
    "trend": "up" | "down" | "flat",
    "reasoning": "one blunt sentence"
  }
]

Scoring rubric:
- 70-100: On track. Momentum is real, timeline is achievable.
- 40-69: Possible but needs attention or acceleration.
- 0-39: At risk — timeline, resources, or focus are misaligned.

trend: compare to previousScore if set. "up" if clearly improving, "down" if declining, "flat" if stable or no prior score to compare.
Be honest. Do not inflate scores.

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
        max_tokens: 600,
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
