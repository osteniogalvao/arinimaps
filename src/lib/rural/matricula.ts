import "server-only";
// pacotes modulares, não o @turf/turf inteiro: menos código no cold start do servidor
import { area } from "@turf/area";
import { bbox as envelope } from "@turf/bbox";
import { booleanIntersects } from "@turf/boolean-intersects";
import { feature, featureCollection } from "@turf/helpers";
import { intersect } from "@turf/intersect";
import { parcelasSigefComGeometria, type Bbox } from "./adaptadores";

/**
 * Matrícula do imóvel pelo SIGEF (pedido do Carlos, 20/10/2026): clicar no
 * imóvel e ver o NÚMERO da matrícula para pedir o espelho no cartório.
 *
 * O SIGEF (INCRA) traz `registro_matricula` em toda parcela certificada. Aqui
 * as parcelas da janela do imóvel são cruzadas com a divisa dele, e fica a que
 * cobre de verdade (sobreposição medida em área, não só "está perto"). Imóvel
 * sem certificação no SIGEF não tem matrícula por aqui — aí só por cartório.
 *
 * Licença: o serviço do INCRA declara "vedado o uso comercial" (FONTES.md);
 * o uso em relatório pago depende da liberação do jurídico.
 */
export type MatriculaEncontrada = {
  matricula: string;
  /** "48300" ou várias, quando a parcela soma matrículas: "40025, 39816" */
  matriculas: string[];
  nome: string;
  codigoIncra: string;
  parcela: string;
  situacao: string;
  publico: boolean;
  /** quanto da divisa do imóvel esta parcela cobre (0–100) */
  cobreDoImovel: number;
  /** quanto da parcela fica dentro do imóvel (0–100) */
  dentroDoImovel: number;
};

// cobertura mínima para contar como "a matrícula deste imóvel" (5% evita a
// parcela vizinha que só encosta pela divisa, com o erro de traçado do CAR)
const MINIMO_PCT = 5;
const TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { em: number; dados: MatriculaEncontrada[] }>();

function separar(m: string): string[] {
  return m.split(/[,;/]/).map((s) => s.trim()).filter(Boolean);
}

export async function matriculasDoImovel(
  chave: string,
  geometria: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): Promise<MatriculaEncontrada[]> {
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) return guardado.dados;

  const imovel = feature(geometria);
  const [xmin, ymin, xmax, ymax] = envelope(imovel);
  const janela: Bbox = { xmin, ymin, xmax, ymax, lng: (xmin + xmax) / 2, lat: (ymin + ymax) / 2 };
  const parcelas = await parcelasSigefComGeometria(janela);
  const areaImovel = area(imovel) || 1;

  const achadas: MatriculaEncontrada[] = [];
  for (const p of parcelas) {
    if (!p.matricula) continue;
    const parcela = feature(p.geometria);
    if (!booleanIntersects(imovel, parcela)) continue;
    let comum = 0;
    try {
      const inter = intersect(featureCollection([imovel, parcela]));
      comum = inter ? area(inter) : 0;
    } catch { comum = 0; }
    const cobre = (comum / areaImovel) * 100;
    const dentro = (comum / (area(parcela) || 1)) * 100;
    if (cobre < MINIMO_PCT && dentro < MINIMO_PCT) continue;
    achadas.push({
      matricula: p.matricula, matriculas: separar(p.matricula), nome: p.nome, codigoIncra: p.codigoIncra,
      parcela: p.parcela, situacao: p.situacao, publico: p.publico,
      cobreDoImovel: Math.round(cobre), dentroDoImovel: Math.round(dentro),
    });
  }
  achadas.sort((a, b) => b.cobreDoImovel - a.cobreDoImovel);
  cache.set(chave, { em: Date.now(), dados: achadas });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return achadas;
}
