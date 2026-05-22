// api/tasks/parse.js
// Parses a free-form voice or text transcript into structured task fields.
// Called by the quick-capture bar in the advisor panel.

import { verifyAuthToken } from '../_firebase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    await verifyAuthToken(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { transcript } = req.body;
  if (!transcript?.trim()) return res.status(400).json({ error: 'transcript required' });

  const today = new Date().toISOString().split('T')[0];

  const prompt = `Extract task details from this voice/text input and return JSON only.

TODAY'S DATE: ${today}

INPUT: "${transcript.trim()}"

Rules:
- title: the core task, cleaned up, title-case
- priority: "critical" | "high" | "medium" | "low" — default "medium"
- dueDate: YYYY-MM-DD if a due date / deadline is mentioned, otherwise null
- startDate: YYYY-MM-DD if a start date is mentioned ("starting Tuesday", "available from X"), otherwise null
- estimatedMinutes: integer if duration mentioned ("30 minutes", "an hour" = 60, "half hour" = 30), otherwise null
- notes: any extra context that doesn't fit the other fields, otherwise null

Day references: resolve relative to today (${today}). "Tomorrow" = next day, "Monday" = next Monday, etc.

Return ONLY valid JSON, no markdown:
{
  "title": "string",
  "priority": "medium",
  "dueDate": null,
  "startDate": null,
  "estimatedMinutes": null,
  "notes": null
}`;

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
        max_tokens: 256,
        system: 'You are a task parser. Return only valid JSON.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic parse error:', err);
      return res.status(500).json({ error: 'Parse failed' });
    }

    const data  = await response.json();
    const raw   = data?.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({ task: parsed });
  } catch (err) {
    console.error('Task parse error:', err);
    return res.status(500).json({ error: 'Parse failed' });
  }
}
