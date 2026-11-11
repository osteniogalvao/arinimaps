import Link from "next/link";
import { Trophy } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina, Vazio } from "@/components/ui/Pagina";
import { aba } from "@/components/admin/estilos";

type Linha = {
  property_id: string; codigo: string; titulo: string;
  visitantes: number; favoritos: number; compartilhamentos: number; interesses: number;
  leads: number; visitas: number; propostas: number; visitantes_antes: number;
  audiencia: number; oportunidade: number;
};

const PERIODOS = { dia: { dias: 1, rotulo: "Hoje" }, semana: { dias: 7, rotulo: "Semana" }, mes: { dias: 30, rotulo: "Mês" } } as const;
type Periodo = keyof typeof PERIODOS;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Por que o imóvel está no ranking, em uma linha. */
function motivoAudiencia(l: Linha) {
  const partes = [
    l.visitantes && plural(l.visitantes, "visitante", "visitantes"),
    l.favoritos && plural(l.favoritos, "favorito", "favoritos"),
    l.compartilhamentos && plural(l.compartilhamentos, "compartilhamento", "compartilhamentos"),
  ].filter(Boolean);
  const cresc = l.visitantes_antes > 0 ? Math.round(((l.visitantes - l.visitantes_antes) / l.visitantes_antes) * 100) : null;
  if (cresc !== null && cresc >= 20) partes.push(`+${cresc}% de visitas sobre o período anterior`);
  else if (cresc === null && l.visitantes >= 3) partes.push("interesse novo");
  return partes.join(" · ") || "movimento recente";
}
function motivoOportunidade(l: Linha) {
  return [
    l.leads && plural(l.leads, "lead", "leads"),
    l.visitas && plural(l.visitas, "visita", "visitas"),
    l.propostas && plural(l.propostas, "proposta", "propostas"),
    l.interesses && plural(l.interesses, "pedido de contato", "pedidos de contato"),
    l.favoritos && plural(l.favoritos, "favorito", "favoritos"),
  ].filter(Boolean).join(" · ") || "interesse recente";
}

/**
 * Ranking de imóveis (Central de CRMs, bloco 1): Top 10 do dia, da semana e do
 * mês, em audiência e em oportunidade comercial, com o motivo de cada posição.
 * Não conta acessos da equipe, conta cada visitante uma vez e só considera
 * imóveis à venda (fn_ranking_imoveis, migration 0065).
 */
export default async function Ranking({ searchParams }: PageProps<"/admin/ranking">) {
  await exigirSetor("marketing", "comercial", "diretoria");
  const sp = await searchParams;
  const periodo: Periodo = sp.periodo === "dia" || sp.periodo === "mes" ? sp.periodo : "semana";
  const { data, error } = await supabaseAdmin().rpc("fn_ranking_imoveis", { p_dias: PERIODOS[periodo].dias });
  const linhas = ((data ?? []) as Linha[]).map((l) => ({ ...l, audiencia: Number(l.audiencia), oportunidade: Number(l.oportunidade) }));
  const audiencia = linhas.filter((l) => l.audiencia > 0).sort((a, b) => b.audiencia - a.audiencia).slice(0, 10);
  const oportunidade = linhas.filter((l) => l.oportunidade > 0).sort((a, b) => b.oportunidade - a.oportunidade).slice(0, 10);

  return (
    <div className="max-w-6xl space-y-6">
      <CabecalhoPagina eyebrow="Marketing" titulo="Ranking de imóveis"
        subtitulo="Os 10 imóveis que mais chamam atenção e os 10 com mais chance de negócio. Acessos da equipe não contam, e cada visitante conta uma vez." />
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PERIODOS) as Periodo[]).map((p) => (
          <Link key={p} href={`/admin/ranking?periodo=${p}`} className={aba(periodo === p)}>Top 10 · {PERIODOS[p].rotulo}</Link>
        ))}
      </div>

      {error ? (
        <Vazio icone={Trophy} titulo="Falta atualizar o banco" texto="O ranking precisa da migration 0065 (Central operacional)." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Lista titulo="Audiência" ajuda="Visitantes, favoritos, compartilhamentos e crescimento." linhas={audiencia}
            valor={(l) => l.audiencia} motivo={motivoAudiencia} />
          <Lista titulo="Oportunidade comercial" ajuda="Leads, visitas, propostas e pedidos de contato." linhas={oportunidade}
            valor={(l) => l.oportunidade} motivo={motivoOportunidade} />
        </div>
      )}
    </div>
  );
}

function Lista({ titulo, ajuda, linhas, valor, motivo }: {
  titulo: string; ajuda: string; linhas: Linha[]; valor: (l: Linha) => number; motivo: (l: Linha) => string;
}) {
  return (
    <section className="cartao overflow-hidden">
      <div className="border-b border-linha px-5 py-4">
        <h2 className="lp-display text-xl text-texto">{titulo}</h2>
        <p className="text-xs text-texto-2">{ajuda}</p>
      </div>
      <ol className="divide-y divide-linha">
        {linhas.map((l, i) => (
          <li key={l.property_id} className="flex items-start gap-4 px-5 py-3.5">
            <span className={"lp-display w-7 shrink-0 text-xl tabular-nums " + (i < 3 ? "text-ouro" : "text-texto-2")}>{i + 1}</span>
            <span className="min-w-0 flex-1">
              <Link href={`/admin/imoveis/${l.property_id}`} className="font-medium text-texto hover:text-verde hover:underline underline-offset-4">
                {l.titulo || l.codigo}
              </Link>
              <span className="ml-2 font-mono text-xs text-texto-2">{l.codigo}</span>
              <span className="mt-0.5 block text-xs text-texto-2">{motivo(l)}</span>
            </span>
            <span className="text-xs tabular-nums text-texto-2" title="Pontuação">{Math.round(valor(l))} pts</span>
          </li>
        ))}
        {!linhas.length && <li className="px-5 py-10 text-center text-sm text-texto-2">Sem movimento neste período.</li>}
      </ol>
    </section>
  );
}
