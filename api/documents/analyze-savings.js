// api/documents/analyze-savings.js
// AI-powered savings analysis — scans bank statement metadata + cash flow to surface recommendations

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { documents, cashFlow, debtAccounts, totalDebt } = req.body;

  if (!documents || documents.length === 0) {
    return res.status(400).json({ error: 'No bank statement documents provided' });
  }

  const docContext = documents.slice(0, 6).map(d =>
    `- ${d.name || 'Unknown'}${d.year ? ` (${d.year})` : ''}: ${d.description || 'No description available'}`
  ).join('\n');

  const cashFlowContext = cashFlow
    ? `Monthly income: $${(cashFlow.income || cashFlow.monthlyIncome || 0).toLocaleString()}, spending: $${(cashFlow.spending || cashFlow.monthlySpending || 0).toLocaleString()}, surplus: $${(cashFlow.surplus || cashFlow.monthlySurplus || 0).toLocaleString()}`
    : 'No cash flow data available';

  const debtContext = debtAccounts && debtAccounts.length > 0
    ? `Total debt: $${(totalDebt || 0).toLocaleString()}. Accounts: ${debtAccounts.map(a => `${a.name} ($${(a.balance || 0).toLocaleString()}, ${a.interestRate || 0}% APR, $${a.minimumPayment || 0}/mo min)`).join('; ')}`
    : 'No debt accounts tracked';

  const prompt = `You are a personal finance advisor. Analyze this person's financial situation and identify actionable savings opportunities to accelerate debt payoff.

CASH FLOW:
${cashFlowContext}

DEBT SITUATION:
${debtContext}

BANK STATEMENT SUMMARIES:
${docContext}

Based on all available data, identify specific savings opportunities. Be practical and specific — focus on subscriptions, discretionary spending, and areas with high ROI for effort. If data is limited, make conservative recommendations based on typical spending patterns for this income level.

Return ONLY valid JSON (no markdown or explanation):
{
  "categories": [
    { "name": "string", "estimatedMonthly": number, "icon": "single emoji" }
  ],
  "subscriptions": [
    { "name": "string", "estimatedMonthly": number, "action": "cancel|reduce|keep" }
  ],
  "recommendations": [
    {
      "title": "Short action title (e.g. 'Cancel unused streaming services')",
      "monthlySavings": number,
      "description": "1-2 sentences: what to do and why it matters for debt payoff",
      "difficulty": "easy|medium|hard"
    }
  ],
  "totalMonthlySavings": number,
  "debtFreeAcceleration": number or null
}

Rules:
- Only include recommendations where savings are reasonably likely
- Keep totalMonthlySavings realistic (sum of all recommendation monthlySavings)
- debtFreeAcceleration = estimated months sooner debt-free if all savings applied to highest-interest debt (null if no debt)
- Include 3-6 recommendations maximum`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: 'You are a personal finance advisor. Return only valid JSON. No preamble, no explanation.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return res.status(500).json({ error: 'AI analysis failed' });
    }

    const data  = await response.json();
    const raw   = data?.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Savings analysis error:', err);
    return res.status(500).json({ error: 'Analysis failed' });
  }
}
