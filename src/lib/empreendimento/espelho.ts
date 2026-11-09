import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator as atorAtual, temSetor, type Ator } from "@/lib/authz";
import {
  compararLote, type EventoEspelho, type OportunidadeLote, type StatusEspelho,
  type UnidadeEspelho, type UnidadePublica,
} from "./tipos";

/**
 * Espelho de vendas do loteamento (segunda etapa, item 10). Lê o empreendimento,
 * as unidades (properties com parent_property_id) e a situação comercial de cada
 * uma (property_espelho, migration 0061).
 *
 * Sem a migration 0061 aplicada, tudo aparece como "disponível" e as ações
 * ficam desligadas (`ativo: false`) — a página não cai.
 */

export type Empreendimento = {
  id: string;
  codigo: string;
  titulo: string;
  status: string;
  owner_id: string | null;
  partner_id: string | null;
  municipio: string | null;
};

const LIMITE_UNIDADES = 2000;

export async function lerEmpreendimento(id: string): Promise<Empreendimento | null> {
  const { data } = await supabaseAdmin().from("properties")
    .select("id, codigo, titulo, status, owner_id, partner_id, parent_property_id, municipality:municipalities!properties_municipality_id_fkey(nome)")
    .eq("id", id).maybeSingle();
  if (!data || data.parent_property_id) return null;
  return {
    id: data.id, codigo: data.codigo, titulo: data.titulo, status: data.status,
    owner_id: data.owner_id, partner_id: data.partner_id,
    municipio: (data.municipality as unknown as { nome: string } | null)?.nome ?? null,
  };
}

/** Dono/parceiro do empreendimento, ou a equipe no setor Comercial. */
export function podeGerirEmpreendimento(a: Ator | null, emp: Pick<Empreendimento, "owner_id" | "partner_id">) {
  if (!a) return false;
  if (a.ehArini) return temSetor(a, "comercial");
  return (!!a.ownerId && emp.owner_id === a.ownerId) || (!!a.partnerId && emp.partner_id === a.partnerId);
}

type LinhaUnidade = {
  id: string; codigo: string; titulo: string; status: string; valor: number | null;
  area_declarada: number | null; lote_quadra: string | null; lote_numero: string | null; lote_area_m2: number | null;
};

async function lerUnidades(empId: string): Promise<LinhaUnidade[]> {
  const { data } = await supabaseAdmin().from("properties")
    .select("id, codigo, titulo, status, valor, area_declarada, lote_quadra, lote_numero, lote_area_m2")
    .eq("parent_property_id", empId)
    .not("status", "in", "(reprovado,inativo)")
    .limit(LIMITE_UNIDADES);
  return ((data ?? []) as LinhaUnidade[]).sort((a, b) =>
    compararLote({ quadra: a.lote_quadra, numero: a.lote_numero }, { quadra: b.lote_quadra, numero: b.lote_numero }));
}

/** Divisas das unidades. Sem a função da 0061, busca uma a uma (até 300). */
async function lerGeometrias(empId: string, ids: string[]): Promise<GeoJSON.FeatureCollection> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc("fn_espelho_geometrias", { p_empreendimento_id: empId });
  if (!error && data) return data as GeoJSON.FeatureCollection;
  const features: GeoJSON.Feature[] = [];
  const alvo = ids.slice(0, 300);
  for (let i = 0; i < alvo.length; i += 25) {
    const lote = await Promise.all(alvo.slice(i, i + 25).map(async (id) => {
      const { data: g } = await admin.rpc("fn_property_admin_geometry", { p_property_id: id });
      return g ? { type: "Feature" as const, geometry: g as GeoJSON.Geometry, properties: { id } } : null;
    }));
    for (const f of lote) if (f) features.push(f);
  }
  return { type: "FeatureCollection", features };
}

type LinhaEspelho = {
  property_id: string; status: StatusEspelho; reserva_ate: string | null; cliente_nome: string | null;
  opportunity_id: string | null; valor_venda: number | null; observacao: string | null;
  alterado_por: string | null; alterado_em: string;
};

