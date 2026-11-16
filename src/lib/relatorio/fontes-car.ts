import "server-only";
import { unstable_cache } from "next/cache";
import type { FonteConsultada } from "@/components/rural/FontesLista";
import { ADAPTADORES, type Bbox } from "@/lib/rural/adaptadores";
import { supabaseAdmin } from "@/lib/supabase/admin";

const fontesDoLaudo = new Set(["ibge_biomas","anm","hidrografia","aneel","prodes_cerrado","ibama_embargos","dnit"]);
const consultaPublica = unstable_cache(async (cod:string, raioM:number, ids:string[])=>{
  const {data:janela,error}=await supabaseAdmin().rpc("fn_car_bbox_imovel",{p_cod:cod,p_buffer_m:raioM});
  if(error || !janela) return [];
  return Promise.all(ADAPTADORES.filter(f=>ids.includes(f.id)).map(async f=>{
    const em=new Date().toISOString();
    try {
      const r=await f.fn(janela as Bbox);
      return {id:f.id,consulta:{quantidade:r.quantidade,raio_m:raioM,erro:r.erro??null,consultado_em:em,resultado:{itens:r.itens}}};
    } catch {return {id:f.id,consulta:{quantidade:0,raio_m:raioM,erro:"Indisponível",consultado_em:em,resultado:{itens:[]}}};}
  }));
}, ["relatorio-car-fontes-publicas-v1"], { revalidate:900 });

export async function fontesPublicasCar(cod:string,raioM:number,lista:FonteConsultada[]):Promise<FonteConsultada[]> {
  const faltam=lista.filter(f=>fontesDoLaudo.has(f.id) && (!f.consulta || f.consulta.erro || Date.parse(f.consulta.consultado_em)<Date.now()-86400000));
  if(!faltam.length)return lista;
  const novas=await consultaPublica(cod,raioM,faltam.map(f=>f.id).sort());
  return lista.map(f=>{
    const nova=novas.find(n=>n.id===f.id);
    if(!nova) return f;
    if(nova.consulta.erro && f.consulta && !f.consulta.erro)
      return {...f,consulta:{...f.consulta,resultado:{...f.consulta.resultado,ultima_falha:{em:nova.consulta.consultado_em,erro:nova.consulta.erro}}}};
    return {...f,consulta:nova.consulta};
  });
}
