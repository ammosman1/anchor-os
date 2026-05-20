// api/documents/analyze-savings.js
// AI-powered savings analysis from real bank statement PDFs.
// Three analysis paths:
//   1. documentUrls  — server fetches PDFs from Firebase Storage (history seed / no CORS issues)
//   2. bankStatements with base64 — browser-uploaded PDF (new upload path)
//   3. existingCategories — text context only, refresh recommendations without re-parsing PDFs
//   4. metadata fallback — document descriptions only

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    bankStatements        = [],  // [{ base64, name, year, month }] — browser upload
    documentUrls          = [],  // [{ url, name, year, month }]    — server-side fetch (one at a time)
    documents             = [],  // legacy metadata-only fallback
    existingCategories    = [],  // refresh path: pre-parsed spending categories
    existingSubscriptions = [],  // refresh path: pre-parsed subscriptions
    cashFlow,
    debtAccounts = [],
    totalDebt    = 0,
  } = req.body;

  const cashFlowCtx = cashFlow
    ? `Monthly income: $${(cashFlow.income || cashFlow.monthlyIncome || 0).toLocaleString()}, spending: $${(cashFlow.spending || cashFlow.monthlySpending || 0).toLocaleString()}, surplus: $${(cashFlow.surplus || cashFlow.monthlySurplus || 0).toLocaleString()}`
    : 'No cash flow data available';

  const debtCtx = debtAccounts.length > 0
    ? `Total debt: $${(totalDebt || 0).toLocaleString()}. Accounts: ${debtAccounts.map(a => `${a.name} ($${(a.balance || 0).toLocaleString()}, ${a.interestRate || 0}% APR)`).join('; ')}`
    : 'No debt accounts tracked';

  // Path 1: server-side URL fetch (one document per call, caller loops)
  if (documentUrls.length > 0) {
    const d = documentUrls[0];
    try {
      const resp = await fetch(d.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf    = await resp.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      const stmt   = [{ base64, name: d.name, year: d.year, month: d.month }];
      const blocks = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 }, title: d.name || 'Bank Statement' },
        { type: 'text', text: buildPdfPrompt(stmt, cashFlowCtx, debtCtx) },
      ];
      return runAnalysis(res, [{ role: 'user', content: blocks }], 1);
    } catch (err) {
      console.error('Server-side PDF fetch failed:', err.message);
      return res.status(500).json({ error: 'Could not fetch PDF from storage' });
    }
  }

  // Path 2: browser-uploaded base64
  const statementsWithPdf = bankStatements.filter(s => s.base64);
  if (statementsWithPdf.length > 0) {
    const limited = statementsWithPdf.slice(0, 3);
    const blocks  = [
      ...limited.map(s => ({
        type:   'document',
        source: { type: 'base64', media_type: 'application/pdf', data: s.base64 },
        title:  s.name || 'Bank Statement',
      })),
      { type: 'text', text: buildPdfPrompt(limited, cashFlowCtx, debtCtx) },
    ];
    return runAnalysis(res, [{ role: 'user', content: blocks }], limited.length);
  }

  // Path 3: refresh — use existing category data, regenerate recommendations only
  if (existingCategories.length > 0) {
    const msg = buildRefreshPrompt(existingCategories, existingSubscriptions, cashFlowCtx, debtCtx);
    return runAnalysis(res, [{ role: 'user', content: msg }], 1);
  }

  // Path 4: metadata-only fallback
  const docCtx = [...bankStatements, ...documents].slice(0, 6)
    .map(d => `- ${d.name || 'Unknown'}${d.year ? ` (${d.year})` : ''}: ${d.description || 'No description'}`)
    .join('\n') || 'No bank statement details available';
  const statementCount = documents.length || bankStatements.length || 1;
  return runAnalysis(res, [{ role: 'user', content: buildMetadataPrompt(docCtx, cashFlowCtx, debtCtx) }], statementCount);
}

async function runAnalysis(res, messages, statementCount) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'pdfs-2024-09-25',
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

    const data   = await response.json();
    const raw    = data?.content?.[0]?.text || '{}';
    const clean  = raw.replace(/```json|```/g, '').trim();
    const match  = clean.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};

    return res.status(200).json({
      spendingCategories:   parsed.spendingCategories   || [],
      subscriptions:        parsed.subscriptions        || [],
      recommendations:      parsed.recommendations      || [],
      totalMonthlySavings:  parsed.totalMonthlySavings  || 0,
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
