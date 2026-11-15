"use server";
import {sessaoCrm} from "@/lib/crm-privado-servidor";
import {UUID_CRM} from "@/lib/crm-privado";
import {revalidatePath} from "next/cache";
export async function gravarRegistro(dados:{id:string;versao:number;modulo:string;revisao:number;titulo:string;documento:string|null;campos:Record<string,string>;etapa:string;atendimento:string|null}) {
 const s=await sessaoCrm();if(s.status!==200)return{erro:"Entre com uma conta com CRM técnico liberado."};
 if(!dados || !UUID_CRM.test(dados.id)||!UUID_CRM.test(dados.modulo)||!Number.isInteger(dados.versao)||Object.keys(dados.campos??{}).length>24) return {erro:"Confira o formulário."};
 const {error}=await s.banco.rpc("tecnico_salvar_registro",{p_id:dados.id,p_versao:dados.versao,p_modulo:dados.modulo,p_revisao:dados.revisao,p_titulo:dados.titulo,
   p_documento:dados.documento,p_campos:dados.campos,p_etapa:dados.etapa,p_atendimento:dados.atendimento});
 if(error)return{erro:error.code==="40001"?"O registro ou o modelo mudou. Recarregue para editar a versão atual.":error.code==="42501"?"Este registro exige acesso ao escritório e ao plano que o criou.":"Confira os campos obrigatórios, as datas e o modelo selecionado."};
 revalidatePath("/painel/crm/profissoes");return{id:dados.id};
}
export async function pedirProfissao(id:string,nome:string,descricao:string) {
 const s=await sessaoCrm();if(s.status!==200||!UUID_CRM.test(id))return {erro:"Seu acesso ao CRM técnico está indisponível."};
 const {error}=await s.banco.rpc("tecnico_pedir_profissao",{p_id:id,p_profissao:nome,p_descricao:descricao});
 if(error)return{erro:error.code==="55000"?"Esta profissão já tem modelo publicado. Selecione-o na lista.":"Confira o nome e a descrição do setor solicitado."};
 revalidatePath("/painel/crm/profissoes");return{ok:true};
}