import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Moldura from "@/components/shell/Moldura";
import MiniMapa from "@/components/map/MiniMapa";
import SecaoFontesOficiais from "@/components/map/SecaoFontesOficiais";
import { BotaoLink, CabecalhoPagina, Conteudo, PilulaPonto, Secao } from "@/components/ui/Pagina";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { carregarConsultaArea } from "@/lib/geo/consultaArea";
import { formatArea } from "@/lib/format";
import MatriculaSigef from "@/components/rural/MatriculaSigef";
import IndicadoresMunicipio from "@/components/rural/IndicadoresMunicipio";
import EnviarWhatsApp from "@/components/compartilhar/EnviarWhatsApp";
import BotaoExportarSig from "@/components/compartilhar/BotaoExportarSig";
import { OG_IMAGEM_PADRAO, OG_NOME_SITE } from "@/lib/compartilhar";

export const dynamic = "force-dynamic";
/** Prévia do link (WhatsApp): área e município do CAR. Só lê as propriedades, sem a divisa. */
export async function generateMetadata({ params }: PageProps<"/consulta/car/[cod]">): Promise<Metadata> {
  const cod = decodeURIComponent((await params).cod);
  const { data } = await supabaseAdmin().rpc("fn_car_imovel", { p_cod: cod });
  const p = (data as Car | null)?.properties;
  if (!p) return { title: "Consulta de área rural" };
  const area = p.area_ha ? formatArea(Number(p.area_ha) * 10_000, "rural") : "Área rural";
  const titulo = `CAR · ${area}${p.municipio ? ` em ${p.municipio}` : ""}`;
  const descricao = `Cadastro Ambiental Rural ${p.cod}: dados do SICAR e cruzamento com as fontes oficiais, no mapa da Arini.`;
  return {
    title: titulo, description: descricao,
    openGraph: {
      type: "website", siteName: OG_NOME_SITE, locale: "pt_BR", url: `/consulta/car/${encodeURIComponent(p.cod)}`,
      title: titulo, description: descricao, images: [{ url: OG_IMAGEM_PADRAO, alt: titulo }],
    },
    twitter: { card: "summary_large_image" },
  };
}

const TIPO: Record<string, string> = { IRU: "Imóvel rural", AST: "Assentamento", PCT: "Povos e comunidades tradicionais" };
const STATUS: Record<string, string> = { AT: "Ativo", PE: "Pendente", SU: "Suspenso", CA: "Cancelado" };

type Car = {
  geometry: GeoJSON.Geometry;
  properties: {
    cod: string; area_ha: number | null; condicao: string | null; status: string | null; tipo: string | null;
    municipio: string | null; atualizado_sicar: string | null; importado_em: string | null;
  };
};

/**
 * "Consultar informações" de uma área do CAR: os dados do cadastro e o
 * cruzamento com as fontes oficiais. Os dados do CAR são públicos e aparecem
 * para qualquer visitante; o cruzamento exige conta e fica registrado.
 */
