import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { falha } from "@/lib/erros";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { validarCNPJ } from "@/lib/br/documentos";
import { logAudit } from "@/lib/audit";

export async function POST(req:Request) {
  const a=await ator();
  if(!a || !temSetor(a,"financeiro")) return falha(a?403:401,"acesso","Acesso restrito ao Financeiro.");
  const b=await req.json().catch(()=>null);
  const db=supabaseAdmin();
  const texto=(v:unknown,max:number)=>typeof v==="string" ? v.trim().slice(0,max) : "";
  if(b?.acao==="encerrar") {
    if(!ehUuid(b.id) || !["linha","vaga"].includes(b.tipo)) return falha(400,"parametros","Registro inválido.");
    const tabela=b.tipo==="linha" ? "fin_linhas":"fin_vagas";
    const {data,error}=await db.from(tabela).update({ativo:false}).eq("id",b.id).eq("ativo",true).select("id").maybeSingle();
    if(error || !data) return falha(409,"registro","Registro inativo ou indisponível.");
    await logAudit({user_id:a.userId,acao:"credito_desativado",entidade:tabela,entidade_id:b.id,dados_antes:{ativo:true},dados_depois:{ativo:false}});
    return Response.json({ok:true});
  }
  if(!ehUuid(b?.id) || !texto(b.banco,100)) return falha(400,"parametros","Informe o banco e a identificação da operação.");
  const banco=texto(b.banco,100);
  let tabela:string,campos:Record<string,unknown>;
  if(b.acao==="linha") {
    const numeros=["taxa_nominal_aa","cet_aa","seguro_mensal","tarifa_inicial","prazo_max","percentual_max"];
    if(numeros.some(k=>typeof b[k]!=="number" || !Number.isFinite(b[k])) || !Array.isArray(b.sistemas) || !Array.isArray(b.lista_documentos))
      return falha(400,"parametros","Confira taxas, prazos, tarifas e sistemas.");
    tabela="fin_linhas";
    campos={banco,nome:texto(b.nome,160),tipo:b.tipo,taxa_nominal_aa:b.taxa_nominal_aa,cet_aa:b.cet_aa,seguro_mensal:b.seguro_mensal,
      tarifa_inicial:b.tarifa_inicial,prazo_max:b.prazo_max,percentual_max:b.percentual_max,sistemas:[...new Set(b.sistemas)],
      inicio:b.inicio,fim:b.fim,fonte:texto(b.fonte,500),lista_documentos:[...new Set(b.lista_documentos.map((v:unknown)=>texto(v,180)).filter(Boolean))].slice(0,60)};
  } else if(b.acao==="vaga") {
    if(!ehUuid(b.regiao_id) || !ehUuid(b.titular_id) || !validarCNPJ(String(b.cnpj)) || b.verificado!==true)
      return falha(400,"parametros","Confira a região, o CNPJ, a habilitação e o responsável.");
    const titular=await db.from("profiles").select("user_id").eq("user_id",b.titular_id).eq("nicho","correspondente_bancario").eq("ativo",true).maybeSingle();
    if(!titular.data) return falha(422,"titular","O titular precisa ter um perfil de correspondente ativo.");
    tabela="fin_vagas";
    campos={banco,regiao_id:b.regiao_id,titular_id:b.titular_id,prioridade:b.prioridade,sla_minutos:b.sla_minutos,
      identificacao:texto(b.identificacao,150)+" · CNPJ "+String(b.cnpj).replace(/\D/g,""),referencia_verificacao:texto(b.referencia_verificacao,240)};
  } else return falha(400,"acao","Operação inválida.");
  const {error}=await db.from(tabela).insert({id:b.id,criado_por:a.userId,...campos});
  if(error) {
    if(error.code==="23505" && (await db.from(tabela).select("id").eq("id",b.id).eq("criado_por",a.userId).maybeSingle()).data) return Response.json({ok:true});
    return falha(409,"credito",error.code==="23505" ? "A posição ou o titular já ocupa uma vaga neste banco e região." : "Confira os campos e a vigência.");
  }
  await logAudit({user_id:a.userId,acao:"credito_"+b.acao+"_criada",entidade:tabela,entidade_id:b.id,dados_depois:{banco}});
  return Response.json({ok:true});
}

