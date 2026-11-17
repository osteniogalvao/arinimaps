import { imagemDaFonte } from "./imagem-fonte";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
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
const verde = rgb(.07,.27,.20), tinta = rgb(.12,.18,.16), cinza = rgb(.30,.37,.34);
// 17/11/2026: o Carlos achou o PDF pálido. Faixa verde ARINI no topo, fio
// dourado e cada seção com a cor do seu tema (água azul, desmatamento
// vermelho, energia âmbar...), mais um selo do resultado da consulta.
const profundo = rgb(.04,.13,.10), ouro = rgb(.85,.74,.44);
const hex = (h: string) => rgb(parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255);
const TEMAS: [RegExp, string][] = [
  [/cadastro ambiental|car\b/i, "#E07B00"],
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
/** Clareia a cor para o fundo da faixa da seção. */
const tom = (c: ReturnType<typeof rgb>, f: number) => rgb(c.red+(1-c.red)*f, c.green+(1-c.green)*f, c.blue+(1-c.blue)*f);
/** Versão mais escura para texto: amarelo e laranja legíveis sobre branco. */
const escurecer = (c: ReturnType<typeof rgb>) => rgb(c.red*.72, c.green*.72, c.blue*.72);
const largura = 595, altura = 842, margem = 44, util = largura - 2*margem;

async function desenharDivisa(doc: PDFDocument, pagina: PDFPage, geo: GeoJSON.Geometry, topo: number, privada: boolean) {
  const aneis = geo.type === "Polygon" ? geo.coordinates : geo.type === "MultiPolygon" ? geo.coordinates.flat() : [];
  let oeste=Infinity,sul=Infinity,leste=-Infinity,norte=-Infinity;
  for (const anel of aneis) for (const [lng,lat] of anel) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
    oeste=Math.min(oeste,lng);leste=Math.max(leste,lng);sul=Math.min(sul,lat);norte=Math.max(norte,lat);
  }
  if (oeste>=leste || sul>=norte) return false;
  const correcao = Math.cos((norte+sul)*Math.PI/360);
  const h = 140, w = util;
  const escala = Math.min((w-36)/((leste-oeste)*correcao),(h-24)/(norte-sul));
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
  pagina.drawRectangle({x:margem,y:topo-h,width:w,height:h,color:rgb(.95,.97,.95),borderColor:rgb(.81,.87,.83),borderWidth:.6});
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
  pagina.drawSvgPath(partes.join(" "),{
    x:margem,y:topo,color:imagem ? rgb(1,.84,0) : rgb(.73,.86,.77),opacity:imagem ? 0.16 : 1,
    borderColor:imagem ? rgb(1,.84,0) : verde,borderWidth:2.2,
  });
  return {imagem};
}

