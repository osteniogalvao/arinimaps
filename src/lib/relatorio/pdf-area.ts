import { imagemDaFonte } from "./imagem-fonte";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import sharp from "sharp";
import { SATELITE_RELEASE, urlTileHistorico } from "@/lib/map/config";
import { MARCA_CAMINHOS, MARCA_VIEWBOX } from "./marca-pdf";

/**
 * Imagem de satélite de alta resolução para o PDF (17/11/2026, item 13.1 do
 * Carlos: "imagens cartográficas reais"). Usa o mesmo mosaico Esri do mapa
 * (release fixo do Wayback, sem nuvem), montando os tiles com o sharp e
 * recortando exatamente a janela pedida. Devolve JPEG ou lança erro.
 */
async function mosaicoEsri(janela: number[], largura: number, altura: number, privada: boolean) {
  const [sul, oeste, norte, leste] = janela;
  const merc = (lng: number, lat: number, z: number) => {
    const n = 256 * 2 ** z, s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
    return [(lng + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  };
  let z = 17;
  for (; z > 3; z--) {
    const [x0, y0] = merc(oeste, norte, z), [x1, y1] = merc(leste, sul, z);
    const tiles = (Math.floor(x1 / 256) - Math.floor(x0 / 256) + 1) * (Math.floor(y1 / 256) - Math.floor(y0 / 256) + 1);
    if (x1 - x0 <= largura * 1.5 && tiles <= 30) break;
  }
  const [px0, py0] = merc(oeste, norte, z), [px1, py1] = merc(leste, sul, z);
  const tx0 = Math.floor(px0 / 256), ty0 = Math.floor(py0 / 256), tx1 = Math.floor(px1 / 256), ty1 = Math.floor(py1 / 256);
  const pedidos: Promise<{ input: Buffer; left: number; top: number }>[] = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    pedidos.push(imagemDaFonte(urlTileHistorico(z, tx, ty, SATELITE_RELEASE), "image/", privada)
      .then((input) => ({ input, left: (tx - tx0) * 256, top: (ty - ty0) * 256 })));
  }
  const pecas = await Promise.all(pedidos);
  const mosaico = await sharp({ create: { width: (tx1 - tx0 + 1) * 256, height: (ty1 - ty0 + 1) * 256, channels: 3, background: "#22301f" } })
    .composite(pecas).png().toBuffer();
  const left = Math.max(0, Math.round(px0 - tx0 * 256)), top = Math.max(0, Math.round(py0 - ty0 * 256));
  return sharp(mosaico)
    .extract({ left, top, width: Math.max(1, Math.round(px1 - px0)), height: Math.max(1, Math.round(py1 - py0)) })
    .resize(largura, altura, { fit: "fill" })
    .modulate({ saturation: 1.12 }).sharpen()
    .jpeg({ quality: 84 }).toBuffer();
}

/** Assinatura ARINI desenhada em vetor (sem depender de imagem externa). */
function desenharMarca(pagina: PDFPage, x: number, topo: number, alturaPt: number) {
  const escala = alturaPt / MARCA_VIEWBOX.altura;
  for (const { d, cor } of MARCA_CAMINHOS) pagina.drawSvgPath(d, { x, y: topo, scale: escala, color: hex(cor), borderWidth: 0 });
  return MARCA_VIEWBOX.largura * escala;
}

export type SecaoPdf = { titulo: string; linhas: string[]; serie?: (number|null)[] };
type Cor = ReturnType<typeof rgb>;
const verde = rgb(.07,.27,.20), tinta = rgb(.12,.18,.16), cinza = rgb(.36,.42,.39), fio = rgb(.86,.89,.87);
// 17/11/2026: o Carlos achou o PDF pálido. Faixa verde ARINI no topo, fio
// dourado e cada seção com a cor do seu tema (água azul, desmatamento
// vermelho, energia âmbar...), mais um selo do resultado da consulta.
// 17/11/2026 (áudio das 10h49, "melhorar o visual dos PDFs"): ficha em tabela,
// painel da consulta em cartões, uso do solo em barras, resultados em lista,
// mapa maior com escala e norte, divisa verde e cabeçalho enxuto nas páginas
// seguintes.
const profundo = rgb(.04,.13,.10), ouro = rgb(.85,.74,.44), branco = rgb(1,1,1);
const hex = (h: string) => rgb(parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255);
/** Mesmo verde da malha do CAR no mapa (CORES_RURAIS.car). */
const DIVISA = hex("#34DB1E");
const TEMAS: [RegExp, string][] = [
  [/cadastro ambiental|car\b/i, "#1F9A12"],
  [/precipita|chuva/i, "#1E88E5"],
  [/água|agua|represa|hidro|outorga/i, "#0288D1"],
  [/desmat|prodes|queimad|foco/i, "#D84315"],
  [/embarg|ibama/i, "#C2185B"],
  [/indígena|indigena|quilomb/i, "#7B1FA2"],
  [/miner|anm/i, "#6D4C41"],
  [/energia|aneel|transmiss/i, "#F9A825"],
  [/rodovi|dnit|estrada/i, "#546E7A"],
  [/matrícula|matricula|sigef|parcela|snci|incra/i, "#D32F2F"],
  [/bioma|uso e cobertura|vegeta|ambiente|perímetro|perimetro|conserva/i, "#2E7D32"],
];
const corDoTema = (titulo: string) => hex(TEMAS.find(([r]) => r.test(titulo))?.[1] ?? "#124431");
/** Cores das classes do ESA WorldCover, para as barras do uso do solo. */
const CORES_USO: [RegExp, string][] = [
  [/arbórea|arborea/i, "#1B7F3A"], [/arbust/i, "#C9A227"], [/herbácea|herbacea/i, "#9CCB5A"], [/lavoura/i, "#D46BD6"],
  [/construída|construida/i, "#D32F2F"], [/solo exposto/i, "#9E9E9E"], [/água|agua/i, "#1E88E5"], [/úmida|umida/i, "#26A69A"],
  [/mangue/i, "#00A86B"],
];
/** Clareia a cor para o fundo da faixa da seção. */
const tom = (c: Cor, f: number) => rgb(c.red+(1-c.red)*f, c.green+(1-c.green)*f, c.blue+(1-c.blue)*f);
/** Versão mais escura para texto: amarelo e laranja legíveis sobre branco. */
const escurecer = (c: Cor) => rgb(c.red*.72, c.green*.72, c.blue*.72);
const largura = 595, altura = 842, margem = 44, util = largura - 2*margem;
/** Topo útil da 1ª página (faixa alta com a marca) e das seguintes (faixa enxuta). */
const TOPO_CAPA = 722, TOPO_CONT = 770, RODAPE = 62;

/** "Rótulo: valor" com rótulo curto: vira linha de ficha (tabela). */
const ROTULO = /^([^:]{2,38}): (\S.*)$/;
/** "Classe · 12,5% · cerca de 30 ha": vira barra no gráfico de uso. */
const PARCELA = /^(.+?) · ([\d.,]+)%(?: · (.+))?$/;
/** Situação de uma fonte consultada, lida do texto da seção (regra única para selo e painel). */
function situacaoDa(secao: SecaoPdf) {
  const achados = secao.linhas.join(" ").match(/registros encontrados: ([\d.]+)/i);
  const indisponivel = secao.linhas.some((l) => /indispon/i.test(l));
  if (!achados && !indisponivel) return null;
  const n = Number(achados?.[1].replace(/\./g, "") ?? 0);
  return { n, indisponivel: indisponivel && !achados };
}
const corSituacao = (s: {n:number;indisponivel:boolean}, cor: Cor) => s.indisponivel ? rgb(.55,.55,.55) : s.n > 0 ? cor : rgb(.18,.56,.34);
const textoSituacao = (s: {n:number;indisponivel:boolean}) => s.indisponivel ? "Fonte indisponível" : s.n > 0 ? `${s.n.toLocaleString("pt-BR")} ${s.n === 1 ? "registro" : "registros"}` : "Nada encontrado";

/** Arredonda para 1, 2 ou 5 × 10^n (régua de escala). */
function redondo(v: number) {
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

async function desenharDivisa(doc: PDFDocument, pagina: PDFPage, geo: GeoJSON.Geometry, topo: number, privada: boolean, negrito: PDFFont) {
  const aneis = geo.type === "Polygon" ? geo.coordinates : geo.type === "MultiPolygon" ? geo.coordinates.flat() : [];
  let oeste=Infinity,sul=Infinity,leste=-Infinity,norte=-Infinity;
  for (const anel of aneis) for (const [lng,lat] of anel) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
    oeste=Math.min(oeste,lng);leste=Math.max(leste,lng);sul=Math.min(sul,lat);norte=Math.max(norte,lat);
  }
  if (oeste>=leste || sul>=norte) return false;
  const correcao = Math.cos((norte+sul)*Math.PI/360);
  const h = ALTURA_MAPA, w = util;
  const escala = Math.min((w-60)/((leste-oeste)*correcao),(h-44)/(norte-sul));
  const x0 = (w-(leste-oeste)*correcao*escala)/2, y0=(h-(norte-sul)*escala)/2;
  const partes: string[] = [];
  for (const anel of aneis) {
    if (anel.length < 4) continue;
    const pontos: string[] = [];
    let xAnt=-Infinity, yAnt=-Infinity;
    for (const [lng,lat] of anel) {
      const x=x0+(lng-oeste)*correcao*escala, y=y0+(norte-lat)*escala;
      // Pontos subpixel na folha não alteram o contorno impresso.
      if (Math.hypot(x-xAnt,y-yAnt)<.25) continue;
      pontos.push((pontos.length ? "L" : "M")+x.toFixed(2)+" "+y.toFixed(2));
      xAnt=x;yAnt=y;
    }
    if (pontos.length>=3) partes.push(pontos.join(" ")+" Z");
  }
  if (!partes.length) return false;
  pagina.drawRectangle({x:margem,y:topo-h,width:w,height:h,color:rgb(.95,.97,.95)});
  let imagem: "esri" | "esa" | "nasa" | null = null;
  // O raster usa exatamente a mesma transformação da divisa. WMS 1.3
  // com EPSG:4326 recebe a janela na ordem latitude,longitude.
  const janela = [norte-(h-y0)/escala, oeste-x0/(correcao*escala), norte+y0/escala, oeste+(w-x0)/(correcao*escala)];
  const parametros = new URLSearchParams({
    SERVICE:"WMS", VERSION:"1.3.0", REQUEST:"GetMap", LAYERS:"esa-worldcover-s2rgbnir-10m-2021-v2_tcc",
    STYLES:"", CRS:"EPSG:4326", BBOX:janela.map(n => n.toFixed(8)).join(","), WIDTH:String(w*2), HEIGHT:String(h*2), FORMAT:"image/jpeg",
  });
  const fontes = [
    {id:"esa",url:"https://titiler.terrascope.be/wms",camada:"esa-worldcover-s2rgbnir-10m-2021-v2_tcc"},
    {id:"nasa",url:"https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",camada:"BlueMarble_ShadedRelief_Bathymetry"},
  ] as const;
  try {
    pagina.drawImage(await doc.embedJpg(await mosaicoEsri(janela, w*3, h*3, privada)),{x:margem,y:topo-h,width:w,height:h});
    imagem = "esri";
  } catch { /* segue para o Sentinel-2 de 10 m */ }
  for (const fonte of imagem ? [] : fontes) {
    if (fonte.id === "esa") parametros.set("TIME", "2021-01-01");
    else {
      if (janela[2] - janela[0] < .05) continue; // o mosaico de 500 m só serve a uma vista regional
      parametros.delete("TIME");
    }
    parametros.set("LAYERS", fonte.camada);
    try {
      const jpg = await doc.embedJpg(await imagemDaFonte(fonte.url+"?"+parametros,"image/jpeg",privada));
      pagina.drawImage(jpg,{x:margem,y:topo-h,width:w,height:h});
      imagem = fonte.id;
      break;
    } catch { /* Tenta a próxima fonte; a divisa também pode ser impressa sozinha. */ }
  }
  const caminho = partes.join(" ");
  // halo escuro por baixo e traço verde por cima: lê no satélite claro e no escuro
  if (imagem) pagina.drawSvgPath(caminho,{x:margem,y:topo,borderColor:rgb(.02,.08,.04),borderWidth:4.6,borderOpacity:.55});
  pagina.drawSvgPath(caminho,{
    x:margem,y:topo,color:imagem ? DIVISA : rgb(.73,.86,.77),opacity:imagem ? .14 : 1,
    borderColor:imagem ? DIVISA : verde,borderWidth:2.4,
  });
  // moldura, norte e régua de escala
  pagina.drawRectangle({x:margem,y:topo-h,width:w,height:h,borderColor:verde,borderWidth:1.2});
  const nx = margem+w-22, ny = topo-16;
  pagina.drawCircle({x:nx,y:ny-6,size:12,color:branco,opacity:.9});
  pagina.drawSvgPath("M0 -9 L5 5 L0 2 L-5 5 Z",{x:nx,y:ny-4,color:verde,scale:1});
  pagina.drawText("N",{x:nx-3,y:ny-17,font:negrito,size:6.5,color:verde});
  const metrosPorPt = 111_320/escala;
  const metros = redondo(w*.2*metrosPorPt), lr = metros/metrosPorPt;
  const rotulo = metros >= 1000 ? `${(metros/1000).toLocaleString("pt-BR")} km` : `${metros} m`;
  const rx = margem+10, ry = topo-h+10;
  pagina.drawRectangle({x:rx-5,y:ry-5,width:lr+10+negrito.widthOfTextAtSize(rotulo,7)+8,height:16,color:branco,opacity:.88});
  pagina.drawRectangle({x:rx,y:ry,width:lr/2,height:3.5,color:verde});
  pagina.drawRectangle({x:rx+lr/2,y:ry,width:lr/2,height:3.5,color:branco,borderColor:verde,borderWidth:.6});
  pagina.drawText(rotulo,{x:rx+lr+6,y:ry-.5,font:negrito,size:7,color:verde});
  return {imagem};
}
const ALTURA_MAPA = 205;

export async function pdfDaArea(titulo: string, codigo: string, secoes: SecaoPdf[], geometria?: GeoJSON.Geometry|null, tipo: "car" | "desenho" = "car") {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo + " · " + codigo); doc.setAuthor("ARINI"); doc.setLanguage("pt-BR");
  const fonte = await doc.embedFont(StandardFonts.Helvetica), negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const aceitos = new Set(fonte.getCharacterSet());
  const seguro = (s:string) => [...s.normalize("NFC")].map(c=>aceitos.has(c.codePointAt(0)!) ? c : " ").join("");
  const emitido = new Intl.DateTimeFormat("pt-BR",{dateStyle:"long",timeStyle:"short",timeZone:"America/Sao_Paulo"}).format(new Date());
  const rotuloTipo = (tipo === "car" ? "CAR  " : "ÁREA DESENHADA  ")+seguro(codigo);
  const degrade = (p: PDFPage, base: number) => {
    for (let i = 0; i < 24; i++) // degradê do Verde ARINI para o Verde Profundo
      p.drawRectangle({x:i*largura/24,y:base,width:largura/24+1,height:altura-base,
        color:rgb(verde.red+(profundo.red-verde.red)*i/23, verde.green+(profundo.green-verde.green)*i/23, verde.blue+(profundo.blue-verde.blue)*i/23)});
    p.drawRectangle({x:0,y:base-3,width:largura,height:3,color:ouro});
  };
  const novaPagina = () => {
    const p = doc.addPage([largura,altura]);
    if (!doc.getPageCount() || doc.getPageCount() === 1) {
      // capa: faixa alta com a assinatura, como as pranchas do manual
      degrade(p, 756);
      desenharMarca(p, margem, 822, 30);
      const rotulo="CONSULTA TERRITORIAL";
      p.drawText(rotulo,{x:largura-margem-negrito.widthOfTextAtSize(rotulo,9),y:800,font:negrito,size:9,color:ouro});
      p.drawText(rotuloTipo,{x:margem,y:772,font:fonte,size:9,color:rgb(.80,.86,.82)});
    } else {
      // páginas seguintes: faixa enxuta, sobra espaço para o conteúdo
      degrade(p, 806);
      desenharMarca(p, margem, 832, 18);
      const t = seguro(titulo).toUpperCase();
      p.drawText(t,{x:largura-margem-negrito.widthOfTextAtSize(t,7.5),y:819,font:negrito,size:7.5,color:ouro});
    }
    return p;
  };
  let pagina=novaPagina(), y=TOPO_CAPA;
  const quebra = () => { pagina=novaPagina(); y=TOPO_CONT; };
  const garantir = (h: number) => { if (y - h < RODAPE) quebra(); };

  /** Quebra o texto em linhas que cabem na largura dada. */
  function quebrar(texto: string, f: PDFFont, size: number, larg: number) {
    const saida: string[] = [];
    let atual="";
    for (const palavra of seguro(texto).split(/\s+/).filter(Boolean)) {
      const proposta=atual?atual+" "+palavra:palavra;
      if(f.widthOfTextAtSize(proposta,size)<=larg) {atual=proposta; continue;}
      if(atual) saida.push(atual);
      atual="";
      for(const c of palavra) {
        if(f.widthOfTextAtSize(atual+c,size)>larg){saida.push(atual);atual="";}
        atual+=c;
      }
    }
    if(atual) saida.push(atual);
    return saida;
  }
  type Estilo = { x?: number; larg?: number; f?: PDFFont; size?: number; cor?: Cor; entre?: number };
  function paragrafo(texto: string, e: Estilo = {}) {
    const x = e.x ?? margem, larg = e.larg ?? util, f = e.f ?? fonte, size = e.size ?? 10, entre = e.entre ?? size*1.42;
    for (const l of quebrar(texto, f, size, larg)) {
      garantir(entre);
      pagina.drawText(l,{x,y,font:f,size,color:e.cor ?? tinta});
      y -= entre;
    }
  }

  // ---- título
  pagina.drawText(seguro(titulo),{x:margem,y,font:negrito,size:22,color:verde});y-=10;
  pagina.drawRectangle({x:margem,y,width:40,height:2.5,color:ouro});y-=16;
  paragrafo("Emitido em "+emitido+" (Brasília).",{size:9.5,cor:cinza});

  // ---- mapa
  const mapa = geometria && await desenharDivisa(doc,pagina,geometria,y-6,tipo === "desenho",negrito);
  if (mapa) {
    y -= ALTURA_MAPA + 20;
    // legenda curta embaixo do mapa
    pagina.drawRectangle({x:margem,y:y+1,width:14,height:7,color:tom(DIVISA,.75),borderColor:DIVISA,borderWidth:1.6});
    pagina.drawText(seguro((tipo === "car" ? "Divisa declarada no CAR" : "Área aproximada desenhada pelo titular") + " · norte para cima"),
      {x:margem+20,y:y+1.5,font:negrito,size:8.5,color:verde});
    y -= 13;
    const credito = mapa.imagem === "esri" ? "Imagem de satélite: Esri World Imagery (Wayback "+SATELITE_RELEASE+"), Maxar e colaboradores da comunidade GIS. Divisa sobreposta pela ARINI."
      : mapa.imagem === "esa" ? "Imagem histórica de referência: mosaico Sentinel-2 de 2021 em cor natural, 10 m. © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium. CC BY 4.0."
      : mapa.imagem === "nasa" ? "Imagem histórica regional: NASA Earth Observatory, MODIS Blue Marble, agosto de 2004, 500 m/pixel, via NASA GIBS."
      : "Imagem de satélite indisponível na emissão. A figura apresenta somente o perímetro.";
    paragrafo(credito,{size:7.5,cor:cinza,entre:10});
  }

  // ---- painel da consulta: um cartão por fonte consultada (estrutura dos PDFs do Dados Fazenda)
  const cartoes = secoes.flatMap((s) => { const st = situacaoDa(s); return st ? [{ titulo: s.titulo.split(" · ")[0], cor: corDoTema(s.titulo), ...st }] : []; });
  if (cartoes.length >= 2) {
    const comRegistro = cartoes.filter((c) => c.n > 0).length, fora = cartoes.filter((c) => c.indisponivel).length;
    garantir(90);
    y -= 14;
    pagina.drawText("Painel da consulta",{x:margem,y,font:negrito,size:14,color:verde});
    y -= 15;
    pagina.drawText(seguro(`${cartoes.length} fontes · ${comRegistro} com registros na área · ${cartoes.length - comRegistro - fora} sem ocorrência · ${fora} indisponíveis`),
      {x:margem,y,font:fonte,size:9,color:cinza});
    y -= 8;
    const colunas = 3, gap = 8, lc = (util - gap*(colunas-1))/colunas, hc = 40;
    cartoes.forEach((c, i) => {
      const col = i % colunas;
      if (col === 0) { garantir(hc + gap); y -= hc + gap; }
      const x = margem + col*(lc + gap);
      const cs = corSituacao(c, c.cor);
      pagina.drawRectangle({x,y,width:lc,height:hc,color:tom(cs,.9),borderColor:tom(cs,.6),borderWidth:.6});
      pagina.drawRectangle({x,y,width:4,height:hc,color:cs});
      let nome = seguro(c.titulo);
      while (nome.length > 3 && negrito.widthOfTextAtSize(nome,8) > lc-16) nome = nome.slice(0,-2);
      if (nome !== seguro(c.titulo)) nome = nome.trimEnd() + "...";
      pagina.drawText(nome,{x:x+10,y:y+hc-14,font:negrito,size:8,color:escurecer(cs)});
      pagina.drawText(seguro(textoSituacao(c)),{x:x+10,y:y+9,font:c.n > 0 ? negrito : fonte,size:11.5,color:tinta});
    });
    y -= 12;
  }

  // ---- seções
  const notas = secoes.filter((s) => /^sobre /i.test(s.titulo));
  for (const secao of secoes) {
    if (notas.includes(secao)) continue;
    const cor = corDoTema(secao.titulo);
    // cabeçalho nunca fica sozinho no pé da página
    garantir(25 + 40);
    y -= 14;
    pagina.drawRectangle({x:margem,y:y-8,width:util,height:25,color:tom(cor,.88)});
    pagina.drawRectangle({x:margem,y:y-8,width:5,height:25,color:cor});
    const st = situacaoDa(secao);
    let larguraSelo = 0;
    if (st) {
      const selo = seguro((st.indisponivel ? "Indisponível" : st.n > 0 ? textoSituacao(st) : "Nada encontrado").toUpperCase());
      larguraSelo = negrito.widthOfTextAtSize(selo,7.5)+16;
      pagina.drawRectangle({x:margem+util-larguraSelo-6,y:y-3,width:larguraSelo,height:15,color:corSituacao(st,cor)});
      pagina.drawText(selo,{x:margem+util-larguraSelo+2,y:y+1.5,font:negrito,size:7.5,color:branco});
    }
    const [nome, orgao] = seguro(secao.titulo).split(" · ");
    pagina.drawText(nome,{x:margem+14,y:y,font:negrito,size:12.5,color:escurecer(cor)});
    if (orgao) pagina.drawText(orgao,{x:margem+20+negrito.widthOfTextAtSize(nome,12.5),y:y+.5,font:fonte,size:9.5,color:cinza});
    y -= 26;

    const linhas = secao.linhas;
    const fichas = linhas.filter((l) => ROTULO.test(l));
    const parcelas = linhas.filter((l) => PARCELA.test(l));
    if (st) {
      // resultado de fonte oficial: 1ª linha = metadado da consulta, resto = lista de itens
      const [meta, ...itens] = linhas;
      paragrafo(meta.replace(/ · registros encontrados: [\d.]+\.?$/i, "."),{size:8.5,cor:cinza,x:margem+14,larg:util-14});
      for (const item of itens) {
        garantir(14);
        pagina.drawCircle({x:margem+18,y:y+3.2,size:2.2,color:cor});
        paragrafo(item,{x:margem+26,larg:util-26,size:9.5});
      }
    } else if (fichas.length >= Math.max(3, linhas.length*.6)) {
      // ficha: tabela rótulo × valor com linhas zebradas
      let zebra = false;
      for (const l of linhas) {
        const m = ROTULO.exec(l);
        if (!m) { y -= 3; paragrafo(l,{size:8.5,cor:cinza,x:margem+8}); continue; }
        const valor = quebrar(m[2], negrito, 10, util*.58-12);
        const h = 8 + valor.length*13;
        garantir(h);
        if (zebra) pagina.drawRectangle({x:margem,y:y-h+13,width:util,height:h,color:tom(cor,.95)});
        pagina.drawText(seguro(m[1]).toUpperCase(),{x:margem+8,y:y-1,font:negrito,size:7.5,color:escurecer(cor)});
        valor.forEach((v,i) => pagina.drawText(v,{x:margem+util*.42,y:y-1-i*13,font:negrito,size:10,color:tinta}));
        y -= h;
        zebra = !zebra;
      }
      pagina.drawLine({start:{x:margem,y:y+10},end:{x:margem+util,y:y+10},color:fio,thickness:.6});
    } else if (parcelas.length >= 2) {
      // uso do solo: barra horizontal por classe
      const maior = Math.max(...parcelas.map((l) => parseFloat(PARCELA.exec(l)![2].replace(/\./g,"").replace(",","."))));
      for (const l of linhas) {
        const m = PARCELA.exec(l);
        if (!m) { y -= 2; paragrafo(l,{size:7.5,cor:cinza,entre:10}); continue; }
        garantir(20);
        const pct = parseFloat(m[2].replace(/\./g,"").replace(",","."));
        const cb = hex(CORES_USO.find(([r]) => r.test(m[1]))?.[1] ?? "#78909C");
        const xb = margem+150, lb = util-150-110;
        pagina.drawText(seguro(m[1]),{x:margem+8,y,font:fonte,size:9.5,color:tinta});
        pagina.drawRectangle({x:xb,y:y-1.5,width:lb,height:10,color:rgb(.94,.95,.94)});
        pagina.drawRectangle({x:xb,y:y-1.5,width:Math.max(1.5,lb*pct/Math.max(maior,1)),height:10,color:cb});
        pagina.drawText(seguro(m[2]+"%"),{x:xb+lb+8,y,font:negrito,size:9.5,color:tinta});
        if (m[3]) pagina.drawText(seguro(m[3].replace(/^cerca de /,"≈ ").replace("≈", "~")),{x:xb+lb+50,y,font:fonte,size:8.5,color:cinza});
        y -= 17;
      }
    } else {
      for (const l of linhas) {
        const m = ROTULO.exec(l);
        if (m) {
          garantir(15);
          const r = seguro(m[1]+": ");
          pagina.drawText(r,{x:margem+14,y,font:negrito,size:10,color:escurecer(cor)});
          paragrafo(m[2],{x:margem+14+negrito.widthOfTextAtSize(r,10),larg:util-14-negrito.widthOfTextAtSize(r,10),size:10});
        } else paragrafo(l,{x:margem+14,larg:util-14});
      }
    }
    if (secao.serie?.length) {
      // chuva diária: barras com linha de base, máximo marcado e falhas visíveis
      garantir(92);
      const max = Math.max(1,...secao.serie.map(v=>v??0));
      const passo = (util-40)/secao.serie.length, xg = margem+34, base = y-62;
      pagina.drawLine({start:{x:xg,y:base+52},end:{x:xg+util-40,y:base+52},color:fio,thickness:.5,dashArray:[2,2]});
      pagina.drawText(seguro(max.toLocaleString("pt-BR",{maximumFractionDigits:1})+" mm"),{x:margem,y:base+50,font:negrito,size:7,color:cinza});
      pagina.drawText("0",{x:xg-10,y:base-2,font:fonte,size:7,color:cinza});
      secao.serie.forEach((valor,i)=>{
        const x = xg+i*passo+1;
        if (valor===null) { pagina.drawRectangle({x,y:base,width:passo-2,height:2,color:rgb(.8,.8,.8)}); return; }
        pagina.drawRectangle({x,y:base,width:passo-2,height:Math.max(.5,valor/max*52),color:valor>=max*.6?rgb(.08,.40,.75):rgb(.30,.62,.93)});
      });
      pagina.drawLine({start:{x:xg,y:base},end:{x:xg+util-40,y:base},color:cinza,thickness:.6});
      y = base-12;
      paragrafo("Precipitação diária (mm), da primeira à última data do período. Traço cinza: dia sem dado.",{size:7.5,cor:cinza,x:xg});
    }
  }

  // ---- notas finais em caixa cinza
  for (const nota of notas) {
    const texto = nota.linhas.join(" ");
    const linhasNota = quebrar(texto, fonte, 8.5, util-28);
    const h = 24 + linhasNota.length*11.5;
    garantir(h+14);
    y -= 14;
    pagina.drawRectangle({x:margem,y:y-h+10,width:util,height:h,color:rgb(.96,.97,.96),borderColor:fio,borderWidth:.6});
    pagina.drawText(seguro(nota.titulo).toUpperCase(),{x:margem+14,y:y-4,font:negrito,size:7.5,color:verde});
    y -= 18;
    for (const l of linhasNota) { pagina.drawText(l,{x:margem+14,y,font:fonte,size:8.5,color:cinza}); y -= 11.5; }
    y -= 6;
  }

  const paginas=doc.getPages();
  paginas.forEach((p,i)=>{
    p.drawRectangle({x:margem,y:42,width:util,height:1.2,color:ouro});
    p.drawText("ARINI",{x:margem,y:28,font:negrito,size:9,color:verde});
    p.drawText("Inteligência territorial",{x:margem+34,y:28,font:fonte,size:9,color:cinza});
    const numero=`Página ${i+1} de ${paginas.length}`;
    p.drawText(numero,{x:largura-margem-fonte.widthOfTextAtSize(numero,9),y:28,font:fonte,size:9,color:cinza});
  });
  return doc.save();
}
