// api/documents/analyze-savings.js
// AI-powered savings analysis from real bank statement PDFs.
// Accepts up to 3 PDF base64 strings; falls back to metadata-only if no PDFs provided.
// Returns hierarchical spending categories with merchant drill-down.

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    bankStatements        = [],   // [{ base64?, name, year, month }] — upload path
    documents             = [],   // legacy metadata-only fallback
    existingCategories    = [],   // refresh path: pre-parsed spending categories
    existingSubscriptions = [],   // refresh path: pre-parsed subscriptions
    cashFlow,
    debtAccounts   = [],
    totalDebt      = 0,
  } = req.body;

  const statementsWithPdf = bankStatements.filter(s => s.base64);
  const statementCount    = statementsWithPdf.length || bankStatements.length || documents.length || 1;

  const cashFlowCtx = cashFlow
    ? `Monthly income: $${(cashFlow.income || cashFlow.monthlyIncome || 0).toLocaleString()}, spending: $${(cashFlow.spending || cashFlow.monthlySpending || 0).toLocaleString()}, surplus: $${(cashFlow.surplus || cashFlow.monthlySurplus || 0).toLocaleString()}`
    : 'No cash flow data available';

  const debtCtx = debtAccounts.length > 0
    ? `Total debt: $${(totalDebt || 0).toLocaleString()}. Accounts: ${debtAccounts.map(a => `${a.name} ($${(a.balance || 0).toLocaleString()}, ${a.interestRate || 0}% APR)`).join('; ')}`
    : 'No debt accounts tracked';

  let messages;

  if (statementsWithPdf.length > 0) {
    // Upload path — full PDF analysis
    const limited       = statementsWithPdf.slice(0, 3);
    const contentBlocks = [];
    for (const s of limited) {
      contentBlocks.push({
        type:   'document',
        source: { type: 'base64', media_type: 'application/pdf', data: s.base64 },
        title:  s.name || 'Bank Statement',
      });
    }
    contentBlocks.push({ type: 'text', text: buildPdfPrompt(limited, cashFlowCtx, debtCtx) });
    messages = [{ role: 'user', content: contentBlocks }];
  } else if (existingCategories.length > 0) {
    // Refresh path — use pre-parsed spending data, regenerate recommendations only
    messages = [{ role: 'user', content: buildRefreshPrompt(existingCategories, existingSubscriptions, cashFlowCtx, debtCtx) }];
  } else {
    // Fallback — metadata only
    const docCtx = [...bankStatements, ...documents].slice(0, 6)
      .map(d => `- ${d.name || 'Unknown'}${d.year ? ` (${d.year})` : ''}: ${d.description || 'No description'}`)
      .join('\n') || 'No bank statement details available';
    messages = [{ role: 'user', content: buildMetadataPrompt(docCtx, cashFlowCtx, debtCtx) }];
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':  'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system:     'You are a personal finance advisor. Return only valid JSON. No preamble, no explanation.',
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic analyze-savings error:', err);
      return res.status(500).json({ error: 'AI analysis failed' });
    }

    const data  = await response.json();
    const raw   = data?.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};

    return res.status(200).json({
      spendingCategories:  parsed.spendingCategories  || [],
      subscriptions:       parsed.subscriptions       || [],
      recommendations:     parsed.recommendations     || [],
      totalMonthlySavings: parsed.totalMonthlySavings || 0,
      debtFreeAcceleration: parsed.debtFreeAcceleration || null,
      statementCount,
      monthsAnalyzed: parsed.monthsAnalyzed || statementCount,
    });
  } catch (err) {
    console.error('Savings analysis error:', err);
    return res.status(500).json({ error: 'Analysis failed' });
  }
}