/** Situação comercial gravada; null = migration 0061 ainda não aplicada. */
async function lerSituacao(empId: string, liberarVencidas: boolean) {
  const admin = supabaseAdmin();
  // reserva vencida volta a disponível (com evento de sistema) antes de ler
  if (liberarVencidas) await admin.rpc("fn_espelho_liberar_vencidas", { p_empreendimento_id: empId }).then(() => null, () => null);
  const { data, error } = await admin.from("property_espelho")
    .select("property_id, status, reserva_ate, cliente_nome, opportunity_id, valor_venda, observacao, alterado_por, alterado_em")
    .eq("empreendimento_id", empId).limit(LIMITE_UNIDADES);
  if (error) return null;
  return new Map(((data ?? []) as LinhaEspelho[]).map((l) => [l.property_id, l]));
}

/** Status efetivo: a gravação vale; reserva vencida conta como disponível mesmo antes do job. */
function statusEfetivo(u: LinhaUnidade, e: LinhaEspelho | undefined, agora: number): StatusEspelho {
  if (e) {
    if (e.status === "reservado" && e.reserva_ate && new Date(e.reserva_ate).getTime() < agora) return "disponivel";
    return e.status;
  }
  return ["vendido", "historico"].includes(u.status) ? "vendido" : "disponivel";
}

/**
 * Espelho para quem gere o empreendimento. O nome do comprador (lead) só vai
 * para a equipe Arini e para o anunciante que conduz a própria oportunidade;
 * nos outros casos sai "Interessado N", como no acompanhamento do proprietário
 * (src/lib/acompanhamento/servidor.ts).
 */
