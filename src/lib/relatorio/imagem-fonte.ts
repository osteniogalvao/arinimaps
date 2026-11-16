// Reaproveita somente imagens de áreas públicas. Desenhos particulares são lidos por emissão.
const carregando=new Map<string,Promise<Buffer>>();
const prontas=new Map<string,{em:number;imagem:Buffer}>();

export async function imagemDaFonte(url:string, formato:string, privada:boolean):Promise<Buffer> {
  async function buscar(){
    for(let tentativa=0;tentativa<2;tentativa++){
      try {
        const r=await fetch(url,{signal:AbortSignal.timeout(14000),cache:"no-store"});
        if(!r.ok || !r.headers.get("content-type")?.startsWith(formato)) throw Error("Resposta sem imagem");
        return Buffer.from(await r.arrayBuffer());
      }catch(e){if(tentativa===1)throw e;}
    }
    throw Error("Imagem indisponível");
  }
  if(privada)return buscar();
  const anterior=prontas.get(url);
  if(anterior && Date.now()-anterior.em<86400000)return anterior.imagem;
  const andamento=carregando.get(url);
  if(andamento)return andamento;
  const pedido=buscar().then(imagem=>{
    if(imagem.length<512000){
      if(prontas.size>=80)prontas.delete(prontas.keys().next().value!);
      prontas.set(url,{em:Date.now(),imagem});
    }
    return imagem;
  }).finally(()=>carregando.delete(url));
  carregando.set(url,pedido);
  return pedido;
}
