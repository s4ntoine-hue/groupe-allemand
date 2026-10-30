import { supabaseUrl, supabaseKey } from "./_supabase.js";

// AI import: reads a document or pasted text with Claude and returns the events found.
// Only for signed-in members, and only when ANTHROPIC_API_KEY is set in Vercel.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || process.env.IMPORT_ENABLED === "false") return res.status(404).json({ error: "disabled" });

  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  const who = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: supabaseKey(), Authorization: `Bearer ${token}` },
  });
  if (!token || !who.ok) return res.status(401).json({ error: "not signed in" });

  const { prompt, images = [] } = req.body || {};
  if (typeof prompt !== "string" || !prompt) return res.status(400).json({ error: "prompt" });
  const content = [
    ...images.slice(0, 3).map(im => ({ type: "image", source: { type: "base64", media_type: im.type, data: im.data } })),
    { type: "text", text: prompt.slice(0, 160000) },
  ];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 16000, output_config: { effort: "low" }, messages: [{ role: "user", content }] }),
  });
  if (r.status === 429) return res.status(429).json({ error: "rate limited" });
  if (!r.ok) return res.status(502).json({ error: await r.text() });
  const out = await r.json();
  const text = (out.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  res.status(200).json({ text, truncated: out.stop_reason === "max_tokens" });
}
