import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MunicipioAtendido } from "./atendimento";

/** Municípios ativos de Central > Regiões: onde a Arini anuncia hoje. */
export async function listarMunicipiosAtendidos(): Promise<MunicipioAtendido[]> {
  const { data, error } = await supabaseAdmin()
    .from("municipalities").select("id, nome, uf, codigo_ibge").eq("ativo", true).order("nome");
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({ id: m.id, nome: m.nome, uf: m.uf, codigo_ibge: String(m.codigo_ibge) }));
}

/** Município atendido que contém o ponto, ou null (fora da área da Arini). */
export async function municipioAtendidoNoPonto(lng: number, lat: number, lista?: MunicipioAtendido[]): Promise<MunicipioAtendido | null> {
  const { data: id, error } = await supabaseAdmin().rpc("fn_municipality_for_point", { p_lng: lng, p_lat: lat });
  if (error) throw new Error(error.message);
  if (!id) return null;
  return (lista ?? await listarMunicipiosAtendidos()).find((m) => m.id === id) ?? null;
}
