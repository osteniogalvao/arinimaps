import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";

export type SecaoPdf = { titulo: string; linhas: string[] };
const verde = rgb(.07,.27,.20), tinta = rgb(.12,.18,.16), cinza = rgb(.30,.37,.34);
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
  let imagem: "esa" | "nasa" | null = null;
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
  for (const fonte of fontes) {
    if (fonte.id === "esa") parametros.set("TIME", "2021-01-01");
    else {
      if (janela[2] - janela[0] < .05) continue; // o mosaico de 500 m só serve a uma vista regional
      parametros.delete("TIME");
    }
    parametros.set("LAYERS", fonte.camada);
    try {
      const r = await fetch(fonte.url + "?" + parametros, {
        signal:AbortSignal.timeout(6000), ...(privada ? {cache:"no-store" as const} : {next:{revalidate:86400}}),
      });
      if (!r.ok || !r.headers.get("content-type")?.startsWith("image/jpeg")) continue;
      const jpg = await doc.embedJpg(await r.arrayBuffer());
      pagina.drawImage(jpg,{x:margem,y:topo-h,width:w,height:h});
      imagem = fonte.id;
      break;
    } catch { /* Tenta a próxima fonte; a divisa também pode ser impressa sozinha. */ }
  }
  pagina.drawSvgPath(partes.join(" "),{
    x:margem,y:topo,color:rgb(.73,.86,.77),opacity:imagem ? 0.08 : 1,
    borderColor:imagem ? rgb(1,.94,.34) : verde,borderWidth:1.4,
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
    p.drawText("ARINI",{x:margem,y:790,font:negrito,size:16,color:verde});
    p.drawText("CONSULTA TERRITORIAL",{x:largura-margem-111,y:792,font:fonte,size:9,color:cinza});
    p.drawText((tipo === "car" ? "CAR  " : "ÁREA DESENHADA  ")+seguro(codigo),{x:margem,y:765,font:fonte,size:9,color:cinza});
    p.drawLine({start:{x:margem,y:752},end:{x:largura-margem,y:752},color:verde,thickness:1});
    return p;
  };
  let pagina=novaPagina(), y=722;
  function quebra() { pagina=novaPagina();y=722; }
  function linha(texto:string,destaque=false) {
    const f=destaque?negrito:fonte, size=destaque?13:10.5;
    const escrever=(s:string)=>{
      if(y<55) quebra();
      pagina.drawText(s,{x:margem,y,font:f,size,color:destaque?verde:tinta});y-=destaque?19:15;
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
  pagina.drawText(titulo,{x:margem,y,font:negrito,size:21,color:verde});y-=25;
  linha("Emitido em "+emitido+" (Brasília).");
  const mapa = geometria && await desenharDivisa(doc,pagina,geometria,y-10,tipo === "desenho");
  if (mapa) {
    y-=167;
    pagina.drawText((tipo === "car" ? "Divisa declarada no CAR." : "Área aproximada desenhada pelo titular.") + " Norte para cima.",{x:margem,y,font:fonte,size:9,color:cinza});y-=16;
    if (mapa.imagem === "esa") {
      linha("Imagem histórica de referência: mosaico Sentinel-2 de 2021 em cor natural, resolução de 10 m. Divisa sobreposta pela ARINI.");
      linha("© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium. CC BY 4.0.");
    } else if (mapa.imagem === "nasa") {
      linha("Imagem histórica regional: NASA Earth Observatory, MODIS Blue Marble, agosto de 2004, 500 m/pixel, via NASA GIBS.");
    } else linha("Imagem de satélite indisponível na emissão. A figura apresenta somente o perímetro.");
  }
  for(const secao of secoes) {
    if(y<100) quebra();
    y-=12;linha(secao.titulo,true);
    for(const item of secao.linhas) linha(item);
  }
  const paginas=doc.getPages();
  paginas.forEach((p,i)=>{
    p.drawLine({start:{x:margem,y:43},end:{x:largura-margem,y:43},color:rgb(.82,.85,.83),thickness:.5});
    p.drawText("ARINI",{x:margem,y:28,font:fonte,size:9,color:cinza});
    const numero=`Página ${i+1} de ${paginas.length}`;
    p.drawText(numero,{x:largura-margem-fonte.widthOfTextAtSize(numero,9),y:28,font:fonte,size:9,color:cinza});
  });
  return doc.save();
}
