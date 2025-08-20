// File: api/translate.js
// Vercel Serverless Function (Node / ESM) with debug mode

export default async function handler(req, res) {
  // Simple URL parsing for query params
  const url = new URL(req.url, `http://${req.headers.host}`);
  const debug = url.searchParams.get('debug') === '1';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Debug endpoint to inspect config without exposing secrets
  if (req.method === 'GET' && debug) {
    const mask = (val) =>
      typeof val === 'string' && val.length > 8
        ? `${val.slice(0, 4)}…${val.slice(-4)}`
        : (val ? 'set' : 'missing');

    const diagnostics = {
      ok: true,
      runtime: 'vercel-node',
      env: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'set' : 'missing',
        AIRTABLE_TOKEN: process.env.AIRTABLE_TOKEN ? 'set' : 'missing',
        AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID || 'missing',
        AIRTABLE_TABLE_ID: process.env.AIRTABLE_TABLE_ID || 'missing',
        MODEL: process.env.MODEL || 'gpt-4o-mini (default)'
      },
      notes: [
        'If OPENAI_API_KEY is set but you see 429/quota errors, add billing/credits to your OpenAI account.',
        'If Airtable writes fail, check PAT scope (data.records:write) and base/table IDs.'
      ],
      time: new Date().toISOString()
    };
    return res.status(200).json(diagnostics);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST or GET ?debug=1' });
  }

  // Check required envs early
  const required = ['OPENAI_API_KEY', 'AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_ID'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}` });
  }

  // Parse body robustly
  let phrase = '';
  try {
    if (req.body && typeof req.body === 'object') {
      phrase = req.body.phrase;
    } else {
      const raw = await readBody(req);
      const json = JSON.parse(raw || '{}');
      phrase = json.phrase;
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  if (!phrase || typeof phrase !== 'string') {
    return res.status(400).json({ error: 'Missing phrase' });
  }

  const model = process.env.MODEL || 'gpt-4o-mini';

  try {
    // 1) OpenAI call
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
      // Surface the upstream error so you can see quota/invalid-key/etc.
      return res.status(502).json({ error: 'OpenAI error', detail: txt });
    }

    const aiJson = await aiRes.json();
    const translation = aiJson?.choices?.[0]?.message?.content?.trim();
    if (!translation) {
      return res.status(502).json({ error: 'OpenAI returned no translation' });
    }

    // 2) Airtable write (non-fatal if it fails)
    const atRes = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}`, {
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
      const atText = await atRes.text();
      // Log-like info back to client for now (helps when logs aren’t visible)
      return res.status(200).json({
        translation,
        model,
        airtable: { ok: false, detail: atText }
      });
    }

    return res.status(200).json({ translation, model, airtable: { ok: true } });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}

// helper to read raw body when req.body is empty
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
