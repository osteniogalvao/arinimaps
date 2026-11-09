import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, LineChart } from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { CabecalhoPagina, Conteudo, Vazio } from "@/components/ui/Pagina";
import { currentUser } from "@/lib/supabase/server";
import { catalogoCotacoes, historicoCotacao } from "@/lib/mercado/cotacoes";
import { type PeriodoId, PERIODOS, formatarDataHora } from "@/lib/mercado/formato";
import PainelMercado from "./PainelMercado";

/**
 * Cotações do agro (item 27 da segunda etapa): consulta por produto, praça e
 * período, com gráfico e comparativo histórico. Os valores vêm do banco
 * (job `coletar_cotacoes` do worker, migration 0056) com cache de 15 min —
 * nenhuma chamada a fonte externa no acesso do visitante.
 */
export const metadata: Metadata = {
  title: "Cotações do agro: boi gordo, milho, soja e frango",
  description:
    "Cotações atualizadas do boi gordo, milho, soja, frango, dólar e Ibovespa, com praças regionais, gráfico de evolução e comparativo de 7 dias a 1 ano. Fontes: CEPEA/ESALQ, Scot Consultoria e Notícias Agrícolas.",
  alternates: { canonical: "/mercado" },
  openGraph: {
    title: "Cotações do agro | Arini Imóveis Brasil",
    description: "Boi gordo, milho, soja, frango, dólar e Ibovespa: valor do dia, variação e histórico de até 1 ano.",
    type: "website",
    url: "/mercado",
  },
};

export default async function Mercado({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, user, catalogo] = await Promise.all([searchParams, currentUser(), catalogoCotacoes()]);
  const usuario = user
    ? { nome: user.nome || "Conta", papel: user.role === "admin_central" ? "Administrador" : "Usuário" }
    : null;

  const pedido = typeof sp.serie === "string" ? sp.serie : null;
  const selecionada =
    catalogo.find((c) => c.slug === pedido) ?? catalogo.find((c) => c.destaque) ?? catalogo[0] ?? null;
  const pontos = selecionada ? await historicoCotacao(selecionada.id) : [];
  const periodo = (PERIODOS.find((p) => p.id === sp.periodo)?.id ?? "30d") as PeriodoId;

  // a coleta mais recente entre todas as séries
  const ultima = catalogo.reduce<string | null>(
    (m, c) => (c.atualizado_em && (!m || c.atualizado_em > m) ? c.atualizado_em : m), null);

  return (
    <Moldura usuario={usuario} site>
      <CabecalhoPagina
        variante="faixa"
        compacta
        eyebrow="Mercado"
        titulo="Cotações do"
        destaque="agro"
        subtitulo={
          <>
            Boi gordo, milho, soja e frango, com praças de várias regiões, mais dólar e Ibovespa.
            {ultima && <> Última coleta em {formatarDataHora(ultima)}.</>}
          </>
        }
      />

      <Conteudo className="py-10 md:py-14">
        {selecionada ? (
          <PainelMercado catalogo={catalogo} selecionada={selecionada} pontos={pontos} periodoInicial={periodo} />
        ) : (
          <Vazio
            icone={LineChart}
            titulo="As cotações estão a caminho"
            texto="Estamos reunindo os valores do CEPEA/ESALQ e das praças regionais. Assim que a primeira coleta terminar, eles aparecem aqui com o histórico."
            acao={
              <Link href="/" className="lp-btn lp-btn-contorno">
                Voltar ao início <ArrowRight />
              </Link>
            }
          />
        )}

        <div className="mt-12 max-w-3xl space-y-2 text-sm leading-relaxed text-texto-2">
          <p>
            <strong className="text-texto-3">Sobre os dados.</strong> Os indicadores de boi gordo, milho, soja e frango são do
            {" "}<a href="https://www.cepea.org.br/" target="_blank" rel="noopener noreferrer" className="underline hover:text-verde">CEPEA/ESALQ-USP</a>
            {" "}(licença CC BY-NC 4.0); as praças regionais vêm da Scot Consultoria e de sindicatos e cooperativas, publicadas pelo
            {" "}<a href="https://www.noticiasagricolas.com.br/cotacoes" target="_blank" rel="noopener noreferrer" className="underline hover:text-verde">Notícias Agrícolas</a>;
            o dólar, da AwesomeAPI; o Ibovespa, da B3 via Yahoo Finance.
          </p>
          <p>
            Os valores são atualizados algumas vezes por dia e servem como referência de mercado. Não são oferta de compra ou
            venda, nem recomendação de investimento. Cada série mostra a fonte e o horário da última atualização.
          </p>
        </div>
      </Conteudo>
    </Moldura>
  );
}
