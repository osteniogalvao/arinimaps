import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {sessaoCrm} from "@/lib/crm-privado-servidor";
import {UUID_CRM,paginaCrm} from "@/lib/crm-privado";
import {botaoTecnico as botao,etapasTecnicas,estadosProfissao,formatarDataTecnica as data,type RegistroTecnico,type ModeloTecnico,type PedidoTecnico} from "@/lib/modelos-tecnicos";
import Registro,{NovaProfissao} from "./Registro";
export default async function ModelosTecnicos({searchParams}:{searchParams:Promise<{id?:string;pagina?:string;atendimento?:string;profissao?:string}>}){
 const s=await sessaoCrm();if(s.status===401)redirect("/entrar?volta=/painel/crm/profissoes");
 if(s.status!==200)return <p>O plano deste perfil precisa incluir CRM setorial.</p>;
 const p=await searchParams;
 const {data:esp,error:ee}=await s.banco.rpc("tecnico_espaco");if(ee)throw Error("Falha ao consultar o escritório.");
 if(!esp)return <p>Consulte os modelos por profissão com um plano de CRM setorial. <Link className="underline" href="/planos?perfil=tecnico">Ver planos técnicos</Link></p>;
 const voltar=<Link className={botao} href="/painel/crm/profissoes">Todos os registros técnicos</Link>;
 if(p.id){
   if(!UUID_CRM.test(p.id))notFound();
   const {data:r,error}=await s.banco.from("tecnico_registros").select("*").eq("id",p.id).maybeSingle();if(error)throw Error("Falha ao consultar o registro.");if(!r)notFound();
   return <section className="space-y-5">{voltar}<h1 className="text-3xl font-semibold">{r.titulo}</h1>
      {r.atendimento&&r.autor===s.titular&&<Link className="underline" href={"/painel/crm?id="+r.atendimento}>Abrir atendimento vinculado</Link>}
      <Registro modelos={[]} registro={r as RegistroTecnico}/></section>;
 }
 const pagina=paginaCrm(p.pagina),inicio=(pagina-1)*25;
 const [ms,rs,ps]=await Promise.all([s.banco.from("tecnico_modulos").select("*").order("profissao").order("nome"),
    s.banco.from("tecnico_registros").select("id,titulo,etapa,modelo,atualizado").order("atualizado",{ascending:false}).order("id").range(inicio,inicio+25),
    s.banco.from("tecnico_pedidos").select("*").order("criado",{ascending:false}).limit(50)]);
 if(ms.error||rs.error||ps.error)throw Error("Falha ao consultar os módulos técnicos.");
 let at:string|null=null;
 if(p.atendimento&&UUID_CRM.test(p.atendimento)){
   const {data:a}=await s.banco.from("crm_privado_atendimentos").select("id").eq("id",p.atendimento).eq("titular_id",s.titular).maybeSingle();at=a?.id??null;
   if(!at)notFound();
 }
 return <section className="space-y-6"><Link className="underline" href="/painel/crm">Voltar ao Meu CRM</Link>
 <div><h1 className="text-3xl font-semibold">Serviços por profissão</h1><p>{String(esp.chave).startsWith("org/")?"Registros compartilhados com os membros autorizados de ":"Registros privados de "}{esp.nome}.</p></div>
 {at&&<p>O novo registro ficará vinculado ao atendimento selecionado. Os campos preenchidos ficam visíveis no espaço indicado acima.</p>}
 <Registro modelos={(ms.data??[]) as ModeloTecnico[]} atendimento={at} profissaoInicial={ms.data?.some(m=>m.profissao===p.profissao)?p.profissao:undefined}/>
 <section><h2 className="text-xl font-semibold">Registros do espaço</h2>{!rs.data?.length&&<p>Nenhum registro nesta página.</p>}
 <ul className="divide-y divide-linha">{rs.data?.slice(0,25).map(r=><li key={r.id}><Link href={"?id="+r.id} className="block py-3"><strong>{r.titulo}</strong><br/>{r.modelo.profissao} · {r.modelo.nome} · {etapasTecnicas[r.etapa]} · {data(r.atualizado)}</Link></li>)}</ul>
 <div className="flex gap-4">{pagina>1&&<Link href={"?pagina="+(pagina-1)}>Anterior</Link>}{rs.data?.length===26&&<Link href={"?pagina="+(pagina+1)}>Próxima</Link>}</div></section>
 <NovaProfissao/>{!!ps.data?.length&&<section><h2 className="text-xl font-semibold">Meus pedidos de profissão</h2><ul>{(ps.data as PedidoTecnico[]).map(p=><li className="border-b py-3" key={p.id}><strong>{p.profissao}</strong> · {estadosProfissao[p.estado]} · Previsão {data(p.previsao)}
 {p.resposta&&<p>{p.resposta}</p>}{p.modelo_profissao&&<Link className="underline" href={"?profissao="+encodeURIComponent(p.modelo_profissao)}>Usar modelo liberado</Link>}</li>)}</ul></section>}</section>;
}