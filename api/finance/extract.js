// api/finance/extract.js
// Parses uploaded financial files (Excel/CSV structured data or PDF base64)
// and uses Claude to extract debt accounts + cash flow summary.
// Supports docTypeHint: 'bank_statement' | 'credit_card' | 'loan' | 'other'

import { verifyAuthToken } from '../_firebase-admin.js';

const DEBT_TYPES = ['tax', 'business', 'personal', 'credit', 'auto', 'student', 'mortgage', 'medical', 'other'];


export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    await verifyAuthToken(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type, data, fileName = 'uploaded file', existingAccounts = [], docTypeHint = null } = req.body;
  if (!type || !data) return res.status(400).json({ error: 'type and data required' });

  const existingNames = existingAccounts.map(a => a.name).join(', ') || 'none';
  const fileType = type === 'pdf' ? 'PDF' : 'spreadsheet/CSV';

  let messages;

  if (type === 'pdf') {
    messages = [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data },
          },
          {
            type: 'text',
            text: buildPrompt(fileName, existingNames, fileType, docTypeHint),
          },
        ],
      },
    ];
  } else {
    const tableText = formatTableAsText(data);
    messages = [
      {
        role: 'user',
        content: buildPrompt(fileName, existingNames, fileType, docTypeHint) + '\n\nFILE CONTENTS:\n' + tableText,
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
    const detectedDocType = result.docType || docTypeHint || null;

    return res.status(200).json({ accounts, cashFlow, summary, docType: detectedDocType });
  } catch (err) {
    console.error('Finance extract error:', err);
    return res.status(500).json({ error: 'Extraction failed' });
  }
}

function buildPrompt(fileName, existingNames, fileType, docTypeHint) {
  if (docTypeHint === 'bank_statement') {
    return buildBankStatementPrompt(fileName, fileType);
  }
  if (docTypeHint === 'credit_card') {
    return buildCreditCardPrompt(fileName, existingNames, fileType);
  }
  if (docTypeHint === 'loan') {
    return buildLoanPrompt(fileName, existingNames, fileType);
  }
  // 'other' or no hint — auto-detect and use general extraction
  return buildGenericPrompt(fileName, existingNames, fileType);
}

function buildBankStatementPrompt(fileName, fileType) {
  return `Analyze this ${fileType} named "${fileName}". This is a checking or savings account bank statement.

IMPORTANT: Bank statements show TRANSACTIONS, not debt balances. Do NOT extract any accounts.
Any mentions of mortgage, auto loan, or credit card payments in the transactions are OUTGOING PAYMENTS — they do NOT represent debt accounts with those balances.

Extract ONLY cash flow:
- Total credits/deposits for the statement period = monthlyIncome
- Total debits/withdrawals for the statement period = monthlySpending

Return this exact JSON:
{
  "docType": "bank_statement",
  "accounts": [],
  "cashFlow": {
    "monthlyIncome": 5000.00,
    "monthlySpending": 4200.00,
    "monthlySurplus": 800.00,
    "notes": "April 2026 Wells Fargo checking: $5,000 deposits, $4,200 withdrawals"
  },
  "summary": "April 2026 bank statement: $5,000 income, $4,200 spending, $800 surplus"
}

Rules:
- accounts MUST be an empty array []
- Use the EXACT totals from the one statement period — do NOT annualize or multiply
- monthlySurplus = monthlyIncome - monthlySpending
- cashFlow is null only if no transaction totals are present at all
- Return ONLY the JSON object. No markdown. No explanation.`;
}

function buildCreditCardPrompt(fileName, existingNames, fileType) {
  return `Analyze this ${fileType} named "${fileName}". This is a credit card statement.

EXISTING ACCOUNTS ALREADY ON FILE (flag as duplicate if found): ${existingNames}

Extract as ONE credit card debt account plus optional cash flow.

Return this exact JSON:
{
  "docType": "credit_card",
  "accounts": [
    {
      "name": "card name (e.g. Chase Sapphire Preferred, Capital One Venture)",
      "balance": 2500.00,
      "interestRate": 19.99,
      "minimumPayment": 50.00,
      "type": "credit",
      "notes": "Statement balance as of [date]; account ending in XXXX"
    }
  ],
  "cashFlow": null,
  "summary": "Chase Sapphire: $2,500 balance, 19.99% APR, $50 minimum"
}

Rules:
- balance: the statement balance or new balance — the amount currently owed
- interestRate: APR; use 0 if not shown
- minimumPayment: minimum payment due; use 0 if not shown
- cashFlow: set to null unless the statement clearly shows total charges for the period
- Return ONLY the JSON object. No markdown. No explanation.`;
}

function buildLoanPrompt(fileName, existingNames, fileType) {
  return `Analyze this ${fileType} named "${fileName}". This is a loan or mortgage statement.

EXISTING ACCOUNTS ALREADY ON FILE (flag as duplicate if found): ${existingNames}

Extract as ONE debt account. Do not include cash flow.

Return this exact JSON:
{
  "docType": "loan",
  "accounts": [
    {
      "name": "loan name (e.g. Wells Fargo Mortgage, Toyota Financial Auto Loan, Navient Student Loan)",
      "balance": 187500.00,
      "interestRate": 4.25,
      "minimumPayment": 1847.00,
      "type": "mortgage",
      "notes": "Principal balance as of [date]"
    }
  ],
  "cashFlow": null,
  "summary": "Wells Fargo Mortgage: $187,500 balance at 4.25%, $1,847/mo payment"
}

Rules:
- balance: current principal balance or payoff amount
- interestRate: annual interest rate; use 0 if not shown
- minimumPayment: regular monthly payment amount; use 0 if not shown
- type: choose the best match from: mortgage | auto | student | personal | medical | other
- Return ONLY the JSON object. No markdown. No explanation.`;
}

function buildGenericPrompt(fileName, existingNames, fileType) {
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
- Any account mentioned only as a payment recipient in transactions (e.g. "Paid to Chase Mortgage $1,500" does NOT mean extract Chase Mortgage with $1,500 balance — that is a payment transaction, not a balance)
- Transfer transactions or internal transfers between accounts
- Investment or brokerage accounts

Return a JSON object with this exact shape:
{
  "docType": "credit_card | loan | mortgage | excel_tracker | other",
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
    "notes": "brief note on how this was derived"
  },
  "summary": "One sentence describing what was found"
}

Rules:
- Only include accounts where a balance is clearly owed
- If interest rate not shown, use 0; if minimum payment not shown, use 0
- cashFlow: for bank statements use total credits as income and total debits as spending for the ONE period; do not annualize
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
