// Goethe-Institut story: upcoming events of the Goethe-Institut de Nancy, which covers
// the Grand Est (Strasbourg events are listed there; there is no Goethe-Institut in Strasbourg).
// goethe.de builds its calendar pages with JavaScript, but publishes RSS feeds per institute:
// https://www.goethe.de/ins/fr/fr/rss.html. Each item title looks like
// "Cinéma : 03.11.2026-20.11.2026, Films en allemand" and pubDate is the event date.
// Events in Strasbourg come first, then the soonest ones. Past and postponed events are left out.
// Vercel keeps the answer for one hour. GOETHE_RSS_URLS (optional, comma-separated) replaces the feed list.
import { decode, firstSentence } from "./news.js";

const FEEDS = ["https://www.goethe.de/ins/fr/fr/rss/nan/ver.rss"];
const MAX = 6;
const UA = { "user-agent": "Mozilla/5.0 (compatible; groupe-allemand/1.0)" };
const NEAR = /strasbourg|mulhouse|colmar|bâle|basel|fribourg|freiburg|alsace/i;
const EMOJI = [[/cin[ée]ma|film/i, "🎬"], [/concert|musique/i, "🎵"], [/litt[ée]rature|lecture|livre/i, "📚"],
  [/exposition/i, "🖼️"], [/atelier/i, "✂️"], [/table ronde|conf[ée]rence|masterclass|débat/i, "🎤"],
  [/discussion|stammtisch|conversation/i, "💬"], [/cours|examen/i, "🎓"]];

const day = s => { const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : 0; };

export function parseFeed(xml) {
  const tag = (s, n) => { const m = s.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, "i")); return m ? m[1] : ""; };
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(([it]) => {
    const raw = decode(tag(it, "title"));
    // "Type : 03.11.2026-20.11.2026, Title"
    const m = raw.match(/^(.*?)\s*:\s*(\d{2}\.\d{2}\.\d{4})(?:\s*[-–]\s*(\d{2}\.\d{2}\.\d{4}))?\s*,\s*(.+)$/);
    const kind = m ? m[1] : "", from = m ? m[2] : "", to = m ? m[3] || "" : "", t = m ? m[4] : raw;
    const text = decode(tag(it, "description") || tag(it, "content:encoded"));
    const url = decode(tag(it, "link"));
    const start = day(from) || Date.parse(tag(it, "pubDate")) || 0;
    const emoji = (EMOJI.find(([re]) => re.test(kind + " " + t)) || [, "🇩🇪"])[1];
    return { t, kind, when: to ? `${from} – ${to}` : from, teaser: firstSentence(text), url, start, end: day(to) || start,
      near: NEAR.test(t + " " + text), postponed: /report[ée]|annul[ée]|abgesagt|verschoben/i.test(raw), emoji };
  }).filter(x => x.t && /^https?:\/\//.test(x.url));
}

export function pick(items, now = Date.now()) {
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  return items.filter(x => !x.postponed && x.end >= today.getTime())
    .sort((a, b) => (b.near - a.near) || (a.start - b.start)).slice(0, MAX);
}

export default async function handler(req, res) {
  const feeds = (process.env.GOETHE_RSS_URLS || "").split(",").map(s => s.trim()).filter(Boolean);
  const got = await Promise.allSettled((feeds.length ? feeds : FEEDS).map(async u => {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    return parseFeed(await r.text());
  }));
  const all = got.flatMap(g => g.status === "fulfilled" ? g.value : []);
  const seen = new Set();
  const items = pick(all.filter(x => !seen.has(x.url) && seen.add(x.url)));
  if (!got.some(g => g.status === "fulfilled")) {
    res.setHeader("Cache-Control", "public, s-maxage=300");
    return res.status(502).json({ error: "goethe" });
  }
  // updatedAt changes when the list changes, so the story only shows as new when there is something new.
  const updatedAt = items.reduce((h, x) => (h * 31 + x.start + x.t.length) % 2147483647, 7);
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({ items: items.map(({ start, end, postponed, ...x }) => x), source: "goethe.de", updatedAt });
}
