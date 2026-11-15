import { ator, type Ator } from "@/lib/authz";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { falha } from "@/lib/erros";
import { conferirArquivo } from "@/lib/seguranca/arquivos";
import { limitar,respostaLimite } from "@/lib/seguranca/limite";

const MAX=10*1024*1024;

async function documento(req:Request,a:Ator,escrita:boolean) {
  const doc=new URL(req.url).searchParams.get("id");
  if(!ehUuid(doc)) return null;
  const db=supabaseAdmin();
  const base="id,atendimento_id,nome_arquivo,storage_path,estado";
  const dono=await db.from("fin_documentos").select(base+",atendimento:fin_atendimentos!inner(revogado_em,sim:fin_simulacoes!inner(cliente_id))")
    .eq("id",doc).eq("atendimento.sim.cliente_id",a.userId).maybeSingle();
  // O dono continua podendo baixar o próprio arquivo após a revogação.
  type Doc = {id:string;atendimento_id:string;nome_arquivo:string|null;storage_path:string|null;estado:string;atendimento:{revogado_em:string|null}};
  if(dono.error) throw Error("Falha ao consultar o documento.");
  const titular=dono.data as unknown as Doc|null;
  if(titular && (!escrita || (!titular.atendimento.revogado_em && ["PENDENTE","REFAZER"].includes(titular.estado)))) return titular;
  if(escrita || a.nicho!=="correspondente_bancario") return null;
  const {data,error}=await db.from("fin_documentos").select(base+",atendimento:fin_atendimentos!inner(revogado_em,vaga:fin_vagas!inner(titular_id,ativo))")
    .eq("id",doc).is("atendimento.revogado_em",null).eq("atendimento.vaga.titular_id",a.userId).eq("atendimento.vaga.ativo",true).maybeSingle();
  if(error) throw Error("Falha ao consultar a autorização.");
  return data as unknown as Doc|null;
}

export async function GET(req:Request) {
  const a=await ator();
  if(!a) return falha(401,"sessao","Entre para consultar o documento.");
  const d=await documento(req,a,false);
  if(!d?.storage_path) return falha(404,"arquivo","Documento indisponível.");
  const db=supabaseAdmin();
  const {data,error}=await db.storage.from("docs").download(d.storage_path);
  if(error || !data) return falha(502,"arquivo","Falha ao ler o documento.");
  // Sem URL assinada reutilizável; a autorização vale por leitura.
  const vigente=await documento(req,a,false);
  if(vigente?.storage_path!==d.storage_path) return falha(404,"arquivo","Documento indisponível.");
  const registro=await db.from("audit_log").insert({user_id:a.userId,acao:"documento_financiamento_aberto",entidade:"fin_documentos",entidade_id:d.id});
  if(registro.error) return falha(503,"registro","Falha ao registrar a abertura.");
  return new Response(data,{headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
    "Content-Type":"application/octet-stream","Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(d.nome_arquivo??"documento")}});
}

export async function POST(req:Request) {
  const a=await ator();
  if(!a) return falha(401,"sessao","Entre para enviar o documento.");
  const d=await documento(req,a,true);
  if(!d) return falha(404,"arquivo","Documento indisponível para envio.");
  const limite=await limitar("fin-documentos:"+a.userId,40,3600);
  if(!limite.permitido) return respostaLimite(limite,"envio de documentos");
  let nome:string;
  try { nome=decodeURIComponent(req.headers.get("X-Nome-Arquivo")??"").replace(/[\\/\u0000-\u001f\u007f]/g,"").trim(); }
  catch {return falha(400,"arquivo","Nome inválido.");}
  if(!req.body || !nome || nome.length>180) return falha(400,"arquivo","Selecione um arquivo.");
  const leitor=req.body.getReader(); const partes:ArrayBuffer[]=[]; let tamanho=0;
  try {
    for (;;) {
      const {done,value}=await leitor.read();
      if(done) break;
      tamanho+=value.byteLength;
      if(tamanho>MAX) { await leitor.cancel(); return falha(413,"arquivo","O limite é 10 MB."); }
      partes.push(value.slice().buffer);
    }
  } catch { return falha(400,"arquivo","Envio interrompido."); }
  finally { leitor.releaseLock(); }
  const arquivo=await conferirArquivo(new File(partes,nome),["pdf","jpg","png"],MAX);
  if(!arquivo.ok) return falha(400,"arquivo",arquivo.erro);
  const path=`financiamento/${a.userId}/${d.id}/${crypto.randomUUID()}.${arquivo.arquivo.ext}`;
  const db=supabaseAdmin();
  const bucket=db.storage.from("docs");
  const {error:envio}=await bucket.upload(path,arquivo.arquivo.bytes,{contentType:arquivo.arquivo.contentType,upsert:false});
  if(envio) return falha(502,"arquivo","Falha ao guardar o arquivo.");
  const {error}=await db.rpc("fin_movimentar",{p_id:d.atendimento_id,p_ator:a.userId,p_acao:"ENVIAR_DOCUMENTO",p_doc:d.id,p_path:path,p_nome:nome});
  if(error) {
    const ver=await db.from("fin_documentos").select("storage_path").eq("id",d.id).maybeSingle();
    if(ver.error) return falha(503,"arquivo","Confirme o envio na lista de documentos.");
    if(ver.data?.storage_path!==path) { await bucket.remove([path]); return falha(409,"arquivo","A solicitação mudou. Atualize a página."); }
  }
  return Response.json({ok:true});
}

