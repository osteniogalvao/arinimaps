import { NextResponse } from "next/server";
import { ator } from "@/lib/authz";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { falha } from "@/lib/erros";
import { supabaseAdmin } from "@/lib/supabase/admin";

const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
export async function POST(req: Request) {
  const a = await ator();
  if (!a) return falha(401,"sem_sessao","Entre na sua conta.");
  const limite = await limitar("territorio:" + a.userId,60,600);
  if (!limite.permitido) return respostaLimite(limite,"alterações de protocolo ou safra");
  const b = await req.json().catch(()=>null);
  if (!b || typeof b !== "object" || JSON.stringify(b).length>65000) return falha(400,"dados_invalidos","Confira o formulário.");
  const db = supabaseAdmin();
  let resultado;
  switch (b.acao) {
    case "regra":
      if (typeof b.nome!=="string" || typeof b.orientacao!=="string" || !Array.isArray(b.requisitos)
        || b.requisitos.some((r:unknown)=>typeof r!=="string") || (b.anterior!=null && !uuid(b.anterior))) return falha(400,"regra_invalida","Confira as regras do serviço.");
      resultado=await db.rpc("fn_balcao_regra",{p_titular:a.userId,p_nome:b.nome,p_orientacao:b.orientacao,p_requisitos:b.requisitos,p_anterior:b.anterior??null});
      break;
    case "protocolar":
      if (!uuid(b.regra) || !uuid(b.chave) || !b.dados || typeof b.dados!=="object" || Array.isArray(b.dados)) return falha(400,"dados_invalidos","Preencha os requisitos.");
      resultado=await db.rpc("fn_balcao_abrir",{p_titular:a.userId,p_regra:b.regra,p_chave:b.chave,p_dados:b.dados});
      break;
    case "andamento":
      if (!uuid(b.id) || !Number.isSafeInteger(b.revisao) || typeof b.texto!=="string") return falha(400,"dados_invalidos","Preencha o andamento.");
      resultado=await db.rpc("fn_balcao_andar",{p_titular:a.userId,p_id:b.id,p_revisao:b.revisao,p_acao:b.etapa,p_texto:b.texto});
      break;
    case "lancamento":
      if (!uuid(b.id) || !["fornecedor","area","talhao","safra"].includes(b.tipo) || !b.campos || typeof b.campos!=="object") return falha(400,"dados_invalidos","Preencha o lançamento.");
      resultado=await db.rpc("fn_safra_lancar",{p_titular:a.userId,p_tipo:b.tipo,p_id:b.id,p_campos:b.campos});
      break;
    default: return falha(400,"operacao_invalida","Operação inválida.");
  }
  if (resultado.error) {
    const codigo=resultado.error.code;
    if (codigo==="42501" || codigo==="P0002" || codigo==="23503") return falha(403,"acesso_indisponivel","O cadastro ou o módulo está indisponível para esta conta.");
    if (codigo==="P9801") return falha(422,"area_excedida","A soma dos talhões ultrapassa a área cadastrada.");
    if (codigo==="40001" || codigo==="23505") return falha(409,"registro_alterado","O registro já existe ou foi alterado. Atualize a página.");
    if (codigo.startsWith("22") || codigo==="23514" || codigo==="23502") return falha(400,"dados_invalidos","Confira todos os campos e os requisitos vigentes.");
    console.error("Operação territorial indisponível",codigo);return falha(503,"modulo_indisponivel","Tente novamente em instantes.");
  }
  return NextResponse.json({ok:true,resultado:resultado.data});
}