function buildPdfPrompt(statements, cashFlowCtx, debtCtx) {
  const names = statements.map(s => s.name || 'Bank Statement').join(', ');
  const multi = statements.length > 1;

  return `Analyze ${multi ? 'these ' + statements.length + ' bank statements' : 'this bank statement'} (${names}).

FINANCIAL CONTEXT:
Cash flow: ${cashFlowCtx}
Debt situation: ${debtCtx}

${multi ? 'Average spending across all statements to produce representative monthly figures.' : ''}

Extract REAL transaction data. Use actual merchant names found in the statements.

Return ONLY valid JSON (no markdown, no explanation):
{
  "spendingCategories": [
    {
      "name": "Dining & Restaurants",
      "icon": "🍽️",
      "monthlyTotal": 450.00,
      "transactions": [
        { "merchant": "McDonald's", "amount": 45.00, "frequency": "~5x/month" },
        { "merchant": "Chipotle",   "amount": 38.00, "frequency": "~2x/month" }
      ]
    }
  ],
  "subscriptions": [
    { "name": "Netflix", "estimatedMonthly": 15.99, "action": "keep" }
  ],
  "recommendations": [
    {
      "title": "Short action title",
      "monthlySavings": 150,
      "description": "Specific advice referencing real merchants or patterns seen in the statements",
      "difficulty": "easy",
      "categoryRef": "Dining & Restaurants"
    }
  ],
  "totalMonthlySavings": 400,
  "debtFreeAcceleration": 6,
  "monthsAnalyzed": ${statements.length}
}

Rules:
- spendingCategories: only include categories with $50+/month; list top 3-5 merchants per category
- subscriptions: only list clearly identified recurring charges
- recommendations: 3-6 specific, actionable items; reference real merchant names where applicable
- totalMonthlySavings: realistic sum of all recommendation monthlySavings
- debtFreeAcceleration: months sooner debt-free if all savings applied to highest-rate debt; null if no debt
- Return ONLY the JSON object`;
}

function buildRefreshPrompt(categories, subscriptions, cashFlowCtx, debtCtx) {
  const spendingLines = categories.map(c => {
    const merchants = (c.transactions || []).map(t => `${t.merchant} $${t.amount}`).join(', ');
    return `  ${c.icon || ''} ${c.name}: $${c.monthlyTotal}/mo${merchants ? ` (${merchants})` : ''}`;
  }).join('\n');

  const subLines = subscriptions.length > 0
    ? subscriptions.map(s => `  ${s.name}: $${s.estimatedMonthly}/mo`).join('\n')
    : '  None identified';

  return `You are a personal finance advisor. Based on this person's ACTUAL monthly spending and current debt, generate updated savings recommendations.

ACTUAL MONTHLY SPENDING (from bank statements):
${spendingLines}

SUBSCRIPTIONS:
${subLines}

CASH FLOW: ${cashFlowCtx}
DEBT: ${debtCtx}

Generate specific, actionable recommendations using the real merchant and spending data above.

Return ONLY valid JSON (no markdown):
{
  "recommendations": [
    {
      "title": "Short action title referencing real spending",
      "monthlySavings": 150,
      "description": "Specific advice using real merchant names and amounts from the spending data",
      "difficulty": "easy",
      "categoryRef": "matching category name"
    }
  ],
  "totalMonthlySavings": 400,
  "debtFreeAcceleration": 6
}

Rules:
- 3-6 recommendations; reference actual merchants and amounts where possible
- totalMonthlySavings = realistic sum of recommendation monthlySavings
- debtFreeAcceleration = months sooner debt-free if savings applied to highest-rate debt; null if no debt
- Return ONLY the JSON object`;
}

function buildMetadataPrompt(docCtx, cashFlowCtx, debtCtx) {
  return `You are a personal finance advisor. Identify actionable savings opportunities from this person's financial data.

Cash flow: ${cashFlowCtx}
Debt: ${debtCtx}
Bank statements on file: ${docCtx}

Return ONLY valid JSON (no markdown, no explanation):
{
  "spendingCategories": [
    { "name": "Dining & Restaurants", "icon": "🍽️", "monthlyTotal": 300, "transactions": [] }
  ],
  "subscriptions": [
    { "name": "Streaming services", "estimatedMonthly": 50, "action": "reduce" }
  ],
  "recommendations": [
    {
      "title": "Action title",
      "monthlySavings": 100,
      "description": "Specific, realistic advice for this income level",
      "difficulty": "easy",
      "categoryRef": ""
    }
  ],
  "totalMonthlySavings": 300,
  "debtFreeAcceleration": null,
  "monthsAnalyzed": 1
}

Rules:
- 3-5 recommendations maximum; keep estimates conservative
- Return ONLY the JSON object`;
}
