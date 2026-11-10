// German easy news for the "Nachrichten" story: reads the nachrichtenleicht.de RSS feed.
// Vercel keeps the answer for one hour, so the feed is read at most about once an hour.
// If the feed cannot be read, the page keeps the last articles saved in Supabase.

const FEEDS = [
  process.env.NEWS_RSS_URL,
  "https://www.nachrichtenleicht.de/nachrichtenleicht-nachrichten-100.rss",
  "https://www.nachrichtenleicht.de/nachrichten.rss",
].filter(Boolean);

const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? decode(m[1]) : ""; };

function firstSentence(text) {
  const m = text.match(/^.{20,220}?[.!?](\s|$)/);
  return (m ? m[0] : text.slice(0, 200)).trim();
}

export function parseRss(xml) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(m => {
    const it = m[0];
    return { t: tag(it, "title"), teaser: firstSentence(tag(it, "description")), url: tag(it, "link") || tag(it, "guid"), at: Date.parse(tag(it, "pubDate")) || 0 };
  }).filter(x => x.t && /^https?:\/\//.test(x.url)).slice(0, 8);
}

export default async function handler(req, res) {
  for (const url of FEEDS) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "groupe-allemand/1.0 (site communautaire)" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const items = parseRss(await r.text());
      if (!items.length) continue;
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      // updatedAt = newest article, so the story only shows as new when there really is something new.
      const updatedAt = Math.max(...items.map(x => x.at)) || Date.now();
      return res.status(200).json({ items, source: "nachrichtenleicht.de", updatedAt });
    } catch {}
  }
  res.setHeader("Cache-Control", "public, s-maxage=300");
  res.status(502).json({ error: "feed" });
}
