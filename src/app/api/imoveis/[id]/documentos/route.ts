import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { registrarEventoImovel } from "@/lib/imovel/eventos";
import { urlArquivo } from "@/lib/seguranca/link-arquivo";
import { ACEITA, conferirArquivo } from "@/lib/seguranca/arquivos";
import { recusaPorArmazenamento } from "@/lib/armazenamento";

async function podeEditarImovel(a: NonNullable<Awaited<ReturnType<typeof ator>>>, propertyId: string) {
  // equipe: os setores que tratam documentos (o mesmo mapa de /api/arquivos)
  if (a.ehArini) return temSetor(a, "operacoes", "juridico", "cartografia");
  const { data: p } = await supabaseAdmin()
    .from("properties").select("owner_id, partner_id").eq("id", propertyId).single();
  if (!p) return false;
  return (a.ownerId && p.owner_id === a.ownerId) || (a.partnerId && p.partner_id === a.partnerId);
}

// Upload de documento do imóvel (matrícula, CAR, ITR, DWG, autorização) — bucket privado.
export async function POST(request: Request, ctx: RouteContext<"/api/imoveis/[id]/documentos">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (!(await podeEditarImovel(a, id))) return NextResponse.json({ error: "Sem acesso a este imóvel." }, { status: 403 });

  const form = await request.formData();
  const arquivo = form.get("arquivo");
  const tipo = String(form.get("tipo") ?? "outro");
  if (!(arquivo instanceof File)) return NextResponse.json({ error: "Envie o arquivo." }, { status: 400 });
  // o tipo entra no caminho do arquivo: só letras e "_" (nada de "../" nem "/")
  if (!/^[a-z_]{1,40}$/.test(tipo)) return NextResponse.json({ error: "Tipo de documento inválido." }, { status: 400 });
  // tipo real pelos primeiros bytes, não pelo que o navegador declara (auditoria 6.2)
  const conferido = await conferirArquivo(arquivo, ACEITA.documento, 25 * 1024 * 1024);
  if (!conferido.ok) return NextResponse.json({ error: conferido.erro }, { status: 400 });

  if (!a!.ehArini) {
    const cota = await recusaPorArmazenamento(a!.userId, a!.acesso, conferido.arquivo.bytes.byteLength);
    if (cota) return NextResponse.json({ error: cota }, { status: 413 });
  }
  const admin = supabaseAdmin();
  const path = `imoveis/${id}/${tipo}-${crypto.randomUUID()}.${conferido.arquivo.ext}`;
  const { error: upError } = await admin.storage.from("docs")
    .upload(path, conferido.arquivo.bytes, { contentType: conferido.arquivo.contentType });
  if (upError) return NextResponse.json({ error: upError.message }, { status: 500 });

  const { data: doc, error } = await admin.from("property_documents")
    .insert({ property_id: id, tipo, storage_path: path, nome_arquivo: arquivo.name, enviado_por: a.userId })
    .select("id, versao").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 5.8: reenvio do mesmo tipo vira versão nova; a anterior fica guardada
  // (gatilhos fn_doc_versao / fn_doc_substitui, migration 0035)
  await logAudit({ user_id: a.userId, acao: doc.versao > 1 ? "documento_nova_versao" : "documento_anexado", entidade: "property_documents", entidade_id: doc.id, property_id: id, dados_depois: { tipo, nome: arquivo.name, versao: doc.versao } });
  void registrarEventoImovel({ propertyId: id, tipo: "documento", userId: a.userId, partnerId: a.partnerId, request, detalhe: { acao: "upload", tipo, nome: arquivo.name } });
  return NextResponse.json({ ok: true, versao: doc.versao });
}

