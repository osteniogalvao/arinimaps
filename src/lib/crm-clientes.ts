import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { chaveCliente } from "@/lib/crm-comercial";

export type OppCliente = {
  id: string; codigo: string; etapa: string; created_at: string; updated_at: string;
  responsavel_user_id: string | null; temperatura: string | null; etiquetas: string[]; ultimo_contato_em: string | null;
  lead: { nome: string; telefone: string | null; email: string | null; origem: string } | null;
  property: { id: string; codigo: string; titulo: string; valor: number | null } | null;
};

export type Cliente = {
  chave: string; nome: string; telefone: string | null; email: string | null;
  oportunidades: OppCliente[]; abertas: number; ganhas: number; ultimo: string; responsavel: string | null;
  temperatura: string | null; etiquetas: string[];
};

/**
 * Carteira de clientes: as oportunidades agrupadas pela pessoa (mesmo telefone
 * ou mesmo e-mail). Não há tabela de clientes: o lead já é o cadastro, e assim
 * o cliente que volta pelo site cai na mesma ficha.
 */
export async function carteira(limite = 3000): Promise<{ clientes: Cliente[]; semCrm: boolean }> {
  const admin = supabaseAdmin();
  const base = "id, codigo, etapa, created_at, updated_at, lead:leads(nome, telefone, email, origem), property:properties(id, codigo, titulo, valor)";
  let r = await admin.from("oportunidades_oficiais")
    .select(`${base}, responsavel_user_id, temperatura, etiquetas, ultimo_contato_em`)
    .order("created_at", { ascending: false }).limit(limite);
  const semCrm = !!r.error;
  if (r.error) r = await admin.from("oportunidades_oficiais").select(base).order("created_at", { ascending: false }).limit(limite) as typeof r;
  const mapa = new Map<string, Cliente>();
  for (const bruto of r.data ?? []) {
    const padrao = { responsavel_user_id: null, temperatura: null, etiquetas: [], ultimo_contato_em: null };
    const o = Object.assign(padrao, bruto) as unknown as OppCliente;
    const chave = chaveCliente(o.lead?.telefone, o.lead?.email) ?? `o${o.id}`;
    const c = mapa.get(chave) ?? {
      chave, nome: o.lead?.nome ?? "—", telefone: o.lead?.telefone ?? null, email: o.lead?.email ?? null,
      oportunidades: [], abertas: 0, ganhas: 0, ultimo: o.created_at, responsavel: null, temperatura: null, etiquetas: [],
    };
    c.oportunidades.push(o);
    if (!["fechado", "pos_venda", "perdido"].includes(o.etapa)) c.abertas++;
    if (["fechado", "pos_venda"].includes(o.etapa)) c.ganhas++;
    const ult = o.ultimo_contato_em && o.ultimo_contato_em > o.updated_at ? o.ultimo_contato_em : o.updated_at;
    if (ult > c.ultimo) c.ultimo = ult;
    // dados da oportunidade mais recente valem para a ficha
    if (c.oportunidades.length === 1) { c.responsavel = o.responsavel_user_id; c.temperatura = o.temperatura; }
    if (!c.email && o.lead?.email) c.email = o.lead.email;
    if (!c.telefone && o.lead?.telefone) c.telefone = o.lead.telefone;
    for (const t of o.etiquetas ?? []) if (!c.etiquetas.includes(t)) c.etiquetas.push(t);
    mapa.set(chave, c);
  }
  return { clientes: [...mapa.values()].sort((a, b) => b.ultimo.localeCompare(a.ultimo)), semCrm };
}
