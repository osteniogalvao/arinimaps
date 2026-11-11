/**
 * Exportar para SIG (segunda etapa do cliente, item 8): KML, GeoJSON e
 * Shapefile (zip) da divisa do imóvel e, quando houver, do CAR.
 *
 * Tudo no navegador e sem dependência nova: o shapefile de polígono é o
 * formato ESRI (jul/1998) com .dbf dBASE III, o mesmo que src/lib/geo/
 * shapefileCar.ts já lê; o zip usa o JSZip que o projeto já tem, carregado
 * com import() só no clique. Coordenadas em graus (EPSG:4326), como o banco
 * entrega; o .prj declara WGS 84.
 */

export type Atributos = Record<string, string | number | null>;

/** Uma camada exportada (vira um arquivo .shp, uma pasta do KML, um grupo do GeoJSON). */
export type CamadaSig = {
  /** nome curto, sem espaço: vira o nome do arquivo (divisa, car) */
  nome: string;
  /** nome legível (pasta do KML) */
  rotulo: string;
  geometry: GeoJSON.Geometry;
  atributos: Atributos;
};

type Poligonos = GeoJSON.Position[][][];

/** Polígonos da geometria (Polygon, MultiPolygon ou coleção deles); o resto é ignorado. */
function poligonos(g: GeoJSON.Geometry | null | undefined): Poligonos {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  if (g.type === "GeometryCollection") return g.geometries.flatMap(poligonos);
  return [];
}

export const temPoligono = (g: GeoJSON.Geometry | null | undefined) => poligonos(g).length > 0;

/** Polígonos de uma geometria, para quem precisa andar pelos vértices (memorial). */
export const poligonosDe = poligonos;

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

export function paraGeoJSON(camadas: CamadaSig[]): string {
  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: camadas.map((c) => ({
      type: "Feature",
      properties: { camada: c.rotulo, ...c.atributos },
      geometry: c.geometry,
    })),
  };
  return JSON.stringify(fc);
}

// ---------------------------------------------------------------------------
// KML
// ---------------------------------------------------------------------------

const xml = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Cores do KML são aabbggrr. Divisa no Verde Arini, CAR no Ouro. */
const ESTILO_KML: Record<string, { linha: string; preenchimento: string }> = {
  divisa: { linha: "ff314412", preenchimento: "40314412" },
  car: { linha: "ff6fbdd9", preenchimento: "306fbdd9" },
};

function anelKml(anel: GeoJSON.Position[]) {
  return `<LinearRing><coordinates>${anel.map(([x, y]) => `${x},${y},0`).join(" ")}</coordinates></LinearRing>`;
}

function poligonoKml(p: GeoJSON.Position[][]) {
  const [externo, ...furos] = p;
  return `<Polygon><outerBoundaryIs>${anelKml(externo)}</outerBoundaryIs>${furos
    .map((f) => `<innerBoundaryIs>${anelKml(f)}</innerBoundaryIs>`).join("")}</Polygon>`;
}

