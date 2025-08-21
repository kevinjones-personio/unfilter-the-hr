// File: api/translate.js
// Vercel Serverless Function (Node / ESM) with sarcastic tone + debug mode

export default async function handler(req, res) {
  // Parse query (for debug)
  const url = new URL(req.url, `http://${req.headers.host}`);
  const debug = url.searchParams.get('debug') === '1';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Debug endpoint to quickly verify env/setup without exposing secrets
  if (req.method === 'GET' && debug) {
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
        'If OPENAI_API_KEY is set but you see 429/insufficient_quota, add billing/credits to your OpenAI account.',
        'If Airtable writes fail, check PAT scope (data.records:write) and base/table IDs.'
      ],
      time: new Date().toISOString()
    };
    return res.status(200).json(diagnostics);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST or GET ?debug=1' });
  }

  // Required envs
  const required = ['OPENAI_API_KEY', 'AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_ID'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}` });
  }

  // Parse body safely
  let phrase = '';
  try {
    if (req.body && typeof req.body === 'object') {
      phrase = req.body.phrase;
    } else {
      const raw = await readBody(req);
      const json = JSON.parse(raw || '{}');
      phrase = json.phrase;
    }
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  if (!phrase || typeof phrase !== 'string') {
    return res.status(400).json({ error: 'Missing phrase' });
  }

  const model = process.env.MODEL || 'gpt-4o-mini';

  try {
    // === 1) OpenAI: sarcastic corporate translator ===
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              "You are a sarcastic corporate translator. You mock HR jargon and expose what it *really* means. " +
              "Your style is witty, irreverent, and funny. Keep answers concise (6–18 words). No preambles, no disclaimers, no emojis."
          },
          {
            role: 'user',
            content:
              `Corporate phrase: "${phrase}". Give the unfiltered, sarcastic translation in one sentence.`
          }
        ],
        temperature: 0.8,
        max_tokens: 80
      })
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return res.status(502).json({ error: 'OpenAI error', detail: txt });
    }

    const aiJson = await aiRes.json();
    const translation = aiJson?.choices?.[0]?.message?.content?.trim();
    if (!translation) return res.status(502).json({ error: 'OpenAI returned no translation' });

    // === 2) Airtable write (non-fatal if it fails) ===
    const atRes = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`
      },
      body: JSON.stringify({
        records: [
          {
            fields: {
                Phrase: phrase,
                Translation: translation,
                Model: model,
                Source: 'webapp'
                // CreatedAt: (omit – Airtable will fill a Created time field automatically)
              }
            }
          }
        ]
      })
    });

    if (!atRes.ok) {
      const atText = await atRes.text();
      // Return translation anyway; include Airtable write diagnostics
      return res.status(200).json({
        translation,
        model,
        airtable: { ok: false, detail: atText }
      });
    }

    // === 3) Respond to client ===
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
