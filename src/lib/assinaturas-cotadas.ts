import "server-only";
import { AsaasErro, asaasBuscarCobranca, asaasCobrancasPorReferencia, asaasConfigurado,
  asaasCriarCobranca, asaasEstornarCobranca, asaasExcluirCobranca } from "@/lib/asaas";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { linkFaturaAri } from "@/lib/ia/pacote";
import { pagarRenovacaoNoCartao } from "@/lib/assinatura-cartao";

export const checkoutAtivo = () => asaasConfigurado() && !!process.env.ASAAS_WEBHOOK_TOKEN;
const eventos:Record<string,string>={RECEIVED:"PAYMENT_RECEIVED",CONFIRMED:"PAYMENT_CONFIRMED",OVERDUE:"PAYMENT_OVERDUE",
  REFUNDED:"PAYMENT_REFUNDED",CHARGEBACK_REQUESTED:"PAYMENT_CHARGEBACK_REQUESTED",PARTIALLY_REFUNDED:"PAYMENT_PARTIALLY_REFUNDED"};
export async function conciliarFatura(id:string) {
  if(!checkoutAtivo()) return;
  const db=supabaseAdmin();
  const {data:f,error}=await db.from("faturas_cotadas").select("*,assinaturas_cotadas!inner(cliente,plano,cancelado)").eq("id",id).single();
  if(error || !f) throw Error("Fatura indisponível.");
  const s=f.assinaturas_cotadas as {cliente:string;plano:string;cancelado:string|null};
  const referencia="plano_"+id;
  const {data:emitir,error:reserva}=await db.rpc("assinatura_reservar_emissao",{p_id:id});
  if(reserva) throw Error("Falha ao reservar emissão.");
  const agendar=async(minutos:number) => {
    const {error:e}=await db.from("faturas_cotadas").update({revisao_em:new Date(Date.now()+minutos*60_000).toISOString()}).eq("id",id);
    if(e) throw Error("Falha ao agendar conferência.");
  };
  // Distribui o trabalho entre as faturas, mesmo se uma chamada externa falhar.
  await agendar(5);
  let cobranca;
  if(emitir) {
    const hoje=new Date().toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
    try { cobranca=await asaasCriarCobranca({customer:s.cliente,value:f.valor/100,dueDate:hoje>f.inicio?hoje:f.inicio,
      description:"ARINI · "+(f.componente==="troca"?"Diferença da troca de plano":f.componente==="plano"?s.plano:"Adicionais mensais")+" · "+f.inicio,externalReference:referencia}); }
    catch(e) {
      if(e instanceof AsaasErro && [400,401,403,422].includes(e.status)) await db.rpc("assinatura_rejeicao_emissao",{p_id:id});
      throw e;
    }
  } else if(f.pagamento) cobranca=await asaasBuscarCobranca(f.pagamento);
  else {
    const encontrados=await asaasCobrancasPorReferencia(referencia);
    if(encontrados.length===1) cobranca=encontrados[0];
  }
  if(!cobranca) {
    if(f.pagamento && ["excluir","excluindo"].includes(f.operacao)) {
      const {error:e}=await db.rpc("assinatura_pagamento",{p_id:id,p_cliente:s.cliente,p_pagamento:f.pagamento,p_valor:f.valor,p_evento:"PAYMENT_DELETED"});
      if(e) throw Error("Falha ao conciliar cancelamento.");
    }
    return;
  }
  if(cobranca.externalReference!==referencia || cobranca.customer!==s.cliente || !Number.isFinite(cobranca.value) ||
      Math.round(Number(cobranca.value)*100)!==f.valor || (f.pagamento && f.pagamento!==cobranca.id)) throw Error("Dados da cobrança divergentes.");
  const confirmar=async(evento:string)=>{
    const {error:e}=await db.rpc("assinatura_pagamento",{p_id:id,p_cliente:s.cliente,p_pagamento:cobranca.id,p_valor:f.valor,p_evento:evento});
    if(e) throw Error("Falha ao conciliar evento da fatura.");
  };
  await confirmar(cobranca.deleted?"PAYMENT_DELETED":eventos[cobranca.status]??"PAYMENT_CREATED");
  const link=linkFaturaAri(cobranca.invoiceUrl);
  if(link) { const {error:e}=await db.from("faturas_cotadas").update({link}).eq("id",id); if(e) throw Error("Falha ao registrar fatura."); }
  const {data:atual,error:er}=await db.from("faturas_cotadas").select("status,operacao,fim").eq("id",id).single();
  if(er || !atual) throw Error("Falha ao conferir situação.");
  if(atual.operacao==="excluir" || atual.operacao==="estornar") {
    const excluir=atual.operacao==="excluir";
    const emCurso=excluir?"excluindo":"estornando";
    const {data:ganhou,error:e}=await db.from("faturas_cotadas").update({operacao:emCurso}).eq("id",id).eq("operacao",atual.operacao).select("id").maybeSingle();
    if(e) throw Error("Falha ao reservar operação.");
    if(!ganhou) return;
    try {
      if(excluir) {
        const r=await asaasExcluirCobranca(cobranca.id);
        if(r.deleted) await confirmar("PAYMENT_DELETED");
      } else {
        const r=await asaasEstornarCobranca(cobranca.id,cobranca.billingType==="BOLETO");
        const url=linkFaturaAri(r.requestUrl);
        if(url) { const {error:e}=await db.from("faturas_cotadas").update({link_estorno:url}).eq("id",id); if(e) throw Error("Falha ao registrar link de estorno."); }
      }
    } catch(erro) {
      if(erro instanceof AsaasErro && [400,401,403,422].includes(erro.status))
        await db.from("faturas_cotadas").update({operacao:"conferir"}).eq("id",id).eq("operacao",emCurso);
      throw erro;
    }
  }
  if (!atual.operacao && atual.status==="aberta" && f.numero>0 && !f.tentativa_cartao &&
      (f.componente==="plano" || f.componente==="adicionais")) {
    await pagarRenovacaoNoCartao(f.assinatura,s.cliente,{...f,pagamento:cobranca.id},cobranca);
  }
  await agendar(atual.operacao?30:360);
}

export async function rodarFaturamento() {
  if(!checkoutAtivo()) return {processadas:0,erros:0,configurado:false};
  const db=supabaseAdmin(),agora=new Date(),hoje=agora.toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
  const {data:assinaturas,error}=await db.from("assinaturas_cotadas").select("id").lte("proxima",hoje).is("cancelado",null).order("proxima").limit(40);
  if(error) throw Error("Não foi possível consultar renovações.");
  for(const s of assinaturas??[]) {
    const {error:e}=await db.rpc("assinatura_gerar",{p_id:s.id,p_hoje:hoje}); if(e) throw Error("Falha ao registrar competência.");
  }
  const {data:fa,error:ef}=await db.from("faturas_cotadas").select("id").or("status.in.(nova,emitindo,aberta,vencida),operacao.not.is.null")
    .lte("revisao_em",agora.toISOString()).order("revisao_em").limit(8);
  if(ef) throw Error("Não foi possível consultar faturas.");
  let erros=0;
  for(const f of fa??[]) { try { await conciliarFatura(f.id); } catch { console.error("Conciliação de fatura pendente",f.id); erros++; } }
  return {processadas:fa?.length??0,erros,configurado:true};
}