export function paraKML(camadas: CamadaSig[], nomeDocumento: string): string {
  const estilos = Object.entries(ESTILO_KML).map(([id, e]) =>
    `<Style id="${id}"><LineStyle><color>${e.linha}</color><width>2.5</width></LineStyle><PolyStyle><color>${e.preenchimento}</color></PolyStyle></Style>`).join("");
  const placemarks = camadas.map((c) => {
    const ps = poligonos(c.geometry);
    const geom = ps.length === 1 ? poligonoKml(ps[0]) : `<MultiGeometry>${ps.map(poligonoKml).join("")}</MultiGeometry>`;
    const dados = Object.entries(c.atributos).filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(v)}</value></Data>`).join("");
    return `<Placemark><name>${xml(c.rotulo)}</name><styleUrl>#${ESTILO_KML[c.nome] ? c.nome : "divisa"}</styleUrl><ExtendedData>${dados}</ExtendedData>${geom}</Placemark>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(nomeDocumento)}</name>${estilos}${placemarks}</Document></kml>`;
}

// ---------------------------------------------------------------------------
// DXF (pedido 11/11: "baixar o perímetro em DXF", como o Geomart)
// ---------------------------------------------------------------------------

/**
 * DXF R12 em ASCII (o mais aceito: AutoCAD, BricsCAD, QGIS, TopoGRAPH,
 * Métrica TOPO), em UTM SIRGAS 2000 no fuso do centro das camadas — quem
 * abre no CAD quer metros, não graus. Uma layer por camada (DIVISA, CAR),
 * cada anel vira uma POLYLINE fechada e cada vértice externo ganha o rótulo
 * V1, V2… na layer VERTICES, na mesma ordem do memorial descritivo.
 */
export async function paraDXF(camadas: CamadaSig[]): Promise<{ texto: string; fuso: number; sul: boolean; epsg: number }> {
  const { fusoDaGeometria, geoParaUtm, epsgSirgas } = await import("./utm");
  const todos = camadas.flatMap((c) => poligonos(c.geometry).flatMap((p) => p.flat()));
  const { fuso, sul } = fusoDaGeometria(todos);
  const utm = (p: GeoJSON.Position) => geoParaUtm(p[0], p[1], fuso, sul);
  const linhas: (string | number)[] = [];
  const par = (codigo: number, valor: string | number) => linhas.push(codigo, valor);
  const f3 = (n: number) => n.toFixed(3);

  const layers = [...camadas.map((c) => c.nome.toUpperCase()), "VERTICES"];
  // cores ACI: divisa verde (3), CAR amarelo (2), rótulos branco (7)
  const cor = (l: string) => (l === "CAR" ? 2 : l === "VERTICES" ? 7 : 3);

  par(0, "SECTION"); par(2, "HEADER");
  par(9, "$ACADVER"); par(1, "AC1009");
  par(9, "$INSUNITS"); par(70, 6); // metros
  par(0, "ENDSEC");
  par(0, "SECTION"); par(2, "TABLES");
  par(0, "TABLE"); par(2, "LAYER"); par(70, layers.length);
  for (const l of layers) { par(0, "LAYER"); par(2, l); par(70, 0); par(62, cor(l)); par(6, "CONTINUOUS"); }
  par(0, "ENDTAB");
  par(0, "ENDSEC");
  par(0, "SECTION"); par(2, "ENTITIES");

  let v = 0;
  camadas.forEach((c, ic) => {
    const layer = c.nome.toUpperCase();
    for (const p of poligonos(c.geometry)) {
      p.forEach((anel, i) => {
        const aberto = anel.length > 1 && anel[0][0] === anel.at(-1)![0] && anel[0][1] === anel.at(-1)![1] ? anel.slice(0, -1) : anel;
        if (aberto.length < 3) return;
        par(0, "POLYLINE"); par(8, layer); par(66, 1); par(10, 0); par(20, 0); par(30, 0); par(70, 1);
        for (const pt of aberto) {
          const [e, n] = utm(pt);
          par(0, "VERTEX"); par(8, layer); par(10, f3(e)); par(20, f3(n)); par(30, 0);
        }
        par(0, "SEQEND"); par(8, layer);
        // rótulos só no anel externo da primeira camada (a do memorial)
        if (ic === 0 && i === 0) {
          for (const pt of ordemMemorial(aberto)) {
            const [e, n] = utm(pt);
            v++;
            par(0, "TEXT"); par(8, "VERTICES"); par(10, f3(e + 2)); par(20, f3(n + 2)); par(30, 0); par(40, 3); par(1, `V${v}`);
          }
        }
      });
    }
  });
  par(0, "ENDSEC"); par(0, "EOF");
  return { texto: linhas.join("\r\n") + "\r\n", fuso, sul, epsg: epsgSirgas(fuso, sul) };
}

/**
 * Ordem dos vértices do memorial: sentido horário, começando no vértice mais
 * ao norte (a convenção dos memoriais do INCRA). Recebe o anel sem repetir o
 * primeiro ponto no fim.
 */
export function ordemMemorial(aberto: GeoJSON.Position[]): GeoJSON.Position[] {
  const fechado = [...aberto, aberto[0]];
  const horario = areaComSinal(fechado) < 0;
  const lista = horario ? [...aberto] : [...aberto].reverse();
  let inicio = 0;
  lista.forEach((p, i) => { if (p[1] > lista[inicio][1]) inicio = i; });
  return [...lista.slice(inicio), ...lista.slice(0, inicio)];
}

// ---------------------------------------------------------------------------
// Shapefile (polígono, tipo 5)
// ---------------------------------------------------------------------------

const PRJ_WGS84 =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

/** Área com sinal (fórmula do laço): positiva = anti-horário. */
function areaComSinal(anel: GeoJSON.Position[]) {
  let s = 0;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) s += (anel[j][0] - anel[i][0]) * (anel[j][1] + anel[i][1]);
  return s / 2;
}

