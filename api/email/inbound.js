// api/email/inbound.js
// Receives inbound email webhooks and creates tasks or documents in Firestore.
//
// Compatible with Postmark Inbound Parsing (JSON body) and any service that
// sends: { From, To, Subject, TextBody } as JSON.
//
// Auth: the recipient address encodes the user's inboundEmailToken:
//   tasks+{token}@your-inbound-domain.com
// The token can also appear in the subject as [anchor:{token}]
//
// Setup (Postmark):
//   1. Create a Postmark account → Servers → Inbound → set address & webhook URL
//   2. Webhook URL: https://your-app.vercel.app/api/email/inbound
//   3. In Anchor Settings, copy your unique inbound address and use it as the
//      forwarding target (or set up a filter in Gmail to auto-forward).

import { getAdminDb } from '../_firebase-admin.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function parseEmailToTask(subject, body) {
  const prompt = `Parse this forwarded email into an Anchor task. Return ONLY valid JSON:
{
  "title": "concise action-oriented task title (under 12 words, verb-first)",
  "priority": "critical|high|medium|low",
  "notes": "relevant context from the email body, or null",
  "isDocument": false,
  "dueDate": "YYYY-MM-DD if a clear deadline is mentioned, else null"
}

Rules:
- title must be actionable (e.g. "Review Q2 contract from Acme Corp")
- priority: critical if urgent/ASAP language; high if important; medium default; low if informational
- notes: keep under 200 chars; strip signatures and boilerplate
- isDocument: true only if the email is primarily a document/statement (bank statement, invoice, etc.) rather than something to do

Email subject: ${subject}
Email body:
${(body || '').slice(0, 1500)}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: 'Return ONLY valid JSON. No markdown. No explanation.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic error ${res.status}`);
  const data = await res.json();
  const raw = data?.content?.[0]?.text || '{}';
  const clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

function extractToken(toAddress, subject) {
  // Try to extract from to address: tasks+TOKEN@domain.com
  if (toAddress) {
    const toMatch = toAddress.match(/\+([a-zA-Z0-9_-]{8,})\s*@/);
    if (toMatch) return toMatch[1];
  }
  // Fallback: [anchor:TOKEN] in subject
  if (subject) {
    const subjMatch = subject.match(/\[anchor:([a-zA-Z0-9_-]{8,})\]/i);
    if (subjMatch) return subjMatch[1];
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || {};

  // Support Postmark format (From/To/Subject/TextBody) and generic lowercase
  const from    = body.From    || body.from    || '';
  const to      = body.To      || body.to      || '';
  const subject = body.Subject || body.subject || '(no subject)';
  const text    = body.TextBody || body.text   || body.body || '';

  if (!subject && !text) {
    return res.status(400).json({ error: 'No content to parse' });
  }

  // Identify user by inbound token
  const token = extractToken(to, subject);
  if (!token) {
    return res.status(400).json({ error: 'No inbound token found in address or subject' });
  }

  const db = getAdminDb();

  // Find user with this inbound token
  const usersSnap = await db.collection('users')
    .where('inboundEmailToken', '==', token)
    .limit(1)
    .get();

  if (usersSnap.empty) {
    return res.status(404).json({ error: 'Unknown inbound token' });
  }

  const userDoc = usersSnap.docs[0];
  const uid = userDoc.id;

  // Parse email with Claude
  let parsed;
  try {
    parsed = await parseEmailToTask(subject, text);
  } catch (err) {
    console.error('AI parse error:', err);
    // Fallback: use subject as title
    parsed = { title: subject.slice(0, 80), priority: 'medium', notes: null, isDocument: false, dueDate: null };
  }

  if (!parsed || !parsed.title) {
    return res.status(422).json({ error: 'Could not parse email into task' });
  }

  const now = new Date().toISOString();

  // Create task in Firestore
  await db.collection('users').doc(uid).collection('tasks').add({
    title:      parsed.title,
    priority:   parsed.priority || 'medium',
    notes:      parsed.notes ? `From: ${from}\n\n${parsed.notes}` : `Forwarded from: ${from}`,
    dueDate:    parsed.dueDate || null,
    source:     'email',
    status:     'pending',
    done:       false,
    project:    'Inbox',
    projectId:  null,
    goalId:     null,
    tags:       ['email'],
    blockedBy:  [],
    createdAt:  now,
    updatedAt:  now,
  });

  return res.status(200).json({ ok: true, title: parsed.title, priority: parsed.priority });
}
