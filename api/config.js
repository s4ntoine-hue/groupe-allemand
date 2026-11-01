import { supabaseUrl, supabaseKey } from "./_supabase.js";

// Gives the page the public Supabase settings stored in Vercel, and whether AI import is switched on.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabaseUrl: supabaseUrl(),
    supabaseAnonKey: supabaseKey(),
    importEnabled: !!(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY) && process.env.IMPORT_ENABLED !== "false",
  });
}
