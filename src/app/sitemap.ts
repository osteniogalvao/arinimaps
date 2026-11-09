import type { MetadataRoute } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Gerado a cada requisição (não no build): imóveis novos entram no sitemap
// sem redeploy, e o build não depende das envs do Supabase.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return [{ url: base, changeFrequency: "hourly", priority: 1 }];
  }
  const { data: imoveis } = await supabaseAdmin()
    .from("properties")
    .select("codigo, updated_at")
    .in("status", ["publicado", "em_negociacao"]);

  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/mapa`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/mercado`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/planos`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/relatorios`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/ajuda`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/expansao`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/termos`, changeFrequency: "monthly", priority: 0.2 },
    { url: `${base}/suporte`, changeFrequency: "monthly", priority: 0.2 },
    ...(imoveis ?? []).map((p) => ({
      url: `${base}/imovel/${p.codigo}`,
      lastModified: new Date(p.updated_at),
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
