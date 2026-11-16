import { raioConsulta } from "@/lib/rural/raios";
import { tourDaArea } from "@/components/tour/tourDaArea";
import RelatorioPersonalizado from "@/components/rural/RelatorioPersonalizado";
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
import BotaoExportarSig from "@/components/compartilhar/BotaoExportarSig";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const chaveDe = (bruta: string) => (bruta.startsWith("geo:") ? bruta : `geo:${bruta}`);

export const metadata: Metadata = {
  title: "Minha área desenhada",
  robots: { index: false, follow: false },
};

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
export default async function ConsultaAreaDesenhada({ params, searchParams }: PageProps<"/consulta/area/[chave]">) {
  const raioM = raioConsulta((await searchParams).raio_m, 2000);
  if (raioM === null) notFound();
  const bruta = decodeURIComponent((await params).chave);
  const chave = chaveDe(bruta);
  if (!/^geo:[0-9a-f]{40}$/.test(chave)) notFound();
  const user = await currentUser();
  if (!user) notFound();
  const { data } = await supabaseAdmin().rpc("fn_ler_area_propria", { p_chave: chave, p_user: user.id });
  const area = data as Area | null;
  if (!area?.geometry) notFound();
  const consulta = await carregarConsultaArea(chave, { raioM });

  const tamanho = formatArea(Number(area.area_ha) * 10_000, Number(area.area_ha) >= 1 ? "rural" : "urbano");
  const abrir = (await searchParams).tour === "1";
  const tour = await tourDaArea(consulta, { abrir, geometria: area.geometry, caminho: "/consulta/area/" + chave.slice(4), raio: raioM, titulo: "Área desenhada", area: tamanho });
  if (abrir) return tour;
  const municipio = area.municipio ?? "fora da região cadastrada";
  const relatorio = "/api/consulta/area/" + chave.slice(4) + "/relatorio";
  const relatorioCompleto = consulta.acesso.recursos.has("relatorio_territorial");
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
            {tour}
            <dl className="divide-y divide-linha border-y border-linha">
              {dados.map(([r, v]) => (
                <div key={r} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="shrink-0 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">{r}</dt>
                  <dd className="text-right text-[0.95rem] font-semibold text-texto">{v}</dd>
                </div>
              ))}
            </dl>
            <div>
              <div className="mb-4 flex flex-wrap gap-4 text-sm font-semibold text-verde underline">
                <a href={relatorio + "?modelo=simples&raio_m=" + raioM}>Baixar PDF simples</a>
                {relatorioCompleto && <a href={relatorio + "?modelo=completo&raio_m=" + raioM}>Baixar PDF completo</a>}
              </div>
              <RelatorioPersonalizado caminho={relatorio} raioM={raioM} completo={relatorioCompleto} desenho />
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
          raioM={raioM} descricao="Consulte CAR, mineração, terras indígenas, desmatamento, queimadas, unidades de conservação, água e energia na área desenhada ou no entorno selecionado."
          logado={!!consulta.user} podeConsultar={consulta.podeConsultar} acesso={consulta.acesso}
          cotaRestante={consulta.cotaRestante} lista={consulta.lista} pendentes={consulta.pendentes}
          jaConsultou={consulta.jaConsultou} />
      </Conteudo>
    </Moldura>
  );
}
