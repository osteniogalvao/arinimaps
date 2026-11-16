import "server-only";
import { imagemDaFonte } from "./imagem-fonte";
import sharp from "sharp";
import { bbox } from "@turf/bbox";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { matriculasDoImovel } from "@/lib/rural/matricula";
import type { SecaoPdf } from "./pdf-area";

type Divisa = GeoJSON.Polygon | GeoJSON.MultiPolygon;
const hectares = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const classes: Record<string,string> = {
  "0,100,0":"Cobertura arbórea", "255,187,34":"Arbustos", "255,255,76":"Vegetação herbácea",
  "240,150,255":"Lavouras", "250,0,0":"Área construída", "180,180,180":"Solo exposto ou vegetação esparsa",
  "240,240,240":"Neve ou gelo", "0,100,200":"Água permanente", "0,150,160":"Área úmida herbácea",
  "0,207,117":"Manguezal", "250,230,160":"Musgos e líquens",
};

export async function secaoMatricula(codigo:string, divisa:Divisa):Promise<SecaoPdf> {
  let linhas:string[];
  try {
    const parcelas=await matriculasDoImovel(codigo,divisa);
    linhas=parcelas.length ? parcelas.map(p => [p.nome, "Matrícula " + p.matricula,
      hectares.format(p.cobreDoImovel) + "% de sobreposição com a área", p.codigoIncra && "INCRA " + p.codigoIncra].filter(Boolean).join(" · "))
      : ["O SIGEF não retornou matrícula associada ao perímetro pelo critério de sobreposição. Consulte o cartório da circunscrição."];
  } catch { linhas=["A consulta ao SIGEF está indisponível nesta emissão."]; }
  return {titulo:"Matrículas e parcelas certificadas", linhas};
}

export async function secaoUso(divisa:Divisa,areaHa:number,privada:boolean):Promise<SecaoPdf> {
  const titulo="Uso e cobertura do solo";
  try {
    const [o,s,l,n]=bbox(divisa);
    const aneis=divisa.type==="Polygon" ? divisa.coordinates : divisa.coordinates.flat();
    const vertices=aneis.reduce((q,anel)=>q+anel.length,0);
    const tamanho=Math.max(12,Math.min(144,Math.floor(Math.sqrt(5_000_000/Math.max(vertices,1)))));
    const parametros=new URLSearchParams({SERVICE:"WMS",VERSION:"1.3.0",REQUEST:"GetMap",LAYERS:"esa-worldcover-map-10m-2021-v2_map",
      STYLES:"",TIME:"2021-01-01",CRS:"EPSG:4326",BBOX:[s,o,n,l].join(","),WIDTH:String(tamanho),HEIGHT:String(tamanho),FORMAT:"image/png"});
    const png=await imagemDaFonte("https://titiler.terrascope.be/wms?"+parametros,"image/png",privada);
    const {data,info}=await sharp(png,{limitInputPixels:tamanho*tamanho}).toColourspace("srgb").ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const contagens=new Map<string,number>();
    let total=0;
    for(let y=0;y<info.height;y++) for(let x=0;x<info.width;x++){
      if(!booleanPointInPolygon([o+(x+0.5)*(l-o)/info.width,n-(y+0.5)*(n-s)/info.height],divisa)) continue;
      total++;
      const i=(y*info.width+x)*4;
      const classe=data[i+3]===255 && classes[[data[i],data[i+1],data[i+2]].join(",")] || "Sem classificação";
      contagens.set(classe,(contagens.get(classe)??0)+1);
    }
    if(!total)throw Error();
    const linhas=[...contagens].sort((a,b)=>b[1]-a[1]).map(([nome,q])=>{
      const parcela=q/total;
      return nome+" · "+hectares.format(parcela*100)+"%"+(areaHa>0 ? " · cerca de "+hectares.format(parcela*areaHa)+" ha" : "");
    });
    linhas.push("ESA WorldCover 2021 v200 (10 m), CC BY 4.0. Estimativa por amostragem dentro da divisa. O uso atual e a área efetivamente aproveitável exigem conferência em campo.");
    return {titulo,linhas};
  } catch {return {titulo,linhas:["A camada ESA WorldCover não forneceu classificação utilizável nesta emissão."]};}
}

export async function secaoChuva(divisa:Divisa):Promise<SecaoPdf> {
  const titulo="Precipitação regional";
  const [o,s,l,n]=bbox(divisa);
  const data=(dias:number)=>new Date(Date.now()-dias*86400000).toISOString().slice(0,10).replaceAll("-","");
  const inicio=data(39), fim=data(10);
  const dia=(iso:string)=>iso.slice(6,8)+"/"+iso.slice(4,6)+"/"+iso.slice(0,4);
  const periodo=dia(inicio)+" a "+dia(fim);
  try {
    const parametros=new URLSearchParams({parameters:"PRECTOTCORR",community:"AG",latitude:((s+n)/2).toFixed(1),longitude:((o+l)/2).toFixed(1),
      start:inicio,end:fim,format:"JSON"});
    const resposta=await fetch("https://power.larc.nasa.gov/api/temporal/daily/point?"+parametros,{signal:AbortSignal.timeout(10000),next:{revalidate:86400}});
    if(!resposta.ok)throw Error();
    const valores=Object.entries((await resposta.json()).properties.parameter.PRECTOTCORR ?? {})
      .filter(([d,v])=>d>=inicio && d<=fim && typeof v==="number" && Number.isFinite(v) && v>=0) as [string,number][];
    if(!valores.length)throw Error();
    const soma=valores.reduce((acc, [,v])=>acc+v,0);
    const maior=valores.reduce((a,b)=>a[1]>=b[1]?a:b);
    const porDia=new Map(valores);
    const serie=Array.from({length:30},(_,i)=>porDia.get(data(39-i))??null);
    return {titulo,serie,linhas:[periodo+" · "+valores.length+" de 30 dias com dados.",
      "Acumulado nos dias disponíveis: "+hectares.format(soma)+" mm. Maior valor diário: "+hectares.format(maior[1])+" mm em "+dia(maior[0])+".",
      "Fonte: NASA POWER, precipitação corrigida em grade regional (PRECTOTCORR). A medição local pode variar."]};
  }catch{return {titulo,linhas:["NASA POWER · "+periodo+". A série regional está indisponível nesta emissão."]};}
}

export async function perfilDaArea(divisa:Divisa, chave:string, areaHa:number, secoes:Set<string>) {
  const pedidos:Promise<SecaoPdf>[]=[];
  if(secoes.has("matricula")) pedidos.push(secaoMatricula(chave,divisa));
  if(secoes.has("uso")) pedidos.push(secaoUso(divisa,areaHa,!chave.startsWith("car:")));
  if(secoes.has("clima")) pedidos.push(secaoChuva(divisa));
  return Promise.all(pedidos);
}
