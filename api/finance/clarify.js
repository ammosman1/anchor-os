// api/finance/clarify.js
// Compares newly extracted accounts against existing records.
// Returns: high-confidence auto-matches, questions for ambiguous cases, and insights.

import { verifyAuthToken } from '../_firebase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    await verifyAuthToken(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { extractedAccounts = [], existingAccounts = [] } = req.body;

  if (!extractedAccounts.length) {
    return res.status(200).json({ matches: [], questions: [], insights: [] });
  }

  const existingList = existingAccounts.length
    ? existingAccounts.map((a, i) =>
        `${i}. "${a.name}" | type:${a.type} | balance:$${(a.balance || 0).toLocaleString()}`
      ).join('\n')
    : 'None on file yet.';

  const extractedList = extractedAccounts.map((a, i) =>
    `${i}. "${a.name}" | type:${a.type} | balance:$${(parseFloat(a.balance) || 0).toLocaleString()}`
  ).join('\n');

  const prompt = `You are matching newly imported financial accounts against a user's existing records.

EXISTING ACCOUNTS ON FILE:
${existingList}

NEWLY EXTRACTED ACCOUNTS (just imported, indices 0..${extractedAccounts.length - 1}):
${extractedList}

For EACH extracted account (every index 0 through ${extractedAccounts.length - 1}), determine the match type:
- "exact": clearly the same account — name is same or nearly same (minor case/punctuation difference), and type/balance are compatible. Auto-apply, no user confirmation needed.
- "possible": name is similar but genuinely uncertain — ask the user to confirm.
- "new": no meaningful match found in existing accounts.

Also generate insights for any account where an exact match exists but the balance changed by more than 2%.

Return ONLY a JSON object with this exact shape (no markdown, no explanation):
{
  "matches": [
    {
      "extractedIndex": 0,
      "matchType": "exact",
      "existingIndex": 2,
      "reason": "Same account, minor name variation"
    }
  ],
  "questions": [
    {
      "extractedIndex": 1,
      "existingIndex": 4,
      "question": "I found \\"CHASE CREDIT CARD\\" — is this the same as your existing \\"Chase Sapphire Card\\"?",
      "options": ["Yes, update existing account", "No, this is a new account"]
    }
  ],
  "insights": [
    "Capital One: balance dropped from $8,200 to $7,800 — $400 paid down since last import"
  ]
}

Rules:
- Every extracted account index must appear exactly once in "matches"
- Only accounts with matchType "possible" should appear in "questions"
- For exact matches where balance changed >2%, add an insight
- If no existing accounts, all are "new" — return empty questions and insights
- Keep questions concise and use the actual account names from the data`;

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
        max_tokens: 1500,
        system: 'You are a financial data analyst. Return only valid JSON, no markdown.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error('Clarify AI error:', await response.text());
      return res.status(200).json({ matches: [], questions: [], insights: [] });
    }

    const aiData = await response.json();
    const raw    = aiData?.content?.[0]?.text || '{}';
    const clean  = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json({
      matches:   result.matches   || [],
      questions: result.questions || [],
      insights:  result.insights  || [],
    });
  } catch (err) {
    console.error('Clarify error:', err);
    return res.status(200).json({ matches: [], questions: [], insights: [] });
  }
}
