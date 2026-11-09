import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerConfiguracoes, numero } from "@/lib/settings";
import { emailDoProfile, sendEmail } from "@/lib/notify";
import { formatBRL } from "@/lib/format";

/**
 * Demanda sem imóvel (roadmap 5.16 · Fluxograma §12): o cliente não gostou de
 * nenhum imóvel, a equipe registra o que ele procura, e quando um imóvel novo
 * é PUBLICADO o sistema confere as demandas abertas.
 *
 * Casamento (todas as condições):
 *  - tipo: igual, ou a demanda aceita qualquer (null);
 *  - município: na lista da demanda, ou lista vazia (qualquer);
 *  - valor e área: dentro da faixa, com a tolerância de `demandas_tolerancia_pct`
 *    (Configurações › Regras comerciais, padrão 10%) para cada lado. Imóvel sem
 *    valor ou sem área não é descartado por aquele critério ("sob consulta").
 *    Área na unidade do tipo: ha (rural) e m² (urbano); a faixa de área só é
 *    usada quando a demanda tem tipo definido.
 *
 * Cada casamento vira uma tarefa do setor Comercial (uma vez por par demanda ×
 * imóvel — `demanda_matches`) e um e-mail ao responsável da demanda.
 */

export type Demanda = {
  id: string; codigo: string; cliente_nome: string; cliente_contato: string | null;
  tipo: "rural" | "urbano" | null; municipios: string[];
  area_min: number | null; area_max: number | null; valor_min: number | null; valor_max: number | null;
  responsavel: string | null; opportunity_id: string | null; observacoes: string | null;
};

type Imovel = {
  id: string; codigo: string; titulo: string; tipo: "rural" | "urbano";
  municipality_id: string | null; valor: number | null; area_declarada: number | null;
};

function dentro(v: number | null, min: number | null, max: number | null, tol: number) {
  if (v == null) return true;
  if (min != null && v < Number(min) * (1 - tol)) return false;
  if (max != null && v > Number(max) * (1 + tol)) return false;
  return true;
}

/** A demanda aceita este imóvel? (função pura — usada também na tela) */
export function casa(d: Demanda, p: Imovel, tolerancia = 0.1): boolean {
  if (d.tipo && d.tipo !== p.tipo) return false;
  if (d.municipios?.length && (!p.municipality_id || !d.municipios.includes(p.municipality_id))) return false;
  if (!dentro(p.valor != null ? Number(p.valor) : null, d.valor_min, d.valor_max, tolerancia)) return false;
  if (d.tipo && !dentro(p.area_declarada != null ? Number(p.area_declarada) : null, d.area_min, d.area_max, tolerancia)) return false;
  return true;
}

/**
 * Confere as demandas abertas contra um imóvel recém-publicado. Fire-and-forget
 * a partir de /api/admin/decisao: nunca lança, devolve quantas casaram.
 */
