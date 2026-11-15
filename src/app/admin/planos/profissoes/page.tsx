import {notFound} from "next/navigation";
import Link from "next/link";
import {ator} from "@/lib/authz";
import {supabaseAdmin} from "@/lib/supabase/admin";
import {paginaCrm} from "@/lib/crm-privado";
import {type ModeloTecnico,type PedidoTecnico,estadosProfissao,formatarDataTecnica} from "@/lib/modelos-tecnicos";
import {Editor,Resposta} from "./Editor";
export default async function ProfissoesAdmin({searchParams}:{searchParams:Promise<{pagina?:string}>}){
 const a=await ator();if(a?.role!=="admin_central")notFound();
 const db=supabaseAdmin(),p=paginaCrm((await searchParams).pagina),inicio=(p-1)*25;
 const [modelos,pedidos]=await Promise.all([db.from("tecnico_modulos").select("*").order("profissao").order("nome"),
   db.from("tecnico_pedidos").select("*").order("criado",{ascending:false}).range(inicio,inicio+25)]);
 if(modelos.error||pedidos.error)throw Error("Não foi possível consultar os modelos técnicos.");
 const ms=(modelos.data??[]) as ModeloTecnico[],ps=(pedidos.data??[]) as PedidoTecnico[];
 const ativos=[...new Set(ms.filter(m=>m.ativo).map(m=>m.profissao))];
 return <div className="mx-auto max-w-5xl space-y-7"><Link className="underline" href="/admin/planos">Planos e nichos</Link>
 <div><h1 className="text-3xl font-semibold">Modelos técnicos e pedidos de profissão</h1><p>Os módulos publicados ficam disponíveis nos escritórios com CRM setorial. Cada registro conserva os campos e o documento da versão usada na abertura.</p></div>
 <Editor modelos={ms}/><section className="space-y-3"><h2 className="text-xl font-semibold">Pedidos de profissão</h2>{!ps.length&&<p>Nenhum pedido nesta página.</p>}
 {ps.slice(0,25).map(p=><details className="cartao p-4" key={p.id}><summary>{p.profissao} · {estadosProfissao[p.estado]} · Previsão {formatarDataTecnica(p.previsao)}</summary>
 <p className="my-3 whitespace-pre-line">{p.descricao}</p>{p.resposta&&<p>{p.resposta}</p>}
 {["recebido","em_analise"].includes(p.estado)&&<Resposta p={p} profissoes={ativos}/>}</details>)}
 <div className="flex gap-3">{p>1&&<Link href={"?pagina="+(p-1)}>Anterior</Link>}{ps.length>25&&<Link href={"?pagina="+(p+1)}>Próxima</Link>}</div></section></div>;
}