import "server-only";
import {AsaasErro,asaasBuscarClientePorReferencia,asaasCriarCliente} from "@/lib/asaas";
import {supabaseAdmin} from "@/lib/supabase/admin";
import {cpfDoPerfil} from "@/lib/seguranca/cripto";
export async function clienteDoPlano(titular: string) {
  const db=supabaseAdmin();
  const {data:p,error}=await db.from("profiles").select("nome,cpf_cnpj,cpf_cnpj_cifrado,asaas_customer_id").eq("user_id",titular).single();
  if(error || !p) throw Error("Falha ao consultar o cadastro do titular.");
  if(p.asaas_customer_id) return String(p.asaas_customer_id);
  let cliente=await asaasBuscarClientePorReferencia(titular);
  if(!cliente) {
    const cpf=cpfDoPerfil(p)?.replace(/\D/g,"") ?? "";
    if(![11,14].includes(cpf.length)) throw Error("Complete o CPF ou CNPJ da conta antes de contratar.");
    const reserva=await db.from("clientes_asaas_emissao").insert({titular});
    if(reserva.error) throw Error("O cadastro de cobrança está em conciliação no Asaas.");
    try {cliente=await asaasCriarCliente({name:p.nome,cpfCnpj:cpf,externalReference:titular});}
    catch(e){
      if(e instanceof AsaasErro && [400,401,403,422].includes(e.status)) await db.from("clientes_asaas_emissao").delete().eq("titular",titular);
      throw e;
    }
  }
  if(!cliente) throw Error("Não foi possível identificar o titular no Asaas.");
  const {error:erro}=await db.from("profiles").update({asaas_customer_id:cliente.id}).eq("user_id",titular).is("asaas_customer_id",null);
  if(erro) throw Error("Não foi possível vincular o cadastro de cobrança.");
  const {data:vinculo}=await db.from("profiles").select("asaas_customer_id").eq("user_id",titular).single();
  if(!vinculo?.asaas_customer_id) throw Error("Não foi possível confirmar o cadastro de cobrança.");
  return String(vinculo.asaas_customer_id);
}
