// Accepts the Supabase address as pasted (with /rest/v1/, a trailing slash, spaces, or the dashboard link)
// and returns the bare project URL, e.g. https://abcd.supabase.co
export function supabaseUrl() {
  const raw = (process.env.SUPABASE_URL || "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return "";
  const dash = raw.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return `https://${dash[1]}.supabase.co`;
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw).origin; } catch { return raw; }
}
export const supabaseKey = () => (process.env.SUPABASE_ANON_KEY || "").trim().replace(/^["']|["']$/g, "");
