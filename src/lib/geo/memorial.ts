/**
 * Memorial descritivo a partir de uma divisa (pedido 11/11: "gerar memorial
 * descritivo", como o Geomart). Sai um .doc que o Word e o LibreOffice abrem e
 * deixam editar (HTML com o cabeçalho do Office, sem dependência nova).
 *
 * O texto segue o modelo usual dos memoriais georreferenciados: vértices V1,
 * V2… no sentido horário a partir do mais ao norte, coordenadas UTM SIRGAS
 * 2000, azimutes e distâncias no plano UTM. Os confrontantes e o proprietário
 * ficam em branco para o responsável técnico preencher: a plataforma não sabe
 * quem são, e um memorial com vizinho errado é pior que um com lacuna.
 *
 * É um RASCUNHO técnico. O memorial que vai a cartório ou ao SIGEF é assinado
 * por profissional habilitado, com ART/TRT; o documento diz isso no rodapé.
 */

import { ordemMemorial, poligonosDe } from "./exportarSig";
import { epsgSirgas, fusoDaGeometria, geoParaUtm, meridianoCentral } from "./utm";

export type DadosMemorial = {
  /** nome ou código do imóvel (vai no título) */
  imovel: string;
  municipio?: string | null;
  uf?: string | null;
  matricula?: string | null;
  car?: string | null;
  /** de onde veio a divisa (ex.: "CAR (SICAR)", "área desenhada no mapa") */
  origem?: string | null;
};

export type Vertice = { id: string; e: number; n: number; lat: number; lng: number };
export type Segmento = { de: string; para: string; azimute: number; distancia: number };

export type Memorial = {
  vertices: Vertice[];
  segmentos: Segmento[];
  areaM2: number;
  perimetroM: number;
  fuso: number;
  sul: boolean;
  epsg: number;
  /** quantos polígonos a geometria tinha (o memorial descreve o maior) */
  poligonos: number;
  furos: number;
};

