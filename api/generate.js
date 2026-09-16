'use strict';
/**
 * api/generate.js — gör flervalsfrågor av studiematerial med Gemini.
 *
 * POST /api/generate
 *   { text, count, difficulty, lang, part, parts }
 *   → { questions: [{ question, options[4], correct, explanation, topic }], model }
 *
 * Nyckeln (GEMINI_API_KEY) läses bara här på servern och når aldrig klienten.
 * Klienten delar upp stora dokument i bitar och anropar den här funktionen en
 * gång per bit; `part`/`parts` talar om för modellen var i dokumentet biten
 * ligger så frågorna sprids över hela materialet.
 *
 * Svårighetsgraden styr FRÅGORNAS karaktär (inte bara antalet liv i spelet):
 * beginner/easy = faktaåterkallning, medium = förståelse, hard = tillämpning
 * och resonemang, insane = expertnivå med detaljer, undantag och negationer.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
// Aliaset "flash-latest" svarade 503 "high demand" vid bygget (2026-09-05) — därför en
// kedja: samma nyckel, nästa modell. Alla är gratisnivå-modeller för text.
const MODEL_CHAIN = [...new Set([MODEL, 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-lite-latest'])];
const MAX_TEXT = 32000;      // tecken per anrop — klienten delar upp större material
const MAX_COUNT = 30;        // frågor per anrop
const TIMEOUT_MS = 50000;    // under Vercels 60 s

const LEVELS = {
  beginner: `BEGINNER: pure recall of the most important facts and definitions. Every question must be answerable from a single sentence in the material. Make the wrong options clearly wrong. Keep questions short and friendly.`,
  easy: `EASY: recall of key facts, definitions and named concepts. One wrong option may be somewhat plausible, the other two clearly wrong.`,
  medium: `MEDIUM: understanding rather than recall — why/how, relationships between concepts, typical examples, cause and effect. Two of the wrong options should be plausible to someone who only skimmed the material.`,
  hard: `HARD: application and reasoning. Prefer scenario-style questions ("A patient/case/situation with X — which is most likely / what is the first step / which statement is true?") that require combining two or more facts from the material. All three wrong options must be plausible. Include a few "Which of the following is NOT ..." items.`,
  insane: `INSANE (expert): precise numbers, thresholds, exceptions, edge cases, mechanisms and multi-step reasoning. Wrong options must differ from the correct one by a subtle but decisive detail (a number, a condition, a direction, an exception). Include negations ("NOT", "EXCEPT"), "most likely" and "best next step" items. Never ask about trivia such as layout, page numbers or authorship — only substance.`,
};

const LANG_NAMES = { sv: 'Swedish', en: 'English', fr: 'French', es: 'Spanish', de: 'German', no: 'Norwegian', da: 'Danish', fi: 'Finnish' };

function buildPrompt({ text, count, difficulty, lang, part, parts }) {
  const level = LEVELS[difficulty] || LEVELS.easy;
  const langName = LANG_NAMES[lang] || null;
  const where = parts > 1 ? `This is part ${part} of ${parts} of a longer document; write questions ONLY about this part.` : '';
  return `You are an expert exam writer. From the STUDY MATERIAL below, write exactly ${count} multiple-choice questions.

DIFFICULTY — ${level}

Rules that always apply:
- Use ONLY facts stated in the material. Never invent facts, never ask about things the material does not say.
- Never ask about metadata: page numbers, headers, footers, authors, dates of publication, file names, figure numbers, formatting.
- Spread the questions across the whole material; do not cluster on one paragraph. No two questions may test the same fact.
- Exactly 4 options per question, exactly one correct. Options must be of similar length and grammatical form, so the correct one cannot be guessed by its shape. No "all of the above" / "none of the above". Do NOT prefix options with letters.
- Randomize which position (0-3) holds the correct answer; roughly equal counts of each.
- "explanation": 1–2 sentences that state the correct answer and why, based on the material — useful for someone who got it wrong.
- "topic": 2–4 words naming the concept the question tests.
- Write questions, options and explanations in ${langName ? langName : 'the same language as the material'}${langName ? ' (the language of the material)' : ''}.
${where}

Return ONLY JSON with this exact shape and nothing else:
{"questions":[{"question":"...","options":["...","...","...","..."],"correct":0,"explanation":"...","topic":"..."}]}

STUDY MATERIAL:
"""
${text}
"""`;
}

function extractJson(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(t); } catch { /* leta efter första objektet */ }
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first !== -1 && last > first) { try { return JSON.parse(t.slice(first, last + 1)); } catch { /* ge upp */ } }
  return null;
}

async function callGemini(key, prompt, { withThinking = true, model = MODEL } = {}) {
  const generationConfig = { maxOutputTokens: 8192, temperature: 0.7, responseMimeType: 'application/json' };
  if (withThinking) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const err = new Error(`Gemini ${r.status}: ${body.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  const d = await r.json();
  const cand = d.candidates && d.candidates[0];
  const out = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || '').join('').trim();
  if (!out && cand && cand.finishReason && cand.finishReason !== 'STOP') throw new Error(`Gemini avbröt: ${cand.finishReason}`);
  return out;
}

/** Bara frågor som spelet kan använda släpps igenom: 4 alternativ, ett rätt, text i alla fält. */
function sanitize(list, count) {
  const seen = new Set(), out = [];
  for (const q of Array.isArray(list) ? list : []) {
    if (!q || typeof q.question !== 'string' || !Array.isArray(q.options)) continue;
    const options = q.options.map((o) => String(o == null ? '' : o).replace(/^\s*[A-Da-d][).:]\s*/, '').trim()).filter(Boolean);
    if (options.length !== 4) continue;
    const correct = Number(q.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) continue;
    const question = q.question.trim();
    const key = question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      question,
      options,
      correct,
      explanation: String(q.explanation || '').trim().slice(0, 600),
      topic: String(q.topic || '').trim().slice(0, 60),
    });
    if (out.length >= count) break;
  }
  return out;
}

// Studiekopian på GitHub Pages (marcdshark666.github.io/QuizRush) ligger på en annan
// domän och har ingen egen serverfunktion — den lånar den här. Bara den domänen
// släpps in: en öppen CORS skulle låta vem som helst bränna nyckelns kvot.
const ALLOWED_ORIGINS = new Set(['https://marcdshark666.github.io']);
function cors(req, res) {
  const origin = req.headers && req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, model: MODEL, hasKey: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  // BOM/blanksteg strippas: en nyckel som lagts in via en PowerShell-pipe fick ett
  // U+FEFF först, och fetch vägrar då sätta headern ("ByteString … 65279").
  const key = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').replace(/^﻿/, '').trim();
  if (!key) return res.status(503).json({ error: 'no_key', message: 'GEMINI_API_KEY saknas på servern.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body.text !== 'string') return res.status(400).json({ error: 'bad_request', message: 'text saknas' });

  const text = body.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (text.length < 80) return res.status(400).json({ error: 'too_short', message: 'För lite text för att skriva frågor.' });
  const count = Math.max(1, Math.min(MAX_COUNT, parseInt(body.count, 10) || 10));
  const difficulty = LEVELS[body.difficulty] ? body.difficulty : 'easy';
  const lang = typeof body.lang === 'string' ? body.lang.slice(0, 5) : null;
  const part = Math.max(1, parseInt(body.part, 10) || 1);
  const parts = Math.max(part, parseInt(body.parts, 10) || 1);

  const prompt = buildPrompt({ text, count, difficulty, lang, part, parts });
  try {
    let raw = null, used = null, lastErr = null;
    const started = Date.now();
    for (const model of MODEL_CHAIN) {
      if (Date.now() - started > TIMEOUT_MS) break;
      try { raw = await callGemini(key, prompt, { model }); used = model; break; }
      catch (e) {
        lastErr = e;
        // 400 = modellen kan inte thinkingLevel; 500 är ofta övergående → ett försök utan.
        if (e.status === 400 || e.status === 500) {
          try { raw = await callGemini(key, prompt, { withThinking: false, model }); used = model; break; } catch (e2) { lastErr = e2; }
        }
        // 503 "high demand" / 429 / 404 (modellen finns inte för nyckeln) → nästa modell i kedjan.
        if (![503, 429, 404, 400, 500].includes(e.status)) throw e;
      }
    }
    if (raw == null) throw lastErr || new Error('Ingen modell svarade.');
    const parsed = extractJson(raw);
    const questions = sanitize(parsed && (parsed.questions || parsed), count);
    if (!questions.length) return res.status(502).json({ error: 'empty', message: 'Modellen gav inga användbara frågor.' });
    return res.status(200).json({ questions, model: used, part, parts });
  } catch (e) {
    console.error('generate misslyckades:', e && e.status, e && e.name, String(e && e.message || e).slice(0, 400));
    const quota = e.status === 429 || /quota|RESOURCE_EXHAUSTED|rate limit/i.test(e.message || '');
    const status = quota ? 429 : e.name === 'AbortError' ? 504 : 502;
    return res.status(status).json({ error: quota ? 'quota' : e.name === 'AbortError' ? 'timeout' : 'upstream', message: String(e.message || e).slice(0, 300) });
  }
};