export default async function ConsultaCar({ params }: PageProps<"/consulta/car/[cod]">) {
  const cod = decodeURIComponent((await params).cod);
  const admin = supabaseAdmin();
  const [{ data: carRaw }, { data: anuncio }, consulta] = await Promise.all([
    admin.rpc("fn_car_imovel", { p_cod: cod }),
    admin.from("properties").select("codigo, titulo, status").eq("car_codigo", cod)
      .in("status", ["publicado", "em_negociacao"]).limit(1).maybeSingle(),
    // o próprio CAR fica fora da lista: ele já é o assunto da página
    carregarConsultaArea(`car:${cod}`, { excluir: ["car"] }),
  ]);
  const car = carRaw as Car | null;
  if (!car?.geometry) notFound();
  const p = car.properties;

  const area = p.area_ha ? formatArea(Number(p.area_ha) * 10_000, "rural") : "—";
  const situacao = STATUS[p.status ?? ""] ?? p.status ?? "—";
  const atualizado = p.atualizado_sicar ? new Date(p.atualizado_sicar).toLocaleDateString("pt-BR") : "—";
  const dados = [
    ["Área declarada", area],
    ["Município", p.municipio ?? "—"],
    ["Tipo", TIPO[p.tipo ?? ""] ?? p.tipo ?? "—"],
    ["Situação do cadastro", situacao],
    ["Análise do órgão", p.condicao ?? "—"],
    ["Atualizado no SICAR", atualizado],
  ];

  return (
    <Moldura usuario={consulta.usuario}>
      <CabecalhoPagina
        variante="faixa"
        eyebrow="01 · Consulta territorial"
        titulo={p.area_ha ? formatArea(Number(p.area_ha) * 10_000, "rural") : "Área rural"}
        destaque={p.municipio ? `em ${p.municipio}` : undefined}
        subtitulo="Cadastro Ambiental Rural · consulta de área"
        acoes={anuncio ? (
          <BotaoLink href={`/imovel/${anuncio.codigo}`}>Esta área está à venda — ver o anúncio</BotaoLink>
        ) : (
          <BotaoLink href={`/painel/novo?car=${encodeURIComponent(p.cod)}`} variante="ouro">Esta área é minha — anunciar</BotaoLink>
        )}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <PilulaPonto>{situacao}</PilulaPonto>
          <p className="text-xs text-texto-2 break-all">Código do CAR: <span className="font-mono">{p.cod}</span></p>
        </div>
      </CabecalhoPagina>

      <Conteudo className="py-12 md:py-16 space-y-12 md:space-y-16">
        <Secao eyebrow="02 · Cadastro no mapa" titulo="Dados do cadastro">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <MiniMapa geometry={car.geometry} status="publicado"
            className="h-80 lg:h-full lg:min-h-96 w-full rounded-[20px] overflow-hidden border border-linha" />
          <div className="cartao p-6 space-y-5">
            <p className="lp-display text-5xl leading-none text-verde">{area}</p>
            <dl className="divide-y divide-linha border-y border-linha">
              {dados.map(([r, v]) => (
                <div key={r} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="shrink-0 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">{r}</dt>
                  <dd className="text-right text-[0.95rem] font-semibold text-texto">{v}</dd>
                </div>
              ))}
            </dl>
            {/* itens 6 e 8: enviar o link e exportar a divisa do CAR para SIG */}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <EnviarWhatsApp caminho={`/consulta/car/${encodeURIComponent(p.cod)}`} titulo={`CAR ${p.cod}`}
                texto={`Área do CAR no mapa da Arini: ${area}${p.municipio ? ` em ${p.municipio}` : ""} (${p.cod}).`}
                aviso="Quem receber vê os dados públicos do CAR. O cruzamento com as fontes oficiais pede uma conta na Arini." />
              <BotaoExportarSig nomeBase={p.cod}
                divisa={{
                  geometry: car.geometry, rotulo: `CAR ${p.cod}`,
                  atributos: { cod_car: p.cod, area_ha: p.area_ha != null ? Number(p.area_ha) : null, municipio: p.municipio, situacao: situacao, fonte: "SICAR" },
                }} />
            </div>
            <div className="border-t border-linha pt-4"><MatriculaSigef cod={p.cod} /></div>
            <p className="text-xs text-texto-2 leading-relaxed border-t border-linha pt-4">
              Dados públicos do SICAR, copiados em{" "}
              {p.importado_em ? new Date(p.importado_em).toLocaleDateString("pt-BR") : "—"}. O CAR é
              autodeclarado: não comprova propriedade nem substitui a matrícula.
            </p>
          </div>
        </div>
        </Secao>

        {/* o código do CAR traz o município: UF-IBGE-... */}
        <IndicadoresMunicipio codIbge={Number(p.cod.match(/^[A-Z]{2}-(\d{7})-/)?.[1]) || null} />

        <SecaoFontesOficiais
          url={`/api/consulta/car/${encodeURIComponent(p.cod)}`}
          descricao="Cruzamento da área (com 2 km ao redor) com mineração, terras indígenas, desmatamento, queimadas, unidades de conservação, água e energia. Cada resultado mostra o órgão e a data."
          logado={!!consulta.user} podeConsultar={consulta.podeConsultar} acesso={consulta.acesso}
          cotaRestante={consulta.cotaRestante} lista={consulta.lista} pendentes={consulta.pendentes}
          jaConsultou={consulta.jaConsultou} />
      </Conteudo>
    </Moldura>
  );
}
