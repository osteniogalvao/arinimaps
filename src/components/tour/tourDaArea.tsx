import { bbox } from "@turf/turf";
import { notFound } from "next/navigation";
import { BotaoLink } from "@/components/ui/Pagina";
import { direitosDoTour } from "@/lib/map/acesso-tour";
import type { Acesso } from "@/lib/planos";
import Tour3D from "./Tour3D";

export async function tourDaArea(
  sessao: { user: { entradaAtiva: string | null } | null; acesso: Acesso },
  dados: { caminho: string; raio: number; abrir: boolean; geometria: GeoJSON.Geometry; titulo: string; area: string; car?: string },
) {
  const camadas = sessao.user && await direitosDoTour(sessao.acesso, sessao.user.entradaAtiva, false);
  if (!camadas || (dados.geometria.type !== "Polygon" && dados.geometria.type !== "MultiPolygon")) {
    if (dados.abrir) notFound();
    return null;
  }
  const voltar = dados.caminho + "?raio_m=" + dados.raio;
  if (!dados.abrir) return <BotaoLink href={voltar + "&tour=1"} variante="contorno">Tour 3D da área</BotaoLink>;
  const limites = bbox(dados.geometria) as [number, number, number, number];
  return <Tour3D titulo={dados.titulo} codigo="Consulta territorial" geometry={dados.geometria}
    centroid={{lng: (limites[0] + limites[2]) / 2, lat: (limites[1] + limites[3]) / 2}}
    areaLabel={dados.area} valor={null} tipo="consulta" municipio={null} pois={[]}
    camadas={camadas} consulta={{voltar, limites, car:dados.car}} />;
}
