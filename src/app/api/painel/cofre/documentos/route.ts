import { ator } from "@/lib/authz";
import { temPerfilCofre } from "@/lib/cofre";
import { falha } from "@/lib/erros";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { ACEITA, conferirArquivo } from "@/lib/seguranca/arquivos";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { urlArquivo } from "@/lib/seguranca/link-arquivo";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function buscarImovel(req: Request) {
  const a = await ator();
  if (!a || !temPerfilCofre(a.role,a.nicho)) return falha(a ? 403 : 401,"sem_acesso","Entre com uma conta de proprietário ou produtor rural.");
  const id = new URL(req.url).searchParams.get("propriedade");
  if (!ehUuid(id)) return falha(400,"propriedade","Propriedade inválida.");
  const db = supabaseAdmin();
  const { data, error } = await db.from("cofre_propriedades").select("id").eq("titular_id",a.userId).eq("id",id).maybeSingle();
  if (error) return falha(503,"cofre_indisponivel","O cofre está indisponível.");
  if (!data) return falha(404,"propriedade","Propriedade não encontrada.");
  return { id, titular: a.userId, db };
}
export async function GET(req: Request) {
  const escopo = await buscarImovel(req);
  if (escopo instanceof Response) return escopo;
  const pagina = Number(new URL(req.url).searchParams.get("pagina") ?? 1);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 10_000_000) return falha(400, "pagina","Página inválida.");
  const { data, error } = await escopo.db.from("cofre_documentos").select("id,nome_arquivo,tamanho_bytes,storage_path")
    .eq("titular_id",escopo.titular).eq("propriedade_id",escopo.id).order("created_at",{ascending:false}).order("id")
    .range((pagina-1)*25,pagina*25);
  if (error) return falha(503,"cofre_indisponivel","Não foi possível consultar os documentos.");
  return Response.json({ documentos: data.slice(0,25).map(({storage_path,...d}) => ({ ...d, url:urlArquivo(storage_path,"baixar") })), temMais:data.length>25 });
}
const MAX_BYTES = 25 * 1024 * 1024;
export async function POST(req: Request) {
  const escopo = await buscarImovel(req);
  if (escopo instanceof Response) return escopo;
  const limite = await limitar("cofre-arquivo:" + escopo.titular,60,3600);
  if (!limite.permitido) return respostaLimite(limite,"anexar arquivos");
  let nome: string;
  try { nome = decodeURIComponent(req.headers.get("X-Nome-Arquivo") ?? "").replace(/[\u0000-\u001f\u007f/\\]/g,"").trim(); }
  catch { return falha(400,"nome","Nome de arquivo inválido."); }
  if (!nome || nome.length > 200 || !req.body) return falha(400,"arquivo","Selecione um arquivo.");
  if (Number(req.headers.get("content-length")) > MAX_BYTES) return falha(413,"tamanho","O limite por arquivo é 25 MB.");
  const partes: ArrayBuffer[] = [];
  const leitor = req.body.getReader();
  let tamanho = 0;
  try {
    while (true) {
      const { done,value } = await leitor.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > MAX_BYTES) { await leitor.cancel(); return falha(413,"tamanho","O limite por arquivo é 25 MB."); }
      partes.push(value.slice().buffer);
    }
  } catch { return falha(400,"arquivo","O envio do arquivo foi interrompido."); }
  finally { leitor.releaseLock(); }
  const conferido = await conferirArquivo(new File(partes,nome),ACEITA.documento,MAX_BYTES);
  if (!conferido.ok) return falha(400,"arquivo",conferido.erro);
  const id = crypto.randomUUID();
  const path = `cofre/${escopo.titular}/${escopo.id}/${id}.${conferido.arquivo.ext}`;
  const storage = escopo.db.storage.from("docs");
  const { error: up } = await storage.upload(path,conferido.arquivo.bytes,{contentType: conferido.arquivo.contentType, upsert:false});
  if (up) return falha(502,"armazenamento","Não foi possível guardar o documento.");
  const { error } = await escopo.db.from("cofre_documentos").insert({
    id,titular_id:escopo.titular,propriedade_id:escopo.id,storage_path:path,nome_arquivo:nome,tamanho_bytes:tamanho,
  });
  if (error) {
    // Em caso de resposta de rede perdida, a inserção pode ter sido confirmada.
    const consulta = await escopo.db.from("cofre_documentos").select("id").eq("id",id).eq("titular_id",escopo.titular).maybeSingle();
    if (!consulta.error && !consulta.data) await storage.remove([path]);
    if (!consulta.data) return falha(503,"armazenamento","Não foi possível confirmar o documento. Consulte a lista.");
  }
  return Response.json({ id });
}

export async function DELETE(req: Request) {
  const escopo = await buscarImovel(req);
  if (escopo instanceof Response) return escopo;
  const id = new URL(req.url).searchParams.get("id");
  if (!ehUuid(id)) return falha(400,"documento","Documento inválido.");
  const {error} = await escopo.db.from("cofre_documentos").delete()
    .eq("titular_id",escopo.titular).eq("propriedade_id",escopo.id).eq("id",id);
  return error ? falha(503,"cofre_indisponivel","Não foi possível excluir o documento.") : Response.json({ok:true});
}
