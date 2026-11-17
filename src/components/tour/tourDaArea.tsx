import { bbox } from "@turf/turf";
import { notFound } from "next/navigation";
import { BotaoLink } from "@/components/ui/Pagina";
import RaioDaConsulta from "@/components/rural/RaioDaConsulta";
import { direitosDoTour } from "@/lib/map/acesso-tour";
import type { Acesso } from "@/lib/planos";
import Tour3D from "./Tour3D";

/**
 * Botão do Tour 3D da consulta, com o raio da pesquisa ao lado, ou o próprio
 * tour quando `abrir`. 17/11/2026 (vídeo do Carlos, 16h37): o Tour 3D fica no
 * dourado do "anunciar" para aparecer, e o raio fica à vista junto dele.
 */
export async function tourDaArea(
  sessao: { user: { entradaAtiva: string | null } | null; acesso: Acesso },
  dados: { caminho: string; raio: number; abrir: boolean; geometria: GeoJSON.Geometry; titulo: string; area: string; car?: string },
) {
  const camadas = sessao.user && await direitosDoTour(sessao.acesso, sessao.user.entradaAtiva, false);
  const raio = <RaioDaConsulta raioM={dados.raio} />;
  if (!camadas || (dados.geometria.type !== "Polygon" && dados.geometria.type !== "MultiPolygon")) {
    if (dados.abrir) notFound();
    return raio;
  }
  const voltar = dados.caminho + "?raio_m=" + dados.raio;
  if (!dados.abrir) return <div className="space-y-4">
    <BotaoLink href={voltar + "&tour=1"} variante="ouro">Tour 3D da área</BotaoLink>
    {raio}
  </div>;
  const limites = bbox(dados.geometria) as [number, number, number, number];
  return <Tour3D titulo={dados.titulo} codigo="Consulta territorial" geometry={dados.geometria}
    centroid={{lng: (limites[0] + limites[2]) / 2, lat: (limites[1] + limites[3]) / 2}}
    areaLabel={dados.area} valor={null} tipo="consulta" municipio={null} pois={[]}
    camadas={camadas} consulta={{voltar, limites, car:dados.car, raio: dados.raio, caminho: dados.caminho}} />;
}
