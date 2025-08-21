// File: api/translate.js
// Vercel Serverless Function (Node / ESM)
// Production version: restricted CORS + rate limit + sarcastic tone + Airtable logging

// ---------- Config ----------
const MODEL = process.env.MODEL || 'gpt-4o-mini';
// Set your production origin in an env var to avoid editing code:
// e.g. ALLOWED_ORIGIN=https://unfilter-the-hr.vercel.app or your custom domain.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://unfilter-the-hr.vercel.app';

// Basic, in-memory IP rate limit (best-effort on serverless; resets on cold start)
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 5); // requests per minute per IP
const buckets = new Map();
function limited(ip, limit = RATE_LIMIT_PER_MIN, windowMs = 60_000) {
  const now = Date.now();
  const rec = buckets.get(ip) || { count: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
  rec.count += 1;
  buckets.set(ip, rec);
  return rec.count > limit;
}

export default async function handler(req, res) {
  // --------- CORS ---------
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // --------- Rate limit ---------
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  if (limited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }

  // --------- Method / env checks ---------
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const required = ['OPENAI_API_KEY', 'AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}` });
  }

  // --------- Parse JSON body safely ---------
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

  try {
    // --------- 1) OpenAI: sarcastic corporate translator ---------
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              "You are a sarcastic corporate translator. You mock HR jargon and expose what it *really* means. " +
              "Your style is witty, irreverent, and funny. Keep answers concise (6–18 words). " +
              "No preambles, no disclaimers, no emojis."
          },
          {
            role: 'user',
            content: `Corporate phrase: "${phrase}". Give the unfiltered, sarcastic translation in one sentence.`
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
    if (!translation) {
      return res.status(502).json({ error: 'OpenAI returned no translation' });
    }

    // --------- 2) Airtable write (non-fatal if it fails) ---------
    // Do NOT write CreatedAt; use Airtable's "Created time" field in your base.
    const atRes = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}`,
      {
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
                Model: MODEL,
                Source: 'webapp'
              }
            }
          ]
        })
      }
    );

    if (!atRes.ok) {
      const atText = await atRes.text();
      // Return translation even if logging fails
      return res.status(200).json({
        translation,
        model: MODEL,
        airtable: { ok: false, detail: atText }
      });
    }

    // --------- 3) Done ---------
    return res.status(200).json({
      translation,
      model: MODEL,
      airtable: { ok: true }
    });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}

// Read raw body when req.body isn't populated
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
