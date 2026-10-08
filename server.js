import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';

const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || 'openai/gpt-4o-mini';
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://ai.hackclub.com/proxy/v1';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  if (process.env.VERCEL !== '1') process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: BASE_URL
});

const app = express();

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '64kb' }));

if (process.env.VERCEL !== '1') {
  app.use(express.static('public'));
}

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
}));

const SYSTEM_PROMPT = `You are CarGPT, an automotive assistant. You answer questions about maintenance, diagnostics, warning lights, tyres, brakes, EV charging, fuel economy, and buying advice.

Reply using this exact plain-text format and nothing else:
- Separate paragraphs with one blank line.
- For a bullet list, start every line with "- " and keep all items in a single block.
- For a single callout or warning, start the line with "> ".
- Use **bold** for key terms. Do not use headings, code fences, italics, links, tables, or any other markdown.
- Keep replies concise: two to five short paragraphs, or one list plus a short closing note.

If the question is safety-critical, end with a "> " note telling the user to confirm with a certified mechanic.
If you need more detail, ask for make, model, year, and mileage.
If the question is outside automotive topics, politely redirect.`;

function sanitize(messages) {
  if (!Array.isArray(messages)) return null;

  const cleaned = messages
    .filter(m =>
      m &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0
    )
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (!cleaned.length) return null;
  if (cleaned[cleaned.length - 1].role !== 'user') return null;

  return cleaned;
}

function coerceToMiniFormat(text) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^\s*\d+\.\s+/gm, '- ')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .trim();
}

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = err.status === 429 || err.status >= 500;
      if (!isRetryable || attempt === maxRetries) throw err;

      const delay = Math.min(2 ** attempt * 500 + Math.random() * 500, 8000);
      console.warn(`Retry ${attempt + 1} in ${Math.round(delay)}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

app.post('/api/chat', async (req, res) => {
  const messages = sanitize(req.body?.messages);
  if (!messages) {
    return res.status(400).json({ error: 'invalid_messages' });
  }

  try {
    const completion = await withRetry(() =>
      openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages
        ],
        temperature: 0.4,
        max_tokens: 600
      })
    );

    let reply = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!reply) {
      return res.status(502).json({ error: 'empty_reply' });
    }

    reply = coerceToMiniFormat(reply);
    res.json({ reply });
  } catch (err) {
    console.error('chat_error', err?.status || '', err?.message || err);
    const status = err?.status === 429 ? 429 : 502;
    res.status(status).json({ error: 'upstream_error' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`CarGPT listening on http://localhost:${PORT}`);
    console.log(`Model: ${MODEL}`);
    console.log(`Base URL: ${BASE_URL}`);
  });
}

export default app;