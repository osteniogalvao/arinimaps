import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { EspacoEscritorio, Membro } from "@/lib/crm-escritorio";

type Banco = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * Sessão do escritório. 401 sem login, 403 sem o recurso no plano, 503 se a
 * migration 0173 ainda não rodou. A trava de verdade é a policy do banco.
 */
export async function sessaoEscritorio(): Promise<
  | { status: 200; banco: Banco; userId: string; espaco: EspacoEscritorio; membros: Membro[] }
  | { status: 401 | 403 | 503 }
> {
  const banco = await supabaseServer();
  const { data: { user } } = await banco.auth.getUser();
  if (!user) return { status: 401 };
  const { data, error } = await banco.rpc("crm_esc_espaco");
  if (error) return { status: 503 };
  if (!data) return { status: 403 };
  const membros = await banco.rpc("crm_esc_membros");
  return { status: 200, banco, userId: user.id, espaco: data as EspacoEscritorio, membros: (membros.data ?? []) as Membro[] };
}