export async function casarDemandas(propertyId: string): Promise<number> {
  try {
    const admin = supabaseAdmin();
    const { data: p } = await admin.from("properties")
      .select("id, codigo, titulo, tipo, municipality_id, valor, area_declarada").eq("id", propertyId).maybeSingle();
    if (!p) return 0;
    const { data: abertas } = await admin.from("demandas")
      .select("id, codigo, cliente_nome, cliente_contato, tipo, municipios, area_min, area_max, valor_min, valor_max, responsavel, opportunity_id, observacoes")
      .eq("status", "aberta");
    const cfg = await lerConfiguracoes();
    const tol = Math.max(0, numero(cfg, "demandas_tolerancia_pct", 10)) / 100;
    const casadas = ((abertas ?? []) as Demanda[]).filter((d) => casa(d, p as Imovel, tol));
    if (!casadas.length) return 0;

    const { data: jaFeitos } = await admin.from("demanda_matches").select("demanda_id")
      .eq("property_id", propertyId).in("demanda_id", casadas.map((d) => d.id));
    const feitos = new Set((jaFeitos ?? []).map((m) => m.demanda_id));
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const pendentes = casadas.filter((x) => !feitos.has(x.id));
    if (!pendentes.length) return 0;

    // Tudo em lote (antes eram 3 a 4 consultas por demanda casada).
    // 1) reserva os pares antes de criar as tarefas: o unique (demanda_id,
    //    property_id) + ignoreDuplicates faz duas publicações simultâneas não
    //    duplicarem — só voltam os pares que ESTE pedido criou.
    const { data: reservados, error: mErro } = await admin.from("demanda_matches")
      .upsert(pendentes.map((d) => ({ demanda_id: d.id, property_id: propertyId })),
        { onConflict: "demanda_id,property_id", ignoreDuplicates: true })
      .select("id, demanda_id");
    if (mErro || !reservados?.length) return 0;
    const matchPorDemanda = new Map(reservados.map((m) => [m.demanda_id as string, m.id as string]));
    const novas = pendentes.filter((d) => matchPorDemanda.has(d.id));

    // 2) uma tarefa por demanda, num insert só (o título leva o código da demanda, que é único)
    const tituloDe = (d: Demanda) => `Imóvel novo casa com demanda ${d.codigo}`;
    const { data: tarefas } = await admin.from("tasks").insert(novas.map((d) => ({
      titulo: tituloDe(d),
      descricao:
        `${p.codigo} — ${p.titulo} (${formatBRL(p.valor)}) foi publicado e atende à demanda de ${d.cliente_nome}` +
        `${d.cliente_contato ? ` (${d.cliente_contato})` : ""}.\n` +
        `Imóvel: ${site}/imovel/${p.codigo} · Demanda: ${site}/admin/demandas?d=${d.codigo}`,
      setor: "comercial", responsavel: d.responsavel, prioridade: "alta",
      property_id: propertyId, opportunity_id: d.opportunity_id,
    }))).select("id, titulo");
    const tarefaPorTitulo = new Map((tarefas ?? []).map((t) => [t.titulo as string, t.id as string]));

    // 3) liga cada par à sua tarefa, num upsert só
    const ligacoes = novas.filter((d) => tarefaPorTitulo.has(tituloDe(d))).map((d) => ({
      id: matchPorDemanda.get(d.id)!, demanda_id: d.id, property_id: propertyId, task_id: tarefaPorTitulo.get(tituloDe(d))!,
    }));
    if (ligacoes.length) await admin.from("demanda_matches").upsert(ligacoes, { onConflict: "id" });

    // 4) auditoria em lote (append-only; falha não derruba a publicação)
    const { error: aErro } = await admin.from("audit_log").insert(novas.map((d) => ({
      acao: "demanda_casou", entidade: "demandas", entidade_id: d.id, property_id: propertyId,
      dados_depois: { imovel: p.codigo, tarefa: tarefaPorTitulo.get(tituloDe(d)) ?? null },
    })));
    if (aErro) console.error("audit_log (demandas) falhou:", aErro.message);

    for (const d of novas) {
      if (d.responsavel) {
        emailDoProfile(d.responsavel).then((to) => sendEmail(to,
          `Demanda ${d.codigo}: imóvel novo pode interessar a ${d.cliente_nome}`,
          `O imóvel ${p.codigo} — ${p.titulo} (${formatBRL(p.valor)}) acabou de ser publicado e casa com a demanda ${d.codigo}.\n\n` +
          `Veja o imóvel: ${site}/imovel/${p.codigo}\nTarefa criada no setor Comercial: ${site}/admin/tarefas`,
        )).catch(() => undefined);
      }
    }
    return novas.length;
  } catch (e) {
    console.error("casarDemandas falhou:", e);
    return 0;
  }
}

/** Valida o corpo de criação/edição de demanda (rotas /api/demandas). */
export async function validarDemanda(b: Record<string, unknown>, parcial: boolean): Promise<{ erro: string } | { dados: Record<string, unknown> }> {
  const d: Record<string, unknown> = {};
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  if (!parcial || b.cliente_nome !== undefined) {
    const nome = String(b.cliente_nome ?? "").replace(/\s+/g, " ").trim();
    if (nome.length < 2) return { erro: "Informe o nome do cliente." };
    d.cliente_nome = nome.slice(0, 160);
  }
  if (b.cliente_contato !== undefined) d.cliente_contato = String(b.cliente_contato ?? "").trim().slice(0, 160) || null;
  if (b.tipo !== undefined) {
    const t = String(b.tipo ?? "");
    if (t && !["rural", "urbano"].includes(t)) return { erro: "Tipo inválido." };
    d.tipo = t || null;
  }
  if (b.municipios !== undefined) {
    const lista = Array.isArray(b.municipios) ? [...new Set(b.municipios.map(String))] : [];
    if (lista.length) {
      const { data } = await supabaseAdmin().from("municipalities").select("id").in("id", lista);
      if ((data ?? []).length !== lista.length) return { erro: "Município inválido na lista." };
    }
    d.municipios = lista;
  }
  for (const [de, ate, rotulo] of [["area_min", "area_max", "área"], ["valor_min", "valor_max", "valor"]] as const) {
    if (b[de] !== undefined) d[de] = num(b[de]);
    if (b[ate] !== undefined) d[ate] = num(b[ate]);
    if (Number.isNaN(d[de]) || Number.isNaN(d[ate])) return { erro: `Faixa de ${rotulo} inválida.` };
    if (d[de] != null && d[ate] != null && Number(d[de]) > Number(d[ate])) return { erro: `Na faixa de ${rotulo}, o mínimo passa do máximo.` };
  }
  if (b.observacoes !== undefined) d.observacoes = String(b.observacoes ?? "").trim().slice(0, 4000) || null;
  if (b.responsavel !== undefined) d.responsavel = b.responsavel ? String(b.responsavel) : null;
  return { dados: d };
}
