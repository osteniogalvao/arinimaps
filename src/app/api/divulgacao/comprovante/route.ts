import { ator, temSetor } from "@/lib/authz";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { falha } from "@/lib/erros";

export async function GET(req:Request) {
  const a=await ator(), id=new URL(req.url).searchParams.get("id");
  if(!a||!temSetor(a,"marketing"))return falha(403,"sem_acesso","Acesso restrito à equipe responsável.");
  if(!ehUuid(id))return falha(404,"arquivo","Captura indisponível.");
  const {data,error}=await supabaseAdmin().rpc("divulgacao_comprovante",{p_ator:a.userId,p_missao:id}).maybeSingle();
  if(error)return falha(503,"indisponivel","Falha ao abrir a captura.");
  const doc=data as {imagem:string;mime:string}|null;
  if(!doc)return falha(404,"arquivo","Captura indisponível.");
  return new Response(Buffer.from(doc.imagem,"base64"),{headers:{"Content-Type":doc.mime,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
}
