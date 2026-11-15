import { NextResponse } from "next/server";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const a = await ator();
  if (!a) return NextResponse.json({error:"Entre na sua conta."},{status:401});
  const limite = await limitar("leilao:" + a.userId, 60, 60);
  if (!limite.permitido) return respostaLimite(limite,"operação de leilão");
  const d = await req.json().catch(() => null);
  if (!d || !Number.isInteger(d.revisao) || d.revisao < 0) return NextResponse.json({error:"Dados inválidos."},{status:400});
  const db = supabaseAdmin();
  if (d.acao === "credenciar" && !temSetor(a,"diretoria")) return NextResponse.json({error:"Somente a Diretoria pode conceder ou suspender acesso."},{status:403});
  const { error } = d.acao === "credenciar"
    ? await db.rpc("leilao_credenciar",{p_ator:a.userId,p_parceiro:d.parceiro,p_plano:d.plano,p_matricula:d.matricula,p_empresa:d.empresa,
        p_referencia:d.referencia,p_validade:d.validade||null,p_ativo:d.ativo,p_revisao:d.revisao})
    : await db.rpc("leilao_operar",{p_ator:a.userId,p_imovel:d.imovel,p_acao:d.acao,p_dados:d.dados??{},p_revisao:d.revisao});
  if (error) {
    const status = error.code==="42501"?403:error.code==="40001"?409:error.code==="P0002"?404:error.code?.startsWith("PGRST")?503:400;
    const msg = status===403?"Sua conta não tem acesso a esta operação.":status===409?"O registro foi alterado. Atualize a página.":status===404?"Registro não encontrado.":
      error.code==="P0001"?"O teste de três dias já foi utilizado.":"Confira o pacote, as datas, a referência e a situação atual.";
    return NextResponse.json({error:msg},{status});
  }
  return NextResponse.json({ok:true});
}
