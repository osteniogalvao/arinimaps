import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, LineChart } from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { CabecalhoPagina, Conteudo, Vazio } from "@/components/ui/Pagina";
import { currentUser } from "@/lib/supabase/server";
import { lerConfiguracoes, texto } from "@/lib/settings";
import { numeroWhatsApp } from "@/lib/compartilhar";
import { catalogoCotacoes, historicoCotacao } from "@/lib/mercado/cotacoes";
import { type PeriodoId, PERIODOS, competenciaMensal, formatarDataHora, localDaSerie } from "@/lib/mercado/formato";
import { podeComparar, urlSerie } from "@/lib/mercado/pracas";
import PainelMercado from "./PainelMercado";
import ConsultaAgro from "./ConsultaAgro";

/**
 * Cotações do agro (item 27 da segunda etapa): consulta por produto, praça e
 * período, com gráfico e comparativo histórico. Os valores vêm do banco
 * (job `coletar_cotacoes` do worker, migration 0056) com cache de 15 min —
 * nenhuma chamada a fonte externa no acesso do visitante.
 */
type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { serie } = await searchParams;
  const atual = typeof serie === "string" ? (await catalogoCotacoes()).find((c) => c.slug === serie) : null;
  const titulo = atual ? `Cotação de ${[atual.nome, localDaSerie(atual)].filter(Boolean).join(" · ")}` : "Cotações do agro por produto e região";
  const descricao = atual
    ? `Histórico de ${atual.nome} em ${atual.unidade} segundo ${atual.fonte}. Consulte a evolução dos preços e compare praças.`
    : "Pesquise cotações por produto, estado ou região. Compare praças, consulte históricos de 7, 15 e 30 dias e calcule o valor bruto da sua produção.";
  const canonical = atual ? urlSerie(atual.slug) : "/mercado";
  return { title: titulo, description: descricao, alternates: { canonical }, openGraph: { title: titulo, description: descricao, type: "website", url: canonical } };
}

export default async function Mercado({ searchParams }: Props) {
  const [sp, user, catalogo, cfg] = await Promise.all([searchParams, currentUser(), catalogoCotacoes(), lerConfiguracoes()]);
  const telefone = numeroWhatsApp(texto(cfg, "whatsapp_central"));
  const usuario = user
    ? { nome: user.nome || "Conta", papel: user.role === "admin_central" ? "Administrador" : "Usuário" }
    : null;

  const pedido = typeof sp.serie === "string" ? sp.serie : null;
  const selecionada =
    catalogo.find((c) => c.slug === pedido) ?? catalogo.find((c) => c.destaque) ?? catalogo[0] ?? null;
  const comparada = selecionada && catalogo.find((c) => c.slug === sp.comparar && podeComparar(selecionada, c));
  const [pontos, pontosComparados] = await Promise.all([
    selecionada ? historicoCotacao(selecionada.id) : [],
    comparada ? historicoCotacao(comparada.id) : [],
  ]);
  const periodo = (PERIODOS.find((p) => p.id === sp.periodo)?.id ?? (selecionada && competenciaMensal(selecionada) ? "1a" : "30d")) as PeriodoId;

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
            Consulte preços por produto e praça, incluindo gado, grãos e insumos agrícolas.
            {ultima && <> Última coleta em {formatarDataHora(ultima)}.</>}
          </>
        }
      />

      <Conteudo className="py-10 md:py-14">
        {selecionada ? (
          <PainelMercado catalogo={catalogo} selecionada={selecionada} pontos={pontos} periodoInicial={periodo}
            comparada={comparada ?? null} pontosComparados={pontosComparados} />
        ) : (
          <Vazio
            icone={LineChart}
            titulo="As cotações estão a caminho"
            texto="Ainda não há fechamentos disponíveis para consulta. Você pode solicitar uma cotação à equipe."
            acao={
              <Link href="/" className="lp-btn lp-btn-contorno">
                Voltar ao início <ArrowRight />
              </Link>
            }
          />
        )}

        {telefone && <ConsultaAgro key={selecionada?.id} telefone={telefone} produto={selecionada?.produto}
          praca={selecionada && localDaSerie(selecionada)} />}

        <div className="mt-12 max-w-3xl space-y-2 text-sm leading-relaxed text-texto-2">
          <p>Para consultar outros produtos e insumos diretamente no levantamento público, acesse os{" "}
            <a href="https://www.gov.br/conab/pt-br/atuacao/informacoes-agropecuarias/precos-agropecuarios" target="_blank"
              rel="noopener noreferrer" className="underline hover:text-verde">preços agropecuários da Conab</a>.</p>
          <p>
            As séries de Santa Catarina usam os levantamentos regionais de preços ao produtor e as médias estaduais de insumos da
            {" "}<a href="https://cepa.epagri.sc.gov.br/index.php/mercado-agricola/" target="_blank" rel="noopener noreferrer" className="underline hover:text-verde">Epagri/Cepa</a>.
            {catalogo.some(c => c.slug.startsWith("cepea-")) && <> Os indicadores CEPEA são do{" "}
              <a href="https://www.cepea.org.br/" target="_blank" rel="noopener noreferrer" className="underline hover:text-verde">CEPEA/ESALQ-USP</a>.</>}
            {" "}As demais praças têm a fonte identificada junto de cada cotação.
            O dólar vem da AwesomeAPI e o Ibovespa, da B3 via Yahoo Finance.
          </p>
          <p>
            Cada preço mostra a data do levantamento ou o mês de referência indicado pela fonte. O horário da última coleta
            informa quando o sistema consultou os arquivos. Os valores servem como referência de mercado.
          </p>
        </div>
      </Conteudo>
    </Moldura>
  );
}