const br = (n: number, casas = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Azimute em graus decimais → 123°45'06". */
export function azimuteGms(az: number) {
  let total = Math.round(az * 3600);
  total = ((total % 1296000) + 1296000) % 1296000;
  const g = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return `${g}°${String(m).padStart(2, "0")}'${String(s).padStart(2, "0")}"`;
}

/** Área plana (UTM) de um anel aberto em metros. */
function areaPlana(pts: [number, number][]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Calcula vértices, azimutes, distâncias, área e perímetro do maior polígono da geometria. */
export function calcularMemorial(geometry: GeoJSON.Geometry): Memorial | null {
  const polis = poligonosDe(geometry);
  if (!polis.length) return null;
  const { fuso, sul } = fusoDaGeometria(polis.flatMap((p) => p.flat()));
  const utm = (p: GeoJSON.Position) => geoParaUtm(p[0], p[1], fuso, sul);
  const aberto = (anel: GeoJSON.Position[]) =>
    anel.length > 1 && anel[0][0] === anel.at(-1)![0] && anel[0][1] === anel.at(-1)![1] ? anel.slice(0, -1) : anel;

  // o maior polígono (pela área plana do anel externo)
  let melhor = polis[0], maior = -1;
  for (const p of polis) {
    const a = areaPlana(aberto(p[0]).map(utm));
    if (a > maior) { maior = a; melhor = p; }
  }
  const externo = aberto(melhor[0]);
  if (externo.length < 3) return null;

  const vertices: Vertice[] = ordemMemorial(externo).map((p, i) => {
    const [e, n] = utm(p);
    return { id: `V${i + 1}`, e, n, lng: p[0], lat: p[1] };
  });
  const segmentos: Segmento[] = vertices.map((v, i) => {
    const w = vertices[(i + 1) % vertices.length];
    const de = w.e - v.e, dn = w.n - v.n;
    const az = (Math.atan2(de, dn) * 180) / Math.PI;
    return { de: v.id, para: w.id, azimute: (az + 360) % 360, distancia: Math.hypot(de, dn) };
  });
  const furos = melhor.slice(1).map(aberto).filter((a) => a.length >= 3);
  const areaM2 = areaPlana(vertices.map((v) => [v.e, v.n])) - furos.reduce((s, f) => s + areaPlana(f.map(utm)), 0);
  return {
    vertices, segmentos, areaM2,
    perimetroM: segmentos.reduce((s, x) => s + x.distancia, 0),
    fuso, sul, epsg: epsgSirgas(fuso, sul), poligonos: polis.length, furos: furos.length,
  };
}

/** Texto corrido do perímetro ("Inicia-se a descrição…"). */
export function textoPerimetro(m: Memorial) {
  const v0 = m.vertices[0];
  const partes = [
    `Inicia-se a descrição deste perímetro no vértice ${v0.id}, de coordenadas N ${br(m.vertices[0].n)} m e E ${br(v0.e)} m;`,
  ];
  m.segmentos.forEach((s, i) => {
    const destino = m.vertices[(i + 1) % m.vertices.length];
    const fim = i === m.segmentos.length - 1;
    partes.push(
      `deste, segue confrontando com ____________________, com azimute de ${azimuteGms(s.azimute)} e distância de ${br(s.distancia)} m, ` +
      (fim
        ? `até o vértice ${destino.id}, ponto inicial da descrição deste perímetro.`
        : `até o vértice ${destino.id}, de coordenadas N ${br(destino.n)} m e E ${br(destino.e)} m;`),
    );
  });
  return partes.join(" ");
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Documento .doc (HTML para Word). */
export function memorialDoc(m: Memorial, d: DadosMemorial): string {
  const ha = m.areaM2 / 10000;
  const mc = Math.abs(meridianoCentral(m.fuso));
  const hoje = new Date().toLocaleDateString("pt-BR");
  const linha = (rotulo: string, valor: string | null | undefined) =>
    `<tr><td style="width:32%;font-weight:bold">${esc(rotulo)}</td><td>${esc(valor || "____________________")}</td></tr>`;
  const avisos: string[] = [];
  if (m.poligonos > 1) avisos.push(`A divisa tem ${m.poligonos} partes; este memorial descreve a maior delas.`);
  if (m.furos) avisos.push(`A área desconta ${m.furos} área(s) interna(s) excluída(s), que não estão descritas no perímetro.`);

  const tabela = m.segmentos.map((s, i) => {
    const v = m.vertices[i];
    return `<tr><td>${v.id}</td><td>${br(v.n)}</td><td>${br(v.e)}</td><td>${v.lat.toFixed(7)}</td><td>${v.lng.toFixed(7)}</td>` +
      `<td>${s.de}–${s.para}</td><td>${azimuteGms(s.azimute)}</td><td>${br(s.distancia)}</td><td>&nbsp;</td></tr>`;
  }).join("");

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Memorial descritivo - ${esc(d.imovel)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page { size: 21cm 29.7cm; margin: 2.5cm 2cm 2cm 2.5cm; }
body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.45; }
h1 { font-size: 15pt; text-align: center; margin: 0 0 14pt; }
h2 { font-size: 12pt; margin: 16pt 0 6pt; }
table { border-collapse: collapse; width: 100%; }
td, th { padding: 3pt 5pt; vertical-align: top; }
.grade td, .grade th { border: 1px solid #999; font-size: 9pt; text-align: center; }
.grade th { background: #E8EFE9; }
p.just { text-align: justify; }
.nota { font-size: 9pt; color: #555; }
</style></head>
<body>
<h1>MEMORIAL DESCRITIVO</h1>
<table>
${linha("Imóvel", d.imovel)}
${linha("Proprietário(s)", null)}
${linha("Município / UF", [d.municipio, d.uf].filter(Boolean).join(" / ") || null)}
${linha("Matrícula", d.matricula)}
${linha("Código do CAR", d.car)}
${linha("Área", `${br(ha, 4)} ha (${br(m.areaM2)} m²)`)}
${linha("Perímetro", `${br(m.perimetroM)} m`)}
${linha("Sistema de coordenadas", `SIRGAS 2000 / UTM fuso ${m.fuso}${m.sul ? "S" : "N"} (EPSG:${m.epsg}), MC ${mc}° ${meridianoCentral(m.fuso) < 0 ? "W" : "E"}`)}
${d.origem ? linha("Origem da divisa", d.origem) : ""}
</table>

<h2>Descrição do perímetro</h2>
<p class="just">${esc(textoPerimetro(m))}</p>
<p class="just">Todas as coordenadas aqui descritas estão georreferenciadas ao Sistema Geodésico Brasileiro, referenciadas ao Meridiano Central ${mc}° ${meridianoCentral(m.fuso) < 0 ? "WGr" : "EGr"}, tendo como datum o SIRGAS 2000, e encontram-se representadas no sistema UTM. Todos os azimutes e distâncias, a área e o perímetro foram calculados no plano de projeção UTM.</p>
${avisos.map((a) => `<p class="nota">${esc(a)}</p>`).join("")}

<h2>Tabela de vértices</h2>
<table class="grade">
<tr><th>Vértice</th><th>N (m)</th><th>E (m)</th><th>Latitude</th><th>Longitude</th><th>Lado</th><th>Azimute</th><th>Distância (m)</th><th>Confrontante</th></tr>
${tabela}
</table>

<p style="margin-top:28pt">______________________, ${hoje}.</p>
<p style="margin-top:36pt">_____________________________________<br>Responsável técnico<br>CREA/CFT nº ______________ &nbsp; ART/TRT nº ______________</p>

<p class="nota" style="margin-top:24pt">Rascunho gerado pela Arini Maps a partir da divisa disponível na plataforma. Confira em campo e com os documentos do imóvel. Para registro em cartório ou certificação no SIGEF, o memorial precisa ser revisado e assinado por profissional habilitado, com os confrontantes preenchidos.</p>
</body></html>`;
}
