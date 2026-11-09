import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Moldura from "@/components/shell/Moldura";
import MiniMapa from "@/components/map/MiniMapa";
import SecaoFontesOficiais from "@/components/map/SecaoFontesOficiais";
import { CabecalhoPagina, Conteudo, PilulaPonto, Secao } from "@/components/ui/Pagina";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { carregarConsultaArea } from "@/lib/geo/consultaArea";
import { formatArea } from "@/lib/format";
import IndicadoresMunicipio from "@/components/rural/IndicadoresMunicipio";
import EnviarWhatsApp from "@/components/compartilhar/EnviarWhatsApp";
import BotaoExportarSig from "@/components/compartilhar/BotaoExportarSig";
import { OG_IMAGEM_PADRAO, OG_NOME_SITE } from "@/lib/compartilhar";

export const dynamic = "force-dynamic";
const chaveDe = (bruta: string) => (bruta.startsWith("geo:") ? bruta : `geo:${bruta}`);

/** Prévia do link (WhatsApp): tamanho e município da área. */
export async function generateMetadata({ params }: PageProps<"/consulta/area/[chave]">): Promise<Metadata> {
  const chave = chaveDe(decodeURIComponent((await params).chave));
  if (!/^geo:[0-9a-f]{40}$/.test(chave)) return { title: "Consulta de área desenhada" };
  const { data } = await supabaseAdmin().rpc("fn_area_consulta", { p_chave: chave });
  const area = data as { area_ha: number; municipio: string | null } | null;
  if (!area) return { title: "Consulta de área desenhada" };
  const tamanho = formatArea(Number(area.area_ha) * 10_000, Number(area.area_ha) >= 1 ? "rural" : "urbano");
  const titulo = `Consulta de área · ${tamanho}${area.municipio ? ` em ${area.municipio}` : ""}`;
  const descricao = "Área desenhada no mapa da Arini, com o cruzamento com CAR, mineração, terras indígenas, desmatamento e outras fontes oficiais.";
  return {
    title: titulo, description: descricao,
    openGraph: {
      type: "website", siteName: OG_NOME_SITE, locale: "pt_BR", url: `/consulta/area/${chave.slice(4)}`,
      title: titulo, description: descricao, images: [{ url: OG_IMAGEM_PADRAO, alt: titulo }],
    },
    twitter: { card: "summary_large_image" },
  };
}

type Area = {
  chave: string; area_ha: number; created_at: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  lng: number; lat: number; municipio: string | null;
};

/**
 * Consulta de uma área desenhada no mapa, em qualquer ponto do Brasil
 * (roadmap 5.6). A área chega aqui já registrada por POST /api/consulta/area;
 * a chave (`geo:<sha1>`) é a própria geometria — o link pode ser guardado e
 * reaberto, e quem desenhar a mesma área cai no mesmo resultado.
 */
export default async function ConsultaAreaDesenhada({ params }: PageProps<"/consulta/area/[chave]">) {
  const bruta = decodeURIComponent((await params).chave);
  const chave = chaveDe(bruta);
  if (!/^geo:[0-9a-f]{40}$/.test(chave)) notFound();
  const [{ data: areaRaw }, consulta] = await Promise.all([
    supabaseAdmin().rpc("fn_area_consulta", { p_chave: chave }),
    carregarConsultaArea(chave),
  ]);
  const area = areaRaw as Area | null;
  if (!area?.geometry) notFound();

  const tamanho = formatArea(Number(area.area_ha) * 10_000, Number(area.area_ha) >= 1 ? "rural" : "urbano");
  const municipio = area.municipio ?? "fora da região cadastrada";
  const centro = `${area.lat.toFixed(5)}, ${area.lng.toFixed(5)}`;
  const desenhadaEm = new Date(area.created_at).toLocaleDateString("pt-BR");
  const dados: [string, string][] = [
    ["Área desenhada", tamanho],
    ["Município", municipio],
    ["Ponto central", centro],
    ["Desenhada em", desenhadaEm],
  ];

  return (
    <Moldura usuario={consulta.usuario}>
      <CabecalhoPagina
        variante="faixa"
        eyebrow="01 · Consulta territorial"
        titulo={tamanho}
        destaque={area.municipio ? `em ${area.municipio}` : undefined}
        subtitulo="Área desenhada no mapa · consulta de área"
      >
        <PilulaPonto>Área aproximada</PilulaPonto>
      </CabecalhoPagina>

      <Conteudo className="py-12 md:py-16 space-y-12 md:space-y-16">
        <Secao eyebrow="02 · Divisa no mapa" titulo="Dados da área">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <MiniMapa geometry={area.geometry} status="publicado"
            className="h-80 lg:h-full lg:min-h-80 w-full rounded-[20px] overflow-hidden border border-linha" />
          <div className="cartao p-6 space-y-5">
            <p className="lp-display text-5xl leading-none text-verde">{tamanho}</p>
            <dl className="divide-y divide-linha border-y border-linha">
              {dados.map(([r, v]) => (
                <div key={r} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="shrink-0 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">{r}</dt>
                  <dd className="text-right text-[0.95rem] font-semibold text-texto">{v}</dd>
                </div>
              ))}
            </dl>
            {/* itens 6 e 8: enviar o link e exportar a área para SIG */}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <EnviarWhatsApp caminho={`/consulta/area/${chave.slice(4)}`} titulo={`Consulta de área · ${tamanho}`}
                texto={`Consulta de área no mapa da Arini: ${tamanho}${area.municipio ? ` em ${area.municipio}` : ""}.`}
                aviso="Quem receber vê a área e os dados dela. O cruzamento com as fontes oficiais pede uma conta na Arini." />
              <BotaoExportarSig nomeBase={`area-${tamanho.replace(/\s+/g, "")}-${chave.slice(4, 12)}`}
                divisa={{
                  geometry: area.geometry, rotulo: "Área desenhada",
                  atributos: { chave: chave.slice(4), area_ha: Number(area.area_ha), municipio: area.municipio, fonte: "Área desenhada no mapa da Arini" },
                }} />
            </div>
            <p className="text-xs text-texto-2 leading-relaxed border-t border-linha pt-4">
              A área foi desenhada à mão sobre o satélite: é aproximada. Para uma análise do imóvel, use a divisa
              do CAR ou da matrícula.
            </p>
          </div>
        </div>
        </Secao>

        <IndicadoresMunicipio ponto={{ lng: area.lng, lat: area.lat }} />

        <SecaoFontesOficiais
          url="/api/consulta/area"
          corpo={{ chave }}
          descricao="Cruzamento da área desenhada (com 2 km ao redor) com CAR, mineração, terras indígenas, desmatamento, queimadas, unidades de conservação, água e energia. Vale para qualquer ponto do Brasil."
          logado={!!consulta.user} podeConsultar={consulta.podeConsultar} acesso={consulta.acesso}
          cotaRestante={consulta.cotaRestante} lista={consulta.lista} pendentes={consulta.pendentes}
          jaConsultou={consulta.jaConsultou} />
      </Conteudo>
    </Moldura>
  );
}