export async function pdfDaArea(titulo: string, codigo: string, secoes: SecaoPdf[], geometria?: GeoJSON.Geometry|null, tipo: "car" | "desenho" = "car") {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo + " · " + codigo); doc.setAuthor("ARINI"); doc.setLanguage("pt-BR");
  const fonte = await doc.embedFont(StandardFonts.Helvetica), negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const aceitos = new Set(fonte.getCharacterSet());
  const seguro = (s:string) => [...s.normalize("NFC")].map(c=>aceitos.has(c.codePointAt(0)!) ? c : " ").join("");
  const emitido = new Intl.DateTimeFormat("pt-BR",{dateStyle:"long",timeStyle:"short",timeZone:"America/Sao_Paulo"}).format(new Date());
  const novaPagina = () => {
    const p = doc.addPage([largura,altura]);
    // faixa do topo: verde profundo com fio dourado, como as pranchas do manual
    for (let i = 0; i < 24; i++) // degradê do Verde ARINI para o Verde Profundo
      p.drawRectangle({x:i*largura/24,y:756,width:largura/24+1,height:altura-756,
        color:rgb(verde.red+(profundo.red-verde.red)*i/23, verde.green+(profundo.green-verde.green)*i/23, verde.blue+(profundo.blue-verde.blue)*i/23)});
    p.drawRectangle({x:0,y:753,width:largura,height:3,color:ouro});
    desenharMarca(p, margem, 822, 30);
    const rotulo="CONSULTA TERRITORIAL";
    p.drawText(rotulo,{x:largura-margem-negrito.widthOfTextAtSize(rotulo,9),y:800,font:negrito,size:9,color:ouro});
    p.drawText((tipo === "car" ? "CAR  " : "ÁREA DESENHADA  ")+seguro(codigo),{x:margem,y:772,font:fonte,size:9,color:rgb(.80,.86,.82)});
    return p;
  };
  let pagina=novaPagina(), y=722;
  function quebra() { pagina=novaPagina();y=722; }
  function linha(texto:string,destaque=false,cor=verde) {
    const f=destaque?negrito:fonte, size=destaque?13:10.5;
    let primeira = true;
    const escrever=(s:string)=>{
      if(y<55) quebra();
      // "Rótulo: valor" — o rótulo sai em negrito na cor da seção
      const dois = primeira && !destaque && /^[^:]{2,38}: \S/.test(s) ? s.indexOf(": ") + 1 : 0;
      primeira = false;
      if (dois) {
        const r = s.slice(0, dois);
        pagina.drawText(r,{x:margem,y,font:negrito,size,color:escurecer(cor)});
        pagina.drawText(s.slice(dois),{x:margem+negrito.widthOfTextAtSize(r,size),y,font:f,size,color:tinta});
      } else pagina.drawText(s,{x:margem,y,font:f,size,color:destaque?escurecer(cor):tinta});
      y-=destaque?19:15;
    };
    let atual="";
    for (const palavra of seguro(texto).split(/\s+/).filter(Boolean)) {
      const proposta=atual?atual+" "+palavra:palavra;
      if(f.widthOfTextAtSize(proposta,size)<=util) {atual=proposta; continue;}
      if(atual) escrever(atual);
      atual="";
      for(const c of palavra) {
        if(f.widthOfTextAtSize(atual+c,size)>util){escrever(atual);atual="";}
        atual+=c;
      }
    }
    if(atual) escrever(atual);
  }
  pagina.drawText(titulo,{x:margem,y,font:negrito,size:22,color:verde});y-=10;
  pagina.drawRectangle({x:margem,y,width:40,height:2.5,color:ouro});y-=18;
  linha("Emitido em "+emitido+" (Brasília).");
  const mapa = geometria && await desenharDivisa(doc,pagina,geometria,y-10,tipo === "desenho");
  if (mapa) {
    y-=167;
    pagina.drawText((tipo === "car" ? "Divisa declarada no CAR." : "Área aproximada desenhada pelo titular.") + " Norte para cima.",{x:margem,y,font:fonte,size:9,color:cinza});y-=16;
    if (mapa.imagem === "esri") {
      linha("Imagem de satélite: Esri World Imagery (Wayback "+SATELITE_RELEASE+"), Maxar e colaboradores da comunidade GIS. Divisa sobreposta pela ARINI.");
    } else if (mapa.imagem === "esa") {
      linha("Imagem histórica de referência: mosaico Sentinel-2 de 2021 em cor natural, resolução de 10 m. Divisa sobreposta pela ARINI.");
      linha("© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium. CC BY 4.0.");
    } else if (mapa.imagem === "nasa") {
      linha("Imagem histórica regional: NASA Earth Observatory, MODIS Blue Marble, agosto de 2004, 500 m/pixel, via NASA GIBS.");
    } else linha("Imagem de satélite indisponível na emissão. A figura apresenta somente o perímetro.");
  }
  for(const secao of secoes) {
    if(y<136) quebra();
    y-=10;
    const cor = corDoTema(secao.titulo);
    pagina.drawRectangle({x:margem-6,y:y-7,width:util+12,height:25,color:tom(cor,.86)});
    pagina.drawRectangle({x:margem-6,y:y-7,width:5,height:25,color:cor});
    // selo à direita: quantos registros a consulta achou
    const achados = secao.linhas.join(" ").match(/registros encontrados: (\d+)/i);
    const indisponivel = secao.linhas.some((l) => /indispon/i.test(l));
    const selo = achados ? (Number(achados[1]) > 0 ? `${achados[1]} ${Number(achados[1]) === 1 ? "REGISTRO" : "REGISTROS"}` : "NADA ENCONTRADO")
      : indisponivel ? "INDISPONÍVEL" : "";
    if (selo) {
      const corSelo = indisponivel && !achados ? rgb(.55,.55,.55) : Number(achados?.[1] ?? 0) > 0 ? cor : rgb(.18,.56,.34);
      const lSelo = negrito.widthOfTextAtSize(seguro(selo),7.5)+14;
      pagina.drawRectangle({x:margem+util-lSelo,y:y-2,width:lSelo,height:14,color:corSelo});
      pagina.drawText(seguro(selo),{x:margem+util-lSelo+7,y:y+2,font:negrito,size:7.5,color:rgb(1,1,1)});
    }
    linha(secao.titulo,true,cor);
    y-=6;
    for(const item of secao.linhas) linha(item,false,cor);
    if(secao.serie?.length) {
      if(y<155) quebra();
      const max=Math.max(1,...secao.serie.map(v=>v??0));
      const passo=util/secao.serie.length;
      const base=y-56;
      pagina.drawLine({start:{x:margem,y:base},end:{x:margem+util,y:base},color:cinza,thickness:.5});
      secao.serie.forEach((valor,i)=>{
        if(valor===null) return;
        pagina.drawRectangle({x:margem+i*passo+1,y:base,width:passo-2,height:Math.max(.5,valor/max*48),color:valor>=max*.6?rgb(.08,.40,.75):rgb(.12,.53,.90)});
      });
      y=base-15;linha("Precipitação diária (mm) · da primeira à última data do período.");
    }
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
