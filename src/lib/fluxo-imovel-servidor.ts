import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Eventos do fluxo captação → Marketing → Diretoria, com o nome de quem fez. */
export async function eventosFluxo(propertyIds: string[]) {
  if (!propertyIds.length) return new Map<string, { id: string; acao: string; para_status: string | null; texto: string | null; autor_nome: string | null; created_at: string }[]>();
  const admin = supabaseAdmin();
  const { data } = await admin.from("imovel_fluxo_eventos").select("id, property_id, acao, para_status, texto, autor, created_at")
    .in("property_id", propertyIds).order("created_at", { ascending: false }).limit(500);
  const autores = [...new Set((data ?? []).map((e) => e.autor).filter(Boolean))] as string[];
  const { data: pessoas } = autores.length ? await admin.from("profiles").select("user_id, nome").in("user_id", autores) : { data: [] };
  const nome = new Map((pessoas ?? []).map((p) => [p.user_id as string, p.nome as string]));
  const mapa = new Map<string, { id: string; acao: string; para_status: string | null; texto: string | null; autor_nome: string | null; created_at: string }[]>();
  for (const e of data ?? []) {
    const l = mapa.get(e.property_id) ?? [];
    if (l.length < 12) l.push({ id: e.id, acao: e.acao, para_status: e.para_status, texto: e.texto, autor_nome: e.autor ? nome.get(e.autor) ?? null : null, created_at: e.created_at });
    mapa.set(e.property_id, l);
  }
  return mapa;
}
