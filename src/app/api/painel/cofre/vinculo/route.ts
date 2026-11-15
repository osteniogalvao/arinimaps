import { createHash } from "node:crypto";
import { ator,temSetor } from "@/lib/authz";
import { temPerfilCofre } from "@/lib/cofre";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { falha } from "@/lib/erros";
import { limitar,respostaLimite } from "@/lib/seguranca/limite";
import { conferirArquivo } from "@/lib/seguranca/arquivos";

export async function POST(req:Request) {
  const a=await ator();if(!a || !temPerfilCofre(a.role,a.nicho)) return falha(a?403:401,"acesso","Entre com um perfil de proprietário ou produtor.");
  const busca=new URL(req.url).searchParams; const id=busca.get("id"); const vinculo=busca.get("vinculo");
  if(!ehUuid(id) || !["proprietario","coproprietario","herdeiro","procurador","arrendatario","representante"].includes(vinculo??"")) return falha(400,"vinculo","Informe a propriedade e o vínculo.");
  const db=supabaseAdmin();
  const {data:claim}=await db.from("propriedade_claims").select("id,estado").eq("cofre_id",id).eq("titular_id",a.userId).maybeSingle();
  if(!claim || !["RASCUNHO","PENDENCIA","REPROVADA"].includes(claim.estado)) return falha(409,"protocolo","Solicitação indisponível para envio.");
  const lim=await limitar("claim-prova:"+a.userId,12,3600);if(!lim.permitido)return respostaLimite(lim,"protocolos");
  let nome:string;
  try {nome=decodeURIComponent(req.headers.get("X-Nome-Arquivo")??"").replace(/[\\/\u0000-\u001f\u007f]/g,"").trim();} catch{return falha(400,"arquivo","Nome inválido.");}
  if(!req.body || !nome || nome.length>180) return falha(400,"arquivo","Selecione o comprovante.");
  const leitor=req.body.getReader(),partes:ArrayBuffer[]=[];let bytes=0;
  try {for (;;) {
    const {done,value}=await leitor.read();if(done)break;
    bytes+=value.byteLength;if(bytes>10*1024*1024){await leitor.cancel();return falha(413,"arquivo","O comprovante pode ter até 10 MB.");}
    partes.push(value.slice().buffer);
  }}catch{return falha(400,"arquivo","Envio interrompido.");}finally{leitor.releaseLock();}
  const f=await conferirArquivo(new File(partes,nome),["pdf","png","jpg"],10*1024*1024);
  if(!f.ok)return falha(400,"arquivo",f.erro);
  const path=`vinculos/${a.userId}/${id}/${crypto.randomUUID()}.${f.arquivo.ext}`;
  const bucket=db.storage.from("docs");
  if((await bucket.upload(path,f.arquivo.bytes,{upsert:false,contentType:f.arquivo.contentType})).error)return falha(502,"arquivo","Falha ao guardar o comprovante.");
  const {error}=await db.rpc("claim_submeter",{p_cofre:id,p_titular:a.userId,p_vinculo:vinculo,p_codigo:busca.get("codigo")?.trim()||null,
    p_path:path,p_nome:nome,p_hash:createHash("sha256").update(new Uint8Array(f.arquivo.bytes)).digest("hex")});
  if(error){
    const ver=await db.from("propriedade_claims").select("prova_path").eq("id",claim.id).eq("titular_id",a.userId).maybeSingle();
    if(ver.error) return falha(503,"protocolo","Confira se o protocolo foi recebido antes de reenviar.");
    if(ver.data?.prova_path!==path){await bucket.remove([path]);return falha(409,"protocolo",error.code==="P0001"?error.message:"Não foi possível confirmar a solicitação.");}
  }
  return Response.json({ok:true});
}

export async function GET(req:Request) {
  const a=await ator();
  if(!a || !temSetor(a,"operacoes","juridico"))return falha(a?403:401,"acesso","Acesso restrito à conferência do vínculo.");
  const id=new URL(req.url).searchParams.get("id");
  if(!ehUuid(id))return falha(400,"id","Protocolo inválido.");
  const db=supabaseAdmin();const {data}=await db.from("propriedade_claims").select("prova_nome,prova_path").eq("id",id).maybeSingle();
  if(!data?.prova_path)return falha(404,"arquivo","Comprovante indisponível.");
  const res=await db.storage.from("docs").download(data.prova_path);
  if(!res.data)return falha(502,"arquivo","Falha ao ler o comprovante.");
  if((await db.from("audit_log").insert({user_id:a.userId,acao:"comprovante_vinculo_aberto",entidade:"propriedade_claims",entidade_id:id})).error)
    return falha(503,"registro","Falha ao registrar a leitura.");
  return new Response(res.data,{headers:{"Cache-Control":"private, no-store","Content-Type":"application/octet-stream",
    "X-Content-Type-Options":"nosniff","Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(data.prova_nome??"comprovante")}});
}

