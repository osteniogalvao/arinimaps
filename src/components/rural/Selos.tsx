/**
 * Selos de proveniência e saúde das fontes (PENDENCIAS 3.15 e 3.16).
 *
 * Sem estado nem efeito: servem tanto em tela de servidor (consulta de área,
 * /admin/fontes) quanto em componente de cliente (relatório do imóvel).
 */

export type Classificacao = "oficial" | "terceiro" | "derivado" | "usuario";
export type Situacao = "ok" | "instavel" | "sem_verificacao";

const CLASSIFICACAO: Record<Classificacao, { rotulo: string; dica: string; cor: string }> = {
  oficial: { rotulo: "oficial", dica: "Dado publicado pelo órgão responsável (ou republicado por outro órgão público).", cor: "bg-verde/12 text-verde border-verde/25" },
  terceiro: { rotulo: "terceiro", dica: "Base não governamental (ex.: OpenStreetMap, MapBiomas).", cor: "bg-ouro/14 text-ouro border-ouro/30" },
  derivado: { rotulo: "derivado", dica: "Cálculo da ARINI sobre outra base (área, distância, índice).", cor: "bg-superficie-2 text-texto-2 border-linha" },
  usuario: { rotulo: "informado pelo usuário", dica: "Declarado por quem cadastrou o imóvel; não conferido em base oficial.", cor: "bg-alerta/14 text-alerta border-alerta/30" },
};

export function SeloClassificacao({ valor }: { valor?: string | null }) {
  const c = CLASSIFICACAO[(valor as Classificacao) ?? "oficial"] ?? CLASSIFICACAO.oficial;
  return (
    <span title={c.dica} className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${c.cor}`}>
      {c.rotulo}
    </span>
  );
}

const SITUACAO: Record<Situacao, { rotulo: string; cor: string }> = {
  ok: { rotulo: "no ar", cor: "bg-verde/12 text-verde border-verde/25" },
  instavel: { rotulo: "fonte com instabilidade", cor: "bg-critico/12 text-critico border-critico/30" },
  sem_verificacao: { rotulo: "sem verificação", cor: "bg-superficie-2 text-texto-2 border-linha" },
};

export function SeloSituacao({ valor, soProblema = false }: { valor?: string | null; soProblema?: boolean }) {
  const s = SITUACAO[(valor as Situacao) ?? "sem_verificacao"] ?? SITUACAO.sem_verificacao;
  if (soProblema && valor !== "instavel") return null;
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${s.cor}`}>{s.rotulo}</span>;
}

/** Origem carimbada pelo adaptador em cada item (src/lib/rural/adaptadores.ts). */
export type OrigemItem = {
  orgao?: string; base?: string; tipo?: string;
  consultado_em?: string; atualizado_em?: string | null; versao?: string | null;
};

const dataHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
const data = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");

/**
 * Linha "Fonte: órgão · base · tipo · consultado em … · base atualizada em …".
 * Sem a origem do item (consulta gravada antes de 07/10/2026), cai para o que
 * a tabela de fontes sabe.
 */
export function LinhaOrigem({ origem, orgao, classificacao, consultadoEm, atualizacao }: {
  origem?: OrigemItem | null;
  orgao?: string;
  classificacao?: string | null;
  consultadoEm?: string | null;
  /** frequência de atualização declarada na ficha da fonte */
  atualizacao?: string | null;
}) {
  const partes = [
    origem?.orgao ?? orgao,
    origem?.base,
    consultadoEm || origem?.consultado_em ? `consultado em ${dataHora(consultadoEm ?? origem?.consultado_em)}` : "",
    origem?.atualizado_em ? `base atualizada em ${data(origem.atualizado_em)}` : "",
    origem?.versao ?? "",
    !origem?.atualizado_em && atualizacao ? `atualização da base: ${atualizacao}` : "",
  ].filter(Boolean);
  return (
    <p className="text-xs leading-relaxed text-texto-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="font-semibold text-texto-3">Fonte:</span>
      <SeloClassificacao valor={origem?.tipo ?? classificacao} />
      <span>{partes.join(" · ")}</span>
    </p>
  );
}
