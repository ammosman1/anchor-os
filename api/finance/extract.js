// api/finance/extract.js
// Parses uploaded financial files (Excel/CSV structured data or PDF base64)
// and uses Claude to extract debt accounts + cash flow summary.

import { verifyAuthToken } from '../_firebase-admin.js';

const DEBT_TYPES = ['tax', 'business', 'personal', 'credit', 'auto', 'student', 'mortgage', 'medical', 'other'];


export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    await verifyAuthToken(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type, data, fileName = 'uploaded file', existingAccounts = [] } = req.body;
  if (!type || !data) return res.status(400).json({ error: 'type and data required' });

  const existingNames = existingAccounts.map(a => a.name).join(', ') || 'none';

  let messages;

  if (type === 'pdf') {
    // data is base64-encoded PDF
    messages = [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: data,
            },
          },
          {
            type: 'text',
            text: buildPrompt(fileName, existingNames, 'bank statement or financial document'),
          },
        ],
      },
    ];
  } else {
    // type === 'structured' — data is { headers: [...], rows: [[...], ...] }
    const tableText = formatTableAsText(data);
    messages = [
      {
        role: 'user',
        content: buildPrompt(fileName, existingNames, 'spreadsheet/CSV') + '\n\nFILE CONTENTS:\n' + tableText,
      },
    ];
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: 'You are a precise financial data extraction engine. Return only valid JSON. Never invent data not present in the source.',
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic extract error:', err);
      return res.status(500).json({ error: 'AI extraction failed' });
    }

    const aiData = await response.json();
    const raw    = aiData?.content?.[0]?.text || '{}';
    const clean  = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    // Normalize accounts
    const accounts = (result.accounts || []).map(a => ({
      name:           String(a.name || '').trim(),
      balance:        parseFloat(a.balance) || 0,
      interestRate:   parseFloat(a.interestRate) || 0,
      minimumPayment: parseFloat(a.minimumPayment) || 0,
      type:           DEBT_TYPES.includes(a.type) ? a.type : 'other',
      notes:          a.notes || '',
      isDuplicate:    existingAccounts.some(e =>
        e.name.toLowerCase().trim() === String(a.name || '').toLowerCase().trim()
      ),
    }));

    const cashFlow = result.cashFlow || null;
    const summary  = result.summary || `Extracted ${accounts.length} account(s) from ${fileName}.`;

    return res.status(200).json({ accounts, cashFlow, summary });
  } catch (err) {
    console.error('Finance extract error:', err);
    return res.status(500).json({ error: 'Extraction failed' });
  }
}

function buildPrompt(fileName, existingNames, fileType) {
  return `Analyze this ${fileType} named "${fileName}" and extract debt/loan accounts and cash flow data.

EXISTING ACCOUNTS ALREADY ON FILE (flag these as duplicates if found): ${existingNames}

WHAT TO EXTRACT — accounts where money is OWED (debts):
- Credit cards with outstanding balances
- Auto loans, mortgages, student loans
- Personal loans, business loans, medical debt
- Tax debt (IRS, state)
- Lines of credit with outstanding balances

DO NOT INCLUDE — these are NOT debts:
- Checking accounts, savings accounts, money market accounts
- Bank account balances (even if negative/overdrawn)
- Transfer transactions or internal transfers between accounts
- Investment or brokerage accounts
- Payment receipts or confirmed payments

Return a JSON object with this exact shape:
{
  "accounts": [
    {
      "name": "account name (e.g. IRS Tax Debt 2023, Wells Fargo Auto Loan, Chase Sapphire Card)",
      "balance": 12500.00,
      "interestRate": 18.5,
      "minimumPayment": 250.00,
      "type": "one of: tax | business | personal | credit | auto | student | mortgage | medical | other",
      "notes": "any relevant details like account number last 4, due date, payoff status"
    }
  ],
  "cashFlow": {
    "monthlyIncome": 8500.00,
    "monthlySpending": 6200.00,
    "monthlySurplus": 2300.00,
    "notes": "brief note on how this was derived — e.g. 'From April 2026 statement: $X credits, $Y debits'"
  },
  "summary": "One sentence describing what was found — e.g. '3 debt accounts found in April Wells Fargo statement'"
}

Rules:
- Only include accounts where a balance is clearly owed (not asset accounts)
- If interest rate not shown, use 0
- If minimum payment not shown, use 0
- cashFlow: for bank statements, use total credits as income and total debits as spending for the ONE statement period shown; do not multiply or annualize — report the single-month figures exactly as they appear
- cashFlow is null if no transaction totals or income/spending data is present
- For Excel debt trackers: look for columns named balance, amount owed, rate, APR, interest, minimum, payment, current balance
- Return ONLY the JSON object. No markdown. No explanation.`;
}

function formatTableAsText(data) {
  if (data?.text) return data.text;
  if (data?.sheets) {
    return data.sheets.map(s =>
      `--- Sheet: ${s.sheetName} ---\n${s.headers.join('\t')}\n${s.rows.slice(0, 300).map(r => r.join('\t')).join('\n')}`
    ).join('\n\n');
  }
  if (!data || !data.rows) return JSON.stringify(data);
  const { headers = [], rows = [] } = data;
  const lines = [];
  if (headers.length) lines.push(headers.join('\t'));
  rows.slice(0, 500).forEach(row => lines.push(row.join('\t')));
  return lines.join('\n');
}
