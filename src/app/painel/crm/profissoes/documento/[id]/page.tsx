import {notFound,redirect} from "next/navigation";
import Link from "next/link";
import {sessaoCrm} from "@/lib/crm-privado-servidor";
import {UUID_CRM} from "@/lib/crm-privado";
import {type RegistroTecnico,formatarDataTecnica,etapasTecnicas} from "@/lib/modelos-tecnicos";
import {Imprimir} from "../../Registro";
export default async function DocumentoTecnico({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!UUID_CRM.test(id))notFound();const s=await sessaoCrm();
 if(s.status===401)redirect("/entrar?volta="+encodeURIComponent("/painel/crm/profissoes/documento/"+id));if(s.status!==200)notFound();
 const [{data,error},{data:esp}]=await Promise.all([s.banco.from("tecnico_registros").select("*").eq("id",id).maybeSingle(),s.banco.rpc("tecnico_espaco")]);
 if(error)throw Error("Documento indisponível.");if(!data?.documento||!esp)notFound();const r=data as RegistroTecnico;
 return <><div className="flex gap-4 print:hidden"><Link href={"/painel/crm/profissoes?id="+id}>Voltar ao registro</Link><Imprimir/></div>
 <article id="documento-setorial" className="cartao mx-auto my-8 max-w-3xl space-y-5 p-8">
 <header className="border-b pb-4"><p>{esp.nome} · {r.modelo.profissao}</p><h1 className="text-3xl font-semibold">{r.documento}</h1><p>Modelo operacional para revisão do profissional responsável.</p></header>
 <div><h2 className="text-xl font-semibold">{r.titulo}</h2><p>{r.modelo.nome} · {etapasTecnicas[r.etapa]} · Revisão {r.versao} de {formatarDataTecnica(r.atualizado)}</p></div>
 {r.modelo.campos.filter(c=>r.campos[c.id]).map(c=><section key={c.id}><h3 className="font-semibold">{c.nome}</h3><p className="whitespace-pre-wrap break-words">{c.tipo==="data"?formatarDataTecnica(r.campos[c.id]):r.campos[c.id]}</p></section>)}
 </article><style>{'@media print { body * {visibility:hidden} #documento-setorial, #documento-setorial * {visibility:visible} #documento-setorial {position:absolute;left:0;top:0;width:100%;max-width:none;box-shadow:none;border:none;margin:0} #documento-setorial section {break-inside:avoid} }'}</style></>;
}