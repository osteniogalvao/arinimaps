import Link from "next/link";
import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Decidir from "./Decidir";
export default async function Verificacoes({searchParams}:{searchParams:Promise<{pagina?:string;estado?:string}>}) {
 await exigirSetor("operacoes","juridico");const q=await searchParams;
 const estado=["EM_ANALISE","PENDENCIA","EM_DISPUTA","APROVADA","REPROVADA"].includes(q.estado??"")?q.estado!:"abertas";
 const pagina=Math.max(1,Math.min(100000,Math.trunc(Number(q.pagina)||1)));
 let consulta=supabaseAdmin().from("propriedade_claims")
   .select("id,estado,revisao,anuncio_id,vinculo,motivo,prova_nome,atualizado_em,titular:profiles(nome),cofre:cofre_propriedades(nome,car,matricula,municipio),anuncio:properties!propriedade_claims_anuncio_id_fkey(titulo,codigo)");
 consulta=estado==="abertas"?consulta.in("estado",["EM_DISPUTA","EM_ANALISE","PENDENCIA"]):consulta.eq("estado",estado);
 const {data,error}=await consulta.order("atualizado_em").order("id").range((pagina-1)*30,pagina*30);
 if(error)throw Error("Não foi possível consultar as verificações.");
 return <main className="max-w-4xl space-y-5"><h1 className="lp-display text-3xl">Verificações de propriedade</h1>
   <form className="flex gap-2"><select defaultValue={estado} aria-label="Filtrar situação" className="campo" name="estado">{["abertas","EM_DISPUTA","EM_ANALISE","PENDENCIA","APROVADA","REPROVADA"].map(x=><option key={x}>{x}</option>)}</select><button className="btn-contorno p-2">Filtrar</button></form>
   {data.slice(0,30).map(c=>{const cofre=c.cofre as unknown as {nome:string;car:string|null;matricula:string|null;municipio:string}|null,anuncio=c.anuncio as unknown as {titulo:string;codigo:string}|null;
     return <section key={c.id} className="cartao space-y-2 p-5"><h2 className="lp-display text-xl">{cofre?.nome??anuncio?.titulo}</h2>
       <p>{c.estado.replaceAll("_"," ")} · {(c.titular as unknown as {nome:string})?.nome} · {c.vinculo}</p>
       {cofre && <p>{[cofre.municipio,cofre.car,cofre.matricula].filter(Boolean).join(" · ")}</p>}
       {c.estado==="EM_DISPUTA"&&<p className="text-alerta">A aprovação encerra as solicitações concorrentes de outros titulares para o mesmo imóvel.</p>}
       {c.prova_nome && <a className="text-verde" href={`/api/painel/cofre/vinculo?id=${c.id}`}>Abrir comprovante</a>}
       {anuncio && <Link className="text-verde" href={`/admin/imoveis/${c.anuncio_id}`}>Conferir documentos do anúncio {anuncio.codigo}</Link>}
       {c.motivo && <p>{c.motivo}</p>}{c.estado!=="REPROVADA"&&<Decidir id={c.id} revisao={c.revisao}/>}</section>;})}
   {!data.length && <p>Nenhuma verificação nesta fila.</p>}
   <nav className="flex gap-4">{pagina>1&&<Link href={`?estado=${estado}&pagina=${pagina-1}`}>Anterior</Link>}{data.length>30&&<Link href={`?estado=${estado}&pagina=${pagina+1}`}>Próxima</Link>}</nav>
 </main>;
}

