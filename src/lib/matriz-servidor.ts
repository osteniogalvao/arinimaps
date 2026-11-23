import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SETOR_IDS, type SetorId } from "@/lib/setores";
import { PRAZO_PADRAO, diasAtraso, type CargaSetor, type PrazoSetor } from "@/lib/matriz";

const ABERTAS = ["aberta", "andamento", "aguardando", "bloqueada"];

export type Gargalo = {
  id: string;
  codigo: string | null;
  titulo: string;
  setor: string;
  responsavel: string | null;
  responsavelNome: string | null;
  prazo: string | null;
  atraso: number;
  nivel: number;
  saltos: number;
  origem: string | null;
  regra: string | null;
};

export type FiltroGargalos = { setor: string; tipo: string };

/** Todos os prazos por setor (padrão de cada setor, sem as exceções por tipo). */
export async function lerPrazos(): Promise<{ linhas: PrazoSetor[]; pronto: boolean }> {
  const { data, error } = await supabaseAdmin().from("matriz_prazos")
    .select("setor, regra, prazo_dias, limite_dias, atencao, critico").order("setor").order("regra");
  if (error) return { linhas: [], pronto: false };
  return { linhas: (data ?? []) as PrazoSetor[], pronto: true };
}

/**
 * Dados da Matriz que vêm da 0162: vencidas por setor, fila de gargalos,
 * carga por setor e resumo da Ari. Sem a migration, devolve vazio e a Matriz
 * continua como antes.
 */
export async function dadosMatriz(setores: SetorId[], hoje: string, filtroBruto: FiltroGargalos) {
  const admin = supabaseAdmin();
  const filtro: FiltroGargalos = {
    setor: setores.includes(filtroBruto.setor as SetorId) ? filtroBruto.setor : "",
    tipo: ["manual", "encaminhada", "automatica", "saltos"].includes(filtroBruto.tipo) ? filtroBruto.tipo : "",
  };
  const doFiltro = filtro.setor ? [filtro.setor] : setores;

  const [prazos, vencidasQ, gargalosQ, cargaQ, resumoQ] = await Promise.all([
    lerPrazos(),
    admin.from("tasks").select("setor").in("status", ABERTAS).lt("prazo", hoje).in("setor", setores),
    (() => {
      let q = admin.from("tasks")
        .select("id, codigo, titulo, setor, responsavel, prazo, nivel_cobranca, saltos, origem, regra")
        .in("status", ABERTAS).in("setor", doFiltro);
      q = filtro.tipo === "saltos" ? q.gt("saltos", 2) : q.or(`prazo.lt.${hoje},saltos.gt.2`);
      if (filtro.tipo && filtro.tipo !== "saltos") q = q.eq("origem", filtro.tipo);
      return q.order("prazo", { ascending: true, nullsFirst: false }).limit(60);
    })(),
    admin.rpc("fn_matriz_carga"),
    admin.from("matriz_resumos").select("dia, setor, texto").order("dia", { ascending: false }).limit(SETOR_IDS.length + 1),
  ]);

  const vencidas = new Map<string, number>();
  for (const t of vencidasQ.data ?? []) vencidas.set(t.setor, (vencidas.get(t.setor) ?? 0) + 1);

  const porSetor = new Map(prazos.linhas.filter((p) => !p.regra).map((p) => [p.setor, p]));
  const prazo = (setor: string): PrazoSetor => porSetor.get(setor) ?? { setor, regra: "", ...PRAZO_PADRAO };

  const brutos = gargalosQ.error ? [] : gargalosQ.data ?? [];
  const ids = [...new Set(brutos.map((t) => t.responsavel).filter(Boolean))] as string[];
  const { data: pessoas } = ids.length
    ? await admin.from("profiles").select("user_id, nome").in("user_id", ids)
    : { data: [] as { user_id: string; nome: string | null }[] };
  const nome = new Map((pessoas ?? []).map((p) => [p.user_id, p.nome]));
  const gargalos: Gargalo[] = brutos.map((t) => ({
    id: t.id, codigo: t.codigo, titulo: t.titulo, setor: t.setor, responsavel: t.responsavel,
    responsavelNome: t.responsavel ? nome.get(t.responsavel) ?? null : null,
    prazo: t.prazo, atraso: diasAtraso(t.prazo, hoje), nivel: t.nivel_cobranca ?? 0, saltos: t.saltos ?? 0,
    origem: t.origem, regra: t.regra,
  }))
    // mais crítico primeiro: nível, depois dias de atraso, depois saltos
    .sort((a, b) => b.nivel - a.nivel || b.atraso - a.atraso || b.saltos - a.saltos)
    .slice(0, 25);

  const carga = ((cargaQ.error ? [] : cargaQ.data ?? []) as CargaSetor[])
    .filter((c) => setores.includes(c.setor as SetorId));

  const resumos = resumoQ.error ? [] : resumoQ.data ?? [];
  const ultimoDia = resumos[0]?.dia;
  const doDia = resumos.filter((r) => r.dia === ultimoDia);
  const diretoria = setores.includes("diretoria");
  const geral = doDia.find((r) => r.setor === "");

  return {
    pronto: prazos.pronto && !gargalosQ.error,
    filtro,
    vencidas,
    prazo,
    gargalos,
    carga,
    resumo: geral && diretoria ? { dia: geral.dia as string, texto: geral.texto as string } : null,
    // a Diretoria lê o geral; cada setor lê o próprio resumo
    resumoSetores: (diretoria ? [] : doDia.filter((r) => r.setor && setores.includes(r.setor as SetorId)))
      .map((r) => ({ setor: r.setor as string, dia: r.dia as string, texto: r.texto as string })),
  };
}
