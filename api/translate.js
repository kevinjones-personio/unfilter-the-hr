// File: api/translate.js
// Vercel Serverless Function (Node / ESM)
// Translates HR jargon via OpenAI and logs results to Airtable.
//
// Required environment variables (Project Settings → Environment Variables):
//   OPENAI_API_KEY       – OpenAI API key
//   AIRTABLE_TOKEN       – Airtable Personal Access Token (scope: data.records:write)
//   AIRTABLE_BASE_ID     – e.g. apprxccvde502eS4C
//   AIRTABLE_TABLE_ID    – e.g. tbltmqLNqQYKykfP7
//   MODEL                – optional, defaults to 'gpt-4o-mini'

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const required = ['OPENAI_API_KEY', 'AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_ID'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}` });
  }

  try {
    const { phrase } = req.body;
    if (!phrase || typeof phrase !== 'string') {
      return res.status(400).json({ error: 'Missing phrase' });
    }

    const model = process.env.MODEL || 'gpt-4o-mini';

    // 1) Ask OpenAI for a blunt HR translation
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You turn corporate HR jargon into clear, blunt, human language. Keep it concise, 6-18 words. No preambles.' },
          { role: 'user', content: `Translate this HR phrase into unfiltered plain English: "${phrase}"` }
        ],
        temperature: 0.7,
        max_tokens: 80
      })
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return res.status(500).json({ error: `OpenAI error: ${txt}` });
    }

    const aiJson = await aiRes.json();
    const translation = aiJson?.choices?.[0]?.message?.content?.trim();
    if (!translation) {
      return res.status(500).json({ error: 'No translation returned' });
    }

    // 2) Persist to Airtable
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableId = process.env.AIRTABLE_TABLE_ID;

    const atRes = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`
      },
      body: JSON.stringify({
        records: [
          { fields: { Phrase: phrase, Translation: translation, Model: model, Source: 'webapp', CreatedAt: new Date().toISOString() } }
        ]
      })
    });

    if (!atRes.ok) {
      console.warn('Airtable write failed:', await atRes.text());
    }

    // 3) Return JSON
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ translation });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}