/** O shapefile quer o anel externo no sentido horário e os furos no anti-horário (o contrário do GeoJSON). */
function orientar(anel: GeoJSON.Position[], externo: boolean) {
  const fechado = anel.length > 0 && (anel[0][0] !== anel.at(-1)![0] || anel[0][1] !== anel.at(-1)![1]) ? [...anel, anel[0]] : anel;
  const antiHorario = areaComSinal(fechado) > 0;
  return externo === antiHorario ? [...fechado].reverse() : fechado;
}

type Registro = { partes: number[]; pontos: GeoJSON.Position[]; bbox: [number, number, number, number] };

function registro(g: GeoJSON.Geometry): Registro | null {
  const partes: number[] = [];
  const pontos: GeoJSON.Position[] = [];
  for (const p of poligonos(g)) {
    p.forEach((anel, i) => {
      if (anel.length < 3) return;
      partes.push(pontos.length);
      pontos.push(...orientar(anel, i === 0));
    });
  }
  if (!pontos.length) return null;
  const xs = pontos.map((p) => p[0]);
  const ys = pontos.map((p) => p[1]);
  return { partes, pontos, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

function cabecalhoShp(v: DataView, palavras: number, bbox: [number, number, number, number]) {
  v.setInt32(0, 9994, false);
  v.setInt32(24, palavras, false);
  v.setInt32(28, 1000, true);
  v.setInt32(32, 5, true);
  bbox.forEach((n, i) => v.setFloat64(36 + i * 8, n, true));
}

type Campo = { nome: string; tipo: "C" | "N"; tamanho: number; decimais: number };

/** Codifica em UTF-8 sem passar do tamanho do campo (sem cortar um caractere ao meio). */
function textoDbf(s: string, tamanho: number) {
  const enc = new TextEncoder();
  let bytes = enc.encode(s);
  let t = s;
  while (bytes.length > tamanho) { t = t.slice(0, -1); bytes = enc.encode(t); }
  return bytes;
}

function dbf(linhas: Atributos[]): Uint8Array {
  const chaves = [...new Set(linhas.flatMap((l) => Object.keys(l)))].slice(0, 50);
  const usados = new Set<string>();
  const campos: (Campo & { chave: string })[] = chaves.map((chave) => {
    const numerico = linhas.every((l) => l[chave] == null || typeof l[chave] === "number");
    // nome do campo: até 10 caracteres ASCII, sem repetir
    const base = (chave.normalize("NFD").replace(/[^\w]/g, "").toUpperCase() || "CAMPO").slice(0, 10);
    let nome = base; let n = 1;
    while (usados.has(nome)) nome = `${base.slice(0, 8)}${n++}`;
    usados.add(nome);
    if (numerico) return { chave, nome, tipo: "N", tamanho: 18, decimais: 4 };
    const maior = Math.max(1, ...linhas.map((l) => new TextEncoder().encode(String(l[chave] ?? "")).length));
    return { chave, nome, tipo: "C", tamanho: Math.min(254, maior), decimais: 0 };
  });
  const tamCabecalho = 32 + 32 * campos.length + 1;
  const tamRegistro = 1 + campos.reduce((s, c) => s + c.tamanho, 0);
  const buf = new Uint8Array(tamCabecalho + tamRegistro * linhas.length + 1);
  const v = new DataView(buf.buffer);
  const hoje = new Date();
  buf[0] = 0x03;
  buf[1] = hoje.getFullYear() - 1900; buf[2] = hoje.getMonth() + 1; buf[3] = hoje.getDate();
  v.setUint32(4, linhas.length, true);
  v.setUint16(8, tamCabecalho, true);
  v.setUint16(10, tamRegistro, true);
  campos.forEach((c, i) => {
    const o = 32 + i * 32;
    for (let k = 0; k < c.nome.length; k++) buf[o + k] = c.nome.charCodeAt(k);
    buf[o + 11] = c.tipo.charCodeAt(0);
    buf[o + 16] = c.tamanho;
    buf[o + 17] = c.decimais;
  });
  buf[tamCabecalho - 1] = 0x0d;
  linhas.forEach((l, r) => {
    let o = tamCabecalho + r * tamRegistro;
    buf[o++] = 0x20;
    for (const c of campos) {
      buf.fill(0x20, o, o + c.tamanho);
      const valor = l[c.chave];
      if (valor != null && valor !== "") {
        if (c.tipo === "N") {
          const s = Number(valor).toFixed(c.decimais).slice(0, c.tamanho).padStart(c.tamanho, " ");
          for (let k = 0; k < s.length; k++) buf[o + k] = s.charCodeAt(k);
        } else {
          buf.set(textoDbf(String(valor), c.tamanho), o);
        }
      }
      o += c.tamanho;
    }
  });
  buf[buf.length - 1] = 0x1a;
  return buf;
}

/** .shp, .shx, .dbf, .prj e .cpg de uma camada. */
export function arquivosShapefile(camada: CamadaSig): Record<string, Uint8Array | string> | null {
  const reg = registro(camada.geometry);
  if (!reg) return null;
  const tamConteudo = 44 + 4 * reg.partes.length + 16 * reg.pontos.length;
  const tamShp = 100 + 8 + tamConteudo;
  const shp = new DataView(new ArrayBuffer(tamShp));
  cabecalhoShp(shp, tamShp / 2, reg.bbox);
  let o = 100;
  shp.setInt32(o, 1, false); shp.setInt32(o + 4, tamConteudo / 2, false); o += 8;
  shp.setInt32(o, 5, true); o += 4;
  reg.bbox.forEach((n) => { shp.setFloat64(o, n, true); o += 8; });
  shp.setInt32(o, reg.partes.length, true); shp.setInt32(o + 4, reg.pontos.length, true); o += 8;
  reg.partes.forEach((p) => { shp.setInt32(o, p, true); o += 4; });
  reg.pontos.forEach(([x, y]) => { shp.setFloat64(o, x, true); shp.setFloat64(o + 8, y, true); o += 16; });

  const shx = new DataView(new ArrayBuffer(108));
  cabecalhoShp(shx, 108 / 2, reg.bbox);
  shx.setInt32(100, 50, false);
  shx.setInt32(104, tamConteudo / 2, false);

  return {
    [`${camada.nome}.shp`]: new Uint8Array(shp.buffer),
    [`${camada.nome}.shx`]: new Uint8Array(shx.buffer),
    [`${camada.nome}.dbf`]: dbf([camada.atributos]),
    [`${camada.nome}.prj`]: PRJ_WGS84,
    [`${camada.nome}.cpg`]: "UTF-8",
  };
}

/** Zip com um shapefile por camada. JSZip só carrega aqui (import() no clique). */
export async function paraShapefileZip(camadas: CamadaSig[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const c of camadas) {
    const arquivos = arquivosShapefile(c);
    if (arquivos) for (const [nome, conteudo] of Object.entries(arquivos)) zip.file(nome, conteudo);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/** Dispara o download de um arquivo gerado no navegador. */
export function baixar(conteudo: Blob | string, nomeArquivo: string, tipo = "application/octet-stream") {
  const blob = typeof conteudo === "string" ? new Blob([conteudo], { type: tipo }) : conteudo;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nomeArquivo;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
