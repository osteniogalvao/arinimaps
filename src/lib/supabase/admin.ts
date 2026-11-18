import "server-only";
import { createClient } from "@supabase/supabase-js";
import { fetchComLimite } from "./fetchComLimite";

/** Client com service role — só em rotas de API / server. Bypassa RLS. */
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      // 30 s: folga para as rotinas pesadas, mas nunca pendura a página para sempre
      global: { fetch: fetchComLimite(30_000) },
    }
  );
}
