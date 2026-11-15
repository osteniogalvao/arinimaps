import { createHash, randomUUID } from "node:crypto";
import { ator } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { conferirArquivo, extensao, ACEITA } from "@/lib/seguranca/arquivos";
import { registrarAcessoDocumento } from "@/lib/seguranca/documentos";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";

const maxArquivo = 25 * 1024 * 1024;
const maxFormulario = maxArquivo + 128 * 1024;
function erroDoBalcao(codigo:string) {
  if (codigo==="42501" || codigo==="P0002") return falha(403,"sem_acesso","Este protocolo ou serviço está indisponível para a sua conta.");
  if (codigo==="40001" || codigo==="23505") return falha(409,"conflito","O protocolo mudou. Atualize a página e confira o andamento.");
  if (codigo.startsWith("22") || codigo==="23514" || codigo==="23502") return falha(400,"arquivo_invalido","Confira o arquivo e os dados exigidos pelo serviço.");
  return falha(503,"indisponivel","Não foi possível confirmar o envio. Tente novamente com o mesmo arquivo.");
}
async function lerFormulario(req:Request) {
  if (!req.body || !req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) return null;
  const limite=()=>falha(413,"tamanho","O arquivo pode ter até 25 MB.");
  if (Number(req.headers.get("content-length"))>maxFormulario) return limite();
  const leitor=req.body.getReader(), partes:ArrayBuffer[]=[];
  let bytes=0;
  try {
    for (;;) {
      const {value,done}=await leitor.read();
      if (done) break;
      bytes+=value.byteLength;
      if (bytes>maxFormulario) { await leitor.cancel(); return limite(); }
      partes.push(value.slice().buffer);
    }
    return await new Response(new Blob(partes),{headers:{"content-type":req.headers.get("content-type")!}}).formData();
  } catch { return null; } finally { leitor.releaseLock(); }
}
function lerCampos(texto:FormDataEntryValue|null) {
  if (typeof texto!=="string" || texto.length>65000) return null;
  try {
    const c=JSON.parse(texto);
    if (!ehUuid(c.chave)) return null;
    if (c.acao==="protocolar" && ehUuid(c.regra) && c.dados && typeof c.dados==="object" && !Array.isArray(c.dados))
      return {chave:c.chave,campos:{acao:"protocolar",regra:c.regra,dados:c.dados}};
    if (c.acao==="andamento" && c.etapa==="resposta" && ehUuid(c.id) && Number.isSafeInteger(c.revisao) &&
      c.revisao>=1 && typeof c.texto==="string" && c.texto.trim() && c.texto.length<=2000)
      return {chave:c.chave,campos:{acao:"resposta",id:c.id,revisao:c.revisao,texto:c.texto}};
  } catch { return null; }
  return null;
}

export async function POST(req:Request) {
  const a=await ator();
  if (!a) return falha(401,"sem_sessao","Entre para enviar um arquivo ao município.");
  const limite=await limitar("balcao-upload:"+a.userId,30,3600);
  if (!limite.permitido) return respostaLimite(limite,"enviar documentos");
  const form=await lerFormulario(req);
  if (form instanceof Response) return form;
  const envio=form && lerCampos(form.get("operacao")), arquivo=form?.get("arquivo");
  if (!envio || !(arquivo instanceof File)) return falha(400,"formulario","Informe o projeto e os dados do protocolo.");
  const nomeOriginal=arquivo.name.replace(/[\u0000-\u001f\u007f/\\]/g,"").trim();
  if (!nomeOriginal || nomeOriginal.length>200) return falha(400,"nome","Confira o nome do arquivo.");
  const conferido=await conferirArquivo(arquivo,ACEITA.documento,maxArquivo);
  if (!conferido.ok) return falha(400,"arquivo",conferido.erro);
  const db=supabaseAdmin(), f=conferido.arquivo;
  const nome=extensao(nomeOriginal)===f.ext ? nomeOriginal : nomeOriginal.slice(0,190)+"."+f.ext;
  const args={p_autor:a.userId,p_chave:envio.chave,p_campos:envio.campos,p_nome:nome,p_hash:createHash("sha256").update(Buffer.from(f.bytes)).digest("hex")};
  const pre=await db.rpc("balcao_preparar_anexo",args);
  if (pre.error) return erroDoBalcao(pre.error.code);
  if (pre.data!=null) return Response.json({ok:true,resultado:pre.data});
  // O caminho exclusivo da tentativa impede que uma requisição remova o objeto de outra.
  const id=randomUUID(), path="balcao/"+id+"."+f.ext, bucket=db.storage.from("docs");
  const up=await bucket.upload(path,f.bytes,{contentType:f.contentType,upsert:false});
  if (up.error) return falha(502,"armazenamento","Não foi possível guardar o arquivo.");
  const salvo=await db.rpc("balcao_gravar_anexo",{...args,p_id:id,p_ext:f.ext,p_tamanho:arquivo.size}).single();
  if (salvo.error) {
    // Um erro de transporte pode vir depois do commit. Objetos sem metadado
    // são recolhidos pelo worker após a carência, inclusive em caso de queda.
    if (/^(22|23|40|42|P0)/.test(salvo.error.code)) await bucket.remove([path]);
    return erroDoBalcao(salvo.error.code);
  }
  const resultado=salvo.data as {arquivo:string;numero:number};
  if (resultado.arquivo!==id) await bucket.remove([path]);
  return Response.json({ok:true,resultado:resultado.numero});
}

export async function GET(req:Request) {
  const a=await ator();
  if (!a) return falha(401,"sem_sessao","Entre para acessar o arquivo.");
  const id=new URL(req.url).searchParams.get("id");
  if (!ehUuid(id)) return falha(400,"arquivo","Identificador inválido.");
  const limite=await limitar("balcao-download:"+a.userId,120,600);
  if (!limite.permitido) return respostaLimite(limite,"baixar documentos");
  const db=supabaseAdmin(),r=await db.rpc("balcao_obter_arquivo",{p_ator:a.userId,p_id:id}).maybeSingle();
  if (r.error) return falha(503,"indisponivel","O balcão está indisponível.");
  const doc=r.data as {nome:string;storage_path:string}|null;
  await registrarAcessoDocumento(req,a,doc?.storage_path??"balcao/"+id,"baixar",doc && {
    nome:doc.nome,permitido:true,motivo:null,categoria:"documento",documentoId:id,requestId:null,propertyId:null,opportunityId:null,
  });
  if (!doc) return falha(404,"arquivo","Arquivo não encontrado.");
  const {data,error}=await db.storage.from("docs").download(doc.storage_path);
  if (error || !data) return falha(502,"armazenamento","Falha ao baixar o arquivo.");
  const nome=encodeURIComponent(doc.nome).replace(/['()*]/g,c=>"%"+c.charCodeAt(0).toString(16));
  return new Response(data.stream(),{headers:{
    "Content-Type":"application/octet-stream","Content-Length":String(data.size),
    "Content-Disposition":"attachment; filename*=UTF-8''"+nome,"Cache-Control":"private, no-store",
    "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",Vary:"Cookie",
  }});
}
