"use server";
import {ator} from "@/lib/authz";
import {supabaseAdmin} from "@/lib/supabase/admin";
import {revalidatePath} from "next/cache";
import type {ModeloTecnico} from "@/lib/modelos-tecnicos";
import {UUID_CRM} from "@/lib/crm-privado";
const publico="/painel/crm/profissoes",admin="/admin/planos/profissoes";
export async function publicarModelo(m:ModeloTecnico) {
 const a=await ator();if(a?.role!=="admin_central")return{erro:"Apenas a Diretoria publica modelos."};
 if(!m||!UUID_CRM.test(m.id)||!Number.isInteger(m.versao)||!Array.isArray(m.campos)||m.campos.length>24||!Array.isArray(m.documentos)||m.documentos.length>18)return{erro:"Confira os campos e os documentos."};
 const {error}=await supabaseAdmin().rpc("tecnico_modelo_salvar",{p_ator:a.userId,p_id:m.id,p_versao:m.versao,p_profissao:m.profissao,p_nome:m.nome,p_premium:m.premium,p_campos:m.campos,p_documentos:m.documentos,p_ativo:m.ativo});
 if(error)return{erro:error.code==="40001"?"Outra pessoa alterou o modelo. Recarregue a página.":"Revise o nome, os campos e os documentos. Cada módulo tem nome único dentro da profissão."};
 revalidatePath(admin);revalidatePath(publico);return{ok:true};
}
export async function responderProfissao(id:string,versao:number,estado:string,resposta:string,modelo:string|null) {
 const a=await ator();if(a?.role!=="admin_central"||!UUID_CRM.test(id))return{erro:"Acesso restrito à Diretoria."};
 const {error}=await supabaseAdmin().rpc("tecnico_responder_profissao",{p_ator:a.userId,p_id:id,p_versao:versao,p_estado:estado,p_resposta:resposta,p_modelo:modelo});
 if(error)return{erro:"Confira a situação atual do pedido e a profissão publicada."};revalidatePath(admin);revalidatePath(publico);return{ok:true};
}