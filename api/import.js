import { supabaseUrl, supabaseKey } from "./_supabase.js";

// AI import: reads a document or pasted text and returns the events found.
// Only for signed-in members. Uses Claude if ANTHROPIC_API_KEY is set (paid),
// otherwise Google Gemini if GEMINI_API_KEY is set (free quota).

const GEMINI_MODELS = [process.env.GEMINI_MODEL || "gemini-3.8-flash", "gemini-3.5-flash-lite"];

async function withClaude(key, prompt, images) {
  const content = [
    ...images.map(im => ({ type: "image", source: { type: "base64", media_type: im.type, data: im.data } })),
    { type: "text", text: prompt },
  ];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 16000, output_config: { effort: "low" }, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) return { status: r.status, error: await r.text() };
  const out = await r.json();
  return { text: (out.content || []).filter(b => b.type === "text").map(b => b.text).join(""), truncated: out.stop_reason === "max_tokens" };
}

async function withGemini(key, prompt, images) {
  const parts = [...images.map(im => ({ inline_data: { mime_type: im.type, data: im.data } })), { text: prompt }];
  let last = { status: 502, error: "gemini" };
  // The second model is a fallback when the first is busy, unknown or out of free quota.
  for (const model of GEMINI_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { maxOutputTokens: 32768, responseMimeType: "application/json" } }),
    });
    if (!r.ok) { last = { status: r.status, error: await r.text() }; if ([404, 429, 500, 503].includes(r.status)) continue; return last; }
    const out = await r.json();
    const cand = (out.candidates || [])[0] || {};
    const text = ((cand.content && cand.content.parts) || []).map(p => p.text || "").join("");
    return { text, truncated: cand.finishReason === "MAX_TOKENS" };
  }
  return last;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const claudeKey = process.env.ANTHROPIC_API_KEY, geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  if ((!claudeKey && !geminiKey) || process.env.IMPORT_ENABLED === "false") return res.status(404).json({ error: "disabled" });

  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  const who = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: supabaseKey(), Authorization: `Bearer ${token}` },
  });
  if (!token || !who.ok) return res.status(401).json({ error: "not signed in" });

  const { prompt, images = [] } = req.body || {};
  if (typeof prompt !== "string" || !prompt) return res.status(400).json({ error: "prompt" });
  const out = claudeKey
    ? await withClaude(claudeKey, prompt.slice(0, 160000), images.slice(0, 3))
    : await withGemini(geminiKey, prompt.slice(0, 160000), images.slice(0, 3));
  if (out.error) return res.status(out.status === 429 ? 429 : 502).json({ error: out.error });
  res.status(200).json(out);
}
