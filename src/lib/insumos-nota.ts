export type Compra={ documento:string; item:number; emissao:string; fornecedor:string; produto:string; gtin:string|null; unidade:string; quantidade:number; total:number };
type Item=Omit<Compra,"documento"|"emissao"|"fornecedor">;
const NS="http://www.portalfiscal.inf.br/nfe";
function filho(e:Element,nome:string) {return Array.from(e.children).find(v=>v.localName===nome && v.namespaceURI===NS);}
function campo(e:Element|undefined,nome:string) {return e?filho(e,nome)?.textContent?.trim()??"":"";}
/** Lê apenas o grupo de itens comerciais. XML e chave íntegra não saem do navegador. */
export async function lerNota(file:File) {
  if(file.size>5*1024*1024) throw Error("O XML deve ter até 5 MB.");
  const raw=await file.text();if(/<!DOCTYPE/i.test(raw))throw Error("XML com declarações externas não é aceito.");
  const xml=new DOMParser().parseFromString(raw,"application/xml");
  const info=xml.getElementsByTagNameNS(NS,"infNFe"); const proc=xml.getElementsByTagNameNS(NS,"infProt");
  if(info.length!==1 || proc.length!==1 || !["100","150"].includes(campo(proc[0],"cStat"))) throw Error("Use o XML processado de uma NF-e autorizada (nfeProc), com um único documento.");
  const key=campo(proc[0],"chNFe");if(!/^\d{44}$/.test(key) || info[0].getAttribute("Id")!=="NFe"+key)throw Error("O protocolo não corresponde à NF-e.");
  const chave=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(key))),v=>v.toString(16).padStart(2,"0")).join("");
  const ide=filho(info[0],"ide");const emissao=(campo(ide,"dhEmi")||campo(ide,"dEmi")).slice(0,10);
  const fornecedor=campo(filho(info[0],"emit"),"xNome");const itens:Item[]=[];
  for(const d of Array.from(info[0].children).filter(e=>e.localName==="det"&&e.namespaceURI===NS)){
    const p=filho(d,"prod"),gtin=campo(p,"cEAN");const q=Number(campo(p,"qCom")),valor=campo(p,"vProd");
    const total=Number((Number(valor)-Number(campo(p,"vDesc")||0)).toFixed(2));
    if(!valor || !(q>0) || !Number.isFinite(total) || total<0)throw Error("Item com quantidade ou valor inválido.");
    itens.push({item:Number(d.getAttribute("nItem")),produto:campo(p,"xProd"),gtin:/^(?:[0-9]{8}|[0-9]{12,14})$/.test(gtin)?gtin:null,unidade:campo(p,"uCom").toUpperCase(),quantidade:q,total});
  }
  if(!itens.length)throw Error("A nota não contém itens comerciais.");
  return {chave,emissao,fornecedor,itens};
}
export const grupoCompra=(i:Compra)=>(i.gtin?"GTIN "+i.gtin:i.produto.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleUpperCase("pt-BR"))+" | "+i.unidade;
