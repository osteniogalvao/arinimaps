import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";

export type SecaoPdf = { titulo: string; linhas: string[] };
const verde = rgb(.07,.27,.20), tinta = rgb(.12,.18,.16), cinza = rgb(.30,.37,.34);
const largura = 595, altura = 842, margem = 44, util = largura - 2*margem;

function desenharDivisa(pagina: PDFPage, geo: GeoJSON.Geometry, topo: number): boolean {
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
  pagina.drawSvgPath(partes.join(" "),{x:margem,y:topo,color:rgb(.73,.86,.77),borderColor:verde,borderWidth:1.1});
  return true;
}

export async function pdfDaArea(titulo: string, codigo: string, secoes: SecaoPdf[], geometria?: GeoJSON.Geometry|null) {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo + " · " + codigo); doc.setAuthor("ARINI Maps"); doc.setLanguage("pt-BR");
  const fonte = await doc.embedFont(StandardFonts.Helvetica), negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const aceitos = new Set(fonte.getCharacterSet());
  const seguro = (s:string) => [...s.normalize("NFC")].map(c=>aceitos.has(c.codePointAt(0)!) ? c : " ").join("");
  const emitido = new Intl.DateTimeFormat("pt-BR",{dateStyle:"long",timeStyle:"short",timeZone:"America/Sao_Paulo"}).format(new Date());
  const novaPagina = () => {
    const p = doc.addPage([largura,altura]);
    p.drawText("ARINI Maps",{x:margem,y:790,font:negrito,size:16,color:verde});
    p.drawText("CONSULTA TERRITORIAL",{x:largura-margem-111,y:792,font:fonte,size:9,color:cinza});
    p.drawText("CAR  "+seguro(codigo),{x:margem,y:765,font:fonte,size:9,color:cinza});
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
  if (geometria && desenharDivisa(pagina,geometria,y-10)) {
    y-=167;
    pagina.drawText("Divisa declarada no CAR. Norte para cima.",{x:margem,y,font:fonte,size:9,color:cinza});y-=16;
  }
  for(const secao of secoes) {
    if(y<100) quebra();
    y-=12;linha(secao.titulo,true);
    for(const item of secao.linhas) linha(item);
  }
  const paginas=doc.getPages();
  paginas.forEach((p,i)=>{
    p.drawLine({start:{x:margem,y:43},end:{x:largura-margem,y:43},color:rgb(.82,.85,.83),thickness:.5});
    p.drawText("ARINI Maps",{x:margem,y:28,font:fonte,size:9,color:cinza});
    const numero=`Página ${i+1} de ${paginas.length}`;
    p.drawText(numero,{x:largura-margem-fonte.widthOfTextAtSize(numero,9),y:28,font:fonte,size:9,color:cinza});
  });
  return doc.save();
}
