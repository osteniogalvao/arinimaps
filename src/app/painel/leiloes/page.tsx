import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pacotesLeilao, type PacoteLeilao, type LoteLeilao } from "@/lib/leiloes";
import GestaoLote from "./GestaoLote";

export default async function Leiloes() {
  const a=await ator();if(!a)redirect("/entrar?volta=%2Fpainel%2Fleiloes");
  const db=supabaseAdmin();
  const {data}=await db.rpc("leilao_acesso",{p_ator:a.userId});const pacote=data as PacoteLeilao|null;
  if(!a.partnerId||!pacote)return <main className="cartao space-y-4 p-6"><h1 className="lp-display text-3xl">CRM de leilões</h1>
    <p>A Central confere a matrícula profissional e a empresa e ativa o pacote do leiloeiro.</p>
    <Link className="text-verde underline" href="/contato-perfil?perfil=leiloeiro">Solicitar atendimento</Link></main>;
  const {data:imoveis,error}=await db.from("properties").select("id,codigo,titulo,status,leilao").eq("partner_id",a.partnerId)
    .eq("modalidade","leilao").eq("regime_comercial","LEILAO").order("created_at",{ascending:false}).limit(500);
  if(error)throw new Error("Falha ao consultar a carteira de leilões.");
  const ids=(imoveis??[]).map(p=>p.id);
  const completo=["leilao_profissional","leilao_premium"].includes(pacote);
  const [docs,ops,cands,leads]=ids.length?await Promise.all([
    db.from("property_documents").select("property_id,tipo,versao,nome_arquivo,verificado").in("property_id",ids).is("substituido_por",null),
    completo ? db.from("leilao_operacoes").select("imovel_id,estado,revisao,valor,referencia_resultado,pos_leilao").in("imovel_id",ids) : db.from("leilao_operacoes").select("imovel_id,estado,revisao").in("imovel_id",ids),
    completo ? db.from("leilao_habilitacoes").select("id,imovel_id,estado,contato,revisao,referencia,perfil:profiles(nome)").in("imovel_id",ids).order("criado_em",{ascending:false}) : Promise.resolve({data:[],error:null}),
    db.from("opportunities").select("property_id").in("property_id",ids).eq("regime_na_origem","LEILAO").eq("responsavel_partner_id",a.partnerId),
  ]):[];
  if([docs,ops,cands,leads].some(r=>r?.error))throw new Error("Falha ao consultar o CRM de leilões.");
  function operacaoPorId(id:string){
    const op=ops?.data?.find(x=>x.imovel_id===id);
    if(!op)return null;
    return {estado:op.estado,revisao:op.revisao,valor:"valor" in op ? Number(op.valor)||null : null,
      referencia_resultado:"referencia_resultado" in op ? String(op.referencia_resultado??"")||null : null,
      pos_leilao:"pos_leilao" in op ? String(op.pos_leilao??"")||null : null};
  }
  return <main className="space-y-5"><h1 className="lp-display text-3xl">CRM de leilões</h1>
    <p>Pacote {pacotesLeilao[pacote]}. Os lances acontecem no canal indicado no edital.</p>
    {pacote!=="leilao_teste"&&<Link className="text-verde underline" href="/painel/novo">Cadastrar imóvel de leilão</Link>}
    {!ids.length&&<p>Nenhum imóvel de leilão nesta carteira.</p>}
    {(imoveis??[]).map(im=>{const l:LoteLeilao={id:im.id,codigo:im.codigo,titulo:im.titulo,status:im.status,praca1:im.leilao?.praca1_data,praca2:im.leilao?.praca2_data,
      comitente:im.leilao?.comitente,operacao:operacaoPorId(im.id),interessados:leads?.data?.filter(x=>x.property_id===im.id).length??0,
      documentos:(docs?.data??[]).filter(x=>x.property_id===im.id).map(x=>({...x,nome:x.nome_arquivo})),
      candidaturas:(cands?.data??[]).filter(x=>x.imovel_id===im.id).map(x=>({...x,nome:(x.perfil as unknown as {nome:string}|null)?.nome??"Candidato"}))};
      return <GestaoLote key={im.id} lote={l} pacote={pacote}/>;
    })}
  </main>;
}
