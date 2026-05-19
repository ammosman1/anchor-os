// api/documents/extract.js
// AI-powered document extraction — pulls key metadata from uploaded PDFs and images

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { fileData, mimeType } = req.body;
  if (!fileData || !mimeType) return res.status(400).json({ error: 'fileData and mimeType required' });

  const isPdf   = mimeType === 'application/pdf';
  const isImage = mimeType.startsWith('image/');
  if (!isPdf && !isImage) {
    return res.status(400).json({ error: 'Only PDF and image files are supported' });
  }

  const fileContent = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } }
    : { type: 'image',    source: { type: 'base64', media_type: mimeType,            data: fileData } };

  const prompt = `Analyze this document and extract key information. Return ONLY valid JSON, no markdown:
{
  "suggestedTitle": "short descriptive title (e.g. 'Chase Checking - April 2026')",
  "category": "bank_statement|credit_card|invoice|receipt|tax|insurance|medical|contract|utility|paycheck|other",
  "vendor": "company or source name as a string, or null",
  "amount": null or a number (total dollar amount if clearly present),
  "date": "YYYY-MM-DD of the document date if present, else null",
  "year": year as a number (4 digits) if determinable, else null,
  "month": month as a number 1-12 if determinable, else null,
  "description": "1-2 sentence summary of what this document is"
}`;

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    };
    if (isPdf) headers['anthropic-beta'] = 'pdfs-2024-09-25';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: 'You are a document parser. Return only valid JSON. No preamble, no explanation.',
        messages: [{ role: 'user', content: [fileContent, { type: 'text', text: prompt }] }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return res.status(500).json({ error: 'AI extraction failed' });
    }

    const data  = await response.json();
    const raw   = data?.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Document extraction error:', err);
    return res.status(500).json({ error: 'Extraction failed' });
  }
}
