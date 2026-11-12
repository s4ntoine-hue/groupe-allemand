// German easy news for the "Nachrichten" story, from nachrichtenleicht.de (Deutschlandfunk).
// The site has no RSS feed for its daily news, so this reads the home page, takes the first
// article links, then reads each article's title and summary (og:title, og:description).
// Vercel keeps the answer for one hour, so the site is read at most about once an hour.
// If nothing can be read, the page keeps the last articles saved in Supabase.
// NEWS_RSS_URL (optional) points to an RSS feed to use instead.

const HOME = "https://www.nachrichtenleicht.de/";
const MAX = 6;
const UA = { "user-agent": "Mozilla/5.0 (compatible; groupe-allemand/1.0)" };
// Links on the home page that are not news articles.
const NOT_NEWS = /(impressum|datenschutz|kontakt|ueber-uns|podcast|woerterbuch|barrierefreiheit|hilfe|leichte-sprache|einfache-sprache|nutzungsbedingungen)/i;

const decode = s => (s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&([aou])uml;/gi, (_, c) => ({ a: "ä", o: "ö", u: "ü", A: "Ä", O: "Ö", U: "Ü" })[c]).replace(/&szlig;/g, "ß")
  .replace(/&bdquo;/g, "„").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”").replace(/&ndash;/g, "–")
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

const get = async url => {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(String(r.status));
  return r.text();
};

function meta(html, name) {
  for (const re of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, "i"),
  ]) { const m = html.match(re); if (m) return decode(m[1]); }
  return "";
}

function firstSentence(text) {
  const m = text.match(/^.{20,220}?[.!?](\s|$)/);
  return (m ? m[0] : text.slice(0, 200)).trim();
}

// Article links on the home page, in page order: /some-words-100.html
export function articleLinks(html) {
  const seen = new Set();
  for (const m of html.matchAll(/href=["'](?:https?:\/\/www\.nachrichtenleicht\.de)?\/([a-z0-9][a-z0-9-]*-\d{3})\.html["']/gi)) {
    const slug = m[1].toLowerCase();
    if (NOT_NEWS.test(slug)) continue;
    seen.add(HOME + slug + ".html");
  }
  return [...seen];
}

export function parseArticle(html, url) {
  const type = meta(html, "og:type");
  if (type && !/article/i.test(type)) return null; // a section page, not a news article
  // The h1 is the plain headline; og:title starts with a topic word ("Leichtathletin - ...").
  const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  const t = h1 || meta(html, "og:title").replace(/^[^-–]{2,40}\s[-–]\s/, "") || decode((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]).replace(/\s*[|·-]\s*nachrichtenleicht.*$/i, "");
  const teaser = firstSentence(meta(html, "og:description") || meta(html, "description"));
  const at = Date.parse(meta(html, "article:published_time") || meta(html, "pub_date") || meta(html, "date") || "") || 0;
  return t ? { t, teaser, url, at } : null;
}

export function parseRss(xml) {
  const tag = (s, n) => { const m = s.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, "i")); return m ? decode(m[1]) : ""; };
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(m => ({
    t: tag(m[0], "title"), teaser: firstSentence(tag(m[0], "description")), url: tag(m[0], "link") || tag(m[0], "guid"), at: Date.parse(tag(m[0], "pubDate")) || 0,
  })).filter(x => x.t && /^https?:\/\//.test(x.url)).slice(0, MAX);
}

async function fromHome() {
  const links = articleLinks(await get(HOME)).slice(0, MAX + 4);
  const pages = await Promise.allSettled(links.map(async u => parseArticle(await get(u), u)));
  return pages.map(p => p.status === "fulfilled" ? p.value : null).filter(Boolean).slice(0, MAX);
}

export default async function handler(req, res) {
  let items = [];
  if (process.env.NEWS_RSS_URL) { try { items = parseRss(await get(process.env.NEWS_RSS_URL)); } catch {} }
  if (!items.length) { try { items = await fromHome(); } catch {} }
  if (!items.length) {
    res.setHeader("Cache-Control", "public, s-maxage=300");
    return res.status(502).json({ error: "news" });
  }
  // updatedAt = newest article (or today), so the story only shows as new when there is something new.
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const updatedAt = Math.max(...items.map(x => x.at)) || day.getTime();
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({ items: items.map(({ at, ...x }) => x), source: "nachrichtenleicht.de", updatedAt });
}