// Lista documentos. O link passa por /api/arquivos, que confere a permissão a
// cada clique e registra quem abriu (6.3) — nunca a URL assinada direto.
// `documentos` = versões vigentes. Com `?versoes=1`, `anteriores` traz as
// versões substituídas (5.8); a equipe vê também quem enviou cada uma.
export async function GET(_request: Request, ctx: RouteContext<"/api/imoveis/[id]/documentos">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (!(await podeEditarImovel(a, id))) return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  const comVersoes = new URL(_request.url).searchParams.get("versoes") === "1";

  const admin = supabaseAdmin();
  const { data: todos } = await admin.from("property_documents")
    .select("id, tipo, storage_path, nome_arquivo, verificado, verificado_em, created_at, versao, substituido_por, substituido_em, enviado_por")
    .eq("property_id", id).order("created_at");
  const docs = (todos ?? []).filter((d) => !d.substituido_por);
  const { data: imovel } = await admin.from("properties").select("modalidade").eq("id", id).maybeSingle();
  const out = [];
  for (const d of docs) {
    out.push({ ...d, conferir_exclusividade: d.tipo === "autorizacao" && imovel?.modalidade !== "leilao", url: urlArquivo(d.storage_path) });
  }
  let anteriores: Record<string, unknown>[] | undefined;
  if (comVersoes) {
    const velhos = (todos ?? []).filter((d) => d.substituido_por);
    const ids = [...new Set(velhos.map((d) => d.enviado_por).filter(Boolean))] as string[];
    const { data: nomes } = a.ehArini && ids.length
      ? await admin.from("profiles").select("user_id, nome").in("user_id", ids)
      : { data: [] as { user_id: string; nome: string }[] };
    const nome = new Map((nomes ?? []).map((n) => [n.user_id, n.nome]));
    anteriores = [];
    for (const d of velhos.reverse()) {
      anteriores.push({
        ...d, url: urlArquivo(d.storage_path),
        enviado_por_nome: a.ehArini && d.enviado_por ? nome.get(d.enviado_por) ?? null : undefined,
      });
    }
  }
  // §1.1: abertura da lista (com links assinados) é acesso aos documentos
  if (out.length) {
    void registrarEventoImovel({
      propertyId: id, tipo: "documento", userId: a.userId, partnerId: a.partnerId, request: _request,
      detalhe: { acao: "visualizacao", tipo: out.map((d) => d.tipo).join(","), nome: `${out.length} documento(s)` },
    });
  }
  return NextResponse.json(anteriores ? { documentos: out, anteriores } : { documentos: out });
}

/**
 * Conferência da Arini: marca (ou desmarca) um documento como conferido.
 * Aprovar e publicar o imóvel dependem disso — ver /api/admin/decisao.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/imoveis/[id]/documentos">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a || !temSetor(a, "operacoes", "juridico")) {
    return NextResponse.json({ error: "A conferência de documentos é dos setores de Operações e Jurídico." }, { status: 403 });
  }

  const { documento_id, verificado, assinada_em, prazo_meses } = await request.json().catch(() => ({}));
  if (!documento_id || typeof verificado !== "boolean") {
    return NextResponse.json({ error: "Informe documento_id e verificado." }, { status: 400 });
  }
  const admin = supabaseAdmin();
  const [arquivo, imovel] = await Promise.all([
    admin.from("property_documents").select("tipo").eq("id",documento_id).eq("property_id",id).is("substituido_por",null).maybeSingle(),
    admin.from("properties").select("modalidade").eq("id",id).maybeSingle(),
  ]);
  if (arquivo.error || imovel.error) return NextResponse.json({ error:"Não foi possível conferir o imóvel." },{status:503});
  if (!arquivo.data || !imovel.data) return NextResponse.json({ error:"Documento vigente não encontrado." },{status:404});
  const termo = verificado && arquivo.data.tipo === "autorizacao" && imovel.data.modalidade !== "leilao";
  const hoje = new Date().toLocaleDateString("sv-SE",{timeZone:"America/Sao_Paulo"});
  if (termo && (typeof assinada_em !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(assinada_em) ||
    !Number.isFinite(Date.parse(assinada_em)) || new Date(assinada_em).toISOString().slice(0,10)!==assinada_em ||
    assinada_em>hoje || ![6,12].includes(prazo_meses))) {
    return NextResponse.json({error:"Confira no termo exclusivo a data de assinatura e o prazo de 180 dias ou 12 meses."},{status:400});
  }
  const { data: doc, error } = await admin.from("property_documents")
    .update({
      exclusividade_assinada_em: termo ? assinada_em : null,
      exclusividade_meses: termo ? prazo_meses : null,
      verificado,
      verificado_por: verificado ? a.userId : null,
      verificado_em: verificado ? new Date().toISOString() : null,
    })
    .eq("id", documento_id).eq("property_id", id).is("substituido_por",null)
    .select("id, tipo").single();
  if (error || !doc) return NextResponse.json({ error: "Documento não encontrado neste imóvel." }, { status: 404 });

  await logAudit({
    user_id: a.userId, acao: verificado ? "documento_conferido" : "documento_desconferido",
    entidade: "property_documents", entidade_id: doc.id, property_id: id, dados_depois: { tipo: doc.tipo, ...(termo ? { assinada_em, prazo_meses } : {}) },
  });
  return NextResponse.json({ ok: true });
}