export async function carregarEspelhoGestao(emp: Empreendimento, quem?: Ator | null) {
  const a = quem === undefined ? await atorAtual() : quem;
  const admin = supabaseAdmin();
  const unidades = await lerUnidades(emp.id);
  const ids = unidades.map((u) => u.id);
  const [situacao, geometrias, { data: opps }, { data: eventos }] = await Promise.all([
    lerSituacao(emp.id, true),
    lerGeometrias(emp.id, ids),
    ids.length
      ? admin.from("opportunities").select("id, codigo, etapa, property_id, created_at, responsavel_tipo, responsavel_partner_id, lead:leads(nome)")
        .in("property_id", ids).order("created_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as never[] }),
    admin.from("property_espelho_eventos")
      .select("id, property_id, de, para, motivo, cliente_nome, reserva_ate, autor, created_at")
      .eq("empreendimento_id", emp.id).order("created_at", { ascending: false }).limit(400)
      .then((r) => r, () => ({ data: null })),
  ]);

  // nomes de quem mudou (eventos e última alteração)
  const autores = new Set<string>();
  for (const e of situacao?.values() ?? []) if (e.alterado_por) autores.add(e.alterado_por);
  for (const e of (eventos ?? []) as { autor: string | null }[]) if (e.autor) autores.add(e.autor);
  const nomes = new Map<string, string>();
  if (autores.size) {
    const { data: perfis } = await admin.from("profiles").select("user_id, nome").in("user_id", [...autores]);
    for (const p of perfis ?? []) nomes.set(p.user_id, p.nome || "Usuário");
  }

  type LinhaOpp = {
    id: string; codigo: string; etapa: string; property_id: string;
    responsavel_tipo: string | null; responsavel_partner_id: string | null; lead: unknown;
  };
  const veNome = (o: LinhaOpp) =>
    !!a && (a.ehArini ||
      (o.responsavel_tipo === "proprietario" && !!a.ownerId && emp.owner_id === a.ownerId) ||
      (o.responsavel_tipo === "parceiro" && !!a.partnerId && o.responsavel_partner_id === a.partnerId));
  // opps vêm da mais nova para a mais antiga: numera por unidade a partir da mais antiga
  const porUnidade = new Map<string, LinhaOpp[]>();
  for (const o of (opps ?? []) as LinhaOpp[]) {
    const lista = porUnidade.get(o.property_id) ?? [];
    lista.push(o);
    porUnidade.set(o.property_id, lista);
  }
  const oppsPorUnidade = new Map<string, OportunidadeLote[]>();
  for (const [unidade, lista] of porUnidade) {
    oppsPorUnidade.set(unidade, lista.map((o, i) => ({
      id: o.id, codigo: o.codigo, etapa: o.etapa,
      cliente: veNome(o) ? (o.lead as { nome: string } | null)?.nome ?? null : `Interessado ${lista.length - i}`,
    })));
  }
  const eventosPorUnidade = new Map<string, EventoEspelho[]>();
  for (const e of (eventos ?? []) as (Omit<EventoEspelho, "autor"> & { property_id: string; autor: string | null })[]) {
    const lista = eventosPorUnidade.get(e.property_id) ?? [];
    if (lista.length < 8) lista.push({ ...e, autor: e.autor ? nomes.get(e.autor) ?? "Usuário" : null });
    eventosPorUnidade.set(e.property_id, lista);
  }

  const agora = Date.now();
  const lista: UnidadeEspelho[] = unidades.map((u) => {
    const e = situacao?.get(u.id);
    const status = statusEfetivo(u, e, agora);
    const vale = status === e?.status;
    return {
      id: u.id, codigo: u.codigo, titulo: u.titulo, quadra: u.lote_quadra, numero: u.lote_numero,
      area_m2: u.lote_area_m2 ?? u.area_declarada, valor: u.valor, status_anuncio: u.status, status,
      reserva_ate: vale && status === "reservado" ? e?.reserva_ate ?? null : null,
      cliente_nome: vale && status !== "disponivel" ? e?.cliente_nome ?? null : null,
      valor_venda: vale && status === "vendido" ? e?.valor_venda ?? null : null,
      observacao: vale ? e?.observacao ?? null : null,
      opportunity_id: vale ? e?.opportunity_id ?? null : null,
      alterado_por: e?.alterado_por ? nomes.get(e.alterado_por) ?? "Usuário" : null,
      alterado_em: e?.alterado_em ?? null,
      oportunidades: oppsPorUnidade.get(u.id) ?? [],
      eventos: eventosPorUnidade.get(u.id) ?? [],
    };
  });
  return { unidades: lista, geometrias, ativo: situacao !== null };
}

/** Versão pública: só unidades publicadas, disponível/indisponível, sem nomes. */
export async function carregarEspelhoPublico(emp: Empreendimento) {
  const unidades = (await lerUnidades(emp.id)).filter((u) => ["publicado", "em_negociacao", "vendido"].includes(u.status));
  const ids = unidades.map((u) => u.id);
  const [situacao, geometrias] = await Promise.all([lerSituacao(emp.id, false), lerGeometrias(emp.id, ids)]);
  const agora = Date.now();
  const visiveis = new Set(ids);
  const lista: UnidadePublica[] = unidades.map((u) => ({
    id: u.id, codigo: u.codigo, titulo: u.titulo, quadra: u.lote_quadra, numero: u.lote_numero,
    area_m2: u.lote_area_m2 ?? u.area_declarada, valor: u.valor,
    disponivel: u.status !== "vendido" && statusEfetivo(u, situacao?.get(u.id), agora) === "disponivel",
  }));
  return {
    unidades: lista,
    geometrias: { ...geometrias, features: geometrias.features.filter((f) => visiveis.has(String(f.properties?.id))) },
  };
}

export type ResumoEmpreendimento = {
  id: string; codigo: string; titulo: string; status: string; municipio: string | null;
  unidades: number; reservado: number; vendido: number;
};

/**
 * Empreendimentos com unidades. `dono` limita aos do anunciante (painel);
 * sem `dono`, todos (Central). Contagens pela situação gravada no espelho.
 */
export async function listarEmpreendimentos(dono?: { ownerId: string | null; partnerId: string | null }): Promise<ResumoEmpreendimento[]> {
  const admin = supabaseAdmin();
  let paisIds: string[];
  if (dono) {
    const filtros = [dono.ownerId && `owner_id.eq.${dono.ownerId}`, dono.partnerId && `partner_id.eq.${dono.partnerId}`].filter(Boolean);
    if (!filtros.length) return [];
    const { data: meus } = await admin.from("properties").select("id").is("parent_property_id", null).or(filtros.join(",")).limit(1000);
    paisIds = (meus ?? []).map((p) => p.id);
    if (!paisIds.length) return [];
  } else {
    paisIds = [];
  }
  let q = admin.from("properties").select("parent_property_id").not("parent_property_id", "is", null)
    .not("status", "in", "(reprovado,inativo)").limit(20000);
  if (dono) q = q.in("parent_property_id", paisIds);
  const { data: filhos } = await q;
  const contagem = new Map<string, number>();
  for (const f of filhos ?? []) contagem.set(f.parent_property_id as string, (contagem.get(f.parent_property_id as string) ?? 0) + 1);
  const ids = [...contagem.keys()].slice(0, 500);
  if (!ids.length) return [];
  const [{ data: pais }, { data: espelho }] = await Promise.all([
    admin.from("properties").select("id, codigo, titulo, status, municipality:municipalities!properties_municipality_id_fkey(nome)").in("id", ids),
    admin.from("property_espelho").select("empreendimento_id, status, reserva_ate").in("empreendimento_id", ids).neq("status", "disponivel").limit(20000)
      .then((r) => r, () => ({ data: null })),
  ]);
  const agora = Date.now();
  const sit = new Map<string, { reservado: number; vendido: number }>();
  for (const e of (espelho ?? []) as { empreendimento_id: string; status: string; reserva_ate: string | null }[]) {
    const s = sit.get(e.empreendimento_id) ?? { reservado: 0, vendido: 0 };
    if (e.status === "vendido") s.vendido++;
    else if (e.status === "reservado" && (!e.reserva_ate || new Date(e.reserva_ate).getTime() >= agora)) s.reservado++;
    sit.set(e.empreendimento_id, s);
  }
  return (pais ?? []).map((p) => ({
    id: p.id, codigo: p.codigo, titulo: p.titulo, status: p.status,
    municipio: (p.municipality as unknown as { nome: string } | null)?.nome ?? null,
    unidades: contagem.get(p.id) ?? 0, reservado: sit.get(p.id)?.reservado ?? 0, vendido: sit.get(p.id)?.vendido ?? 0,
  })).sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
}

/** Nome da loteadora/anunciante para a proposta: razão social, organização ou nome da conta. */
export async function nomeAnunciante(ownerId: string | null, partnerId: string | null): Promise<string | null> {
  const admin = supabaseAdmin();
  let perfil: string | null = null;
  if (partnerId) {
    const { data } = await admin.from("partners").select("razao_social, profile_id").eq("id", partnerId).maybeSingle();
    if (data?.razao_social?.trim()) return data.razao_social.trim();
    perfil = data?.profile_id ?? null;
  } else if (ownerId) {
    const { data } = await admin.from("owners").select("profile_id").eq("id", ownerId).maybeSingle();
    perfil = data?.profile_id ?? null;
  }
  if (!perfil) return null;
  const [{ data: membro }, { data: prof }] = await Promise.all([
    admin.from("organization_members").select("org:organizations(nome)").eq("user_id", perfil).eq("status", "ativo").maybeSingle()
      .then((r) => r, () => ({ data: null })),
    admin.from("profiles").select("nome").eq("user_id", perfil).maybeSingle(),
  ]);
  return (membro?.org as unknown as { nome: string } | null)?.nome ?? prof?.nome ?? null;
}
