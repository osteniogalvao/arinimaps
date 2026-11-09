import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, type Ator } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { urlArquivo } from "@/lib/seguranca/link-arquivo";
import { ehAnuncianteDoImovel, podeVerAreaDoImovel } from "@/lib/acompanhamento/servidor";
import { CATEGORIAS_DESENHO, medir, validarGeometria } from "@/lib/imovel/minhaArea";

/**
 * Minha área (item 29): desenhos de trabalho do anunciante sobre a divisa.
 * Ver: o dono e a Central. Desenhar e apagar: só o dono.
 *
 *   GET                                  → { disponivel, divisa, desenhos, arquivos }
 *   POST   { nome, categoria, cor, geojson, notas? }
 *   PATCH  { id, nome?, categoria?, cor?, notas?, geojson? }
 *   DELETE ?desenho=<id>
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DESENHOS = 300;
const CAMPOS = "id, nome, categoria, cor, notas, geojson, area_m2, comprimento_m, created_at";

async function contexto(id: string, escrita: boolean): Promise<{ a: Ator } | { erro: NextResponse }> {
  if (!UUID.test(id)) return { erro: falha(400, "dados_invalidos", "Imóvel inválido.") };
  const a = await ator();
  if (!a) return { erro: falha(401, "sem_sessao", "Sessão expirada.") };
  const pode = escrita ? await ehAnuncianteDoImovel(a, id) : await podeVerAreaDoImovel(a, id);
  if (!pode) return { erro: falha(403, "sem_acesso", "Só o dono do imóvel e a Central acessam a Minha área.") };
  if (escrita) {
    const l = await limitar(`minha-area:${a.userId}`, 240, 3600);
    if (!l.permitido) return { erro: respostaLimite(l, "salvar desenhos") };
  }
  return { a };
}

type Corpo = { id?: unknown; nome?: unknown; categoria?: unknown; cor?: unknown; notas?: unknown; geojson?: unknown };

/** Valida os campos enviados; `parcial` aceita só parte deles (PATCH). */
function lerCampos(b: Corpo, parcial: boolean): { ok: true; dados: Record<string, unknown> } | { ok: false; erro: string } {
  const dados: Record<string, unknown> = {};
  if (!parcial || "nome" in b) {
    const nome = String(b.nome ?? "").trim();
    if (!nome || nome.length > 120) return { ok: false, erro: "Dê um nome ao desenho (até 120 caracteres)." };
    dados.nome = nome;
  }
  if (!parcial || "categoria" in b) {
    const c = String(b.categoria ?? "outro");
    if (!(CATEGORIAS_DESENHO as readonly string[]).includes(c)) return { ok: false, erro: "Categoria inválida." };
    dados.categoria = c;
  }
  if (!parcial || "cor" in b) {
    const cor = String(b.cor ?? "#D9BD6F");
    if (!/^#[0-9A-Fa-f]{6}$/.test(cor)) return { ok: false, erro: "Cor inválida." };
    dados.cor = cor.toUpperCase();
  }
  if ("notas" in b) {
    const n = String(b.notas ?? "").trim();
    if (n.length > 2000) return { ok: false, erro: "As notas passam de 2.000 caracteres." };
    dados.notas = n || null;
  }
  if (!parcial || "geojson" in b) {
    const g = validarGeometria(b.geojson);
    if (!g) return { ok: false, erro: "Desenho inválido: use ponto, linha ou polígono com até 2.000 vértices." };
    dados.geojson = g;
    Object.assign(dados, medir(g));
  }
  return { ok: true, dados };
}

export async function GET(_request: Request, ctx: RouteContext<"/api/imoveis/[id]/minha-area">) {
  const { id } = await ctx.params;
  const c = await contexto(id, false);
  if ("erro" in c) return c.erro;
  const admin = supabaseAdmin();
  const [{ data: geo }, desenhos, arquivos] = await Promise.all([
    admin.from("property_geometries").select("geom").eq("property_id", id).limit(1).maybeSingle(),
    admin.from("property_area_desenhos").select(CAMPOS).eq("property_id", id).order("created_at").limit(MAX_DESENHOS),
    admin.from("property_area_arquivos").select("id, desenho_id, nome_arquivo, tamanho_bytes, storage_path, created_at")
      .eq("property_id", id).order("created_at").limit(500),
  ]);
  // migration 0060 ainda não aplicada: a tela esconde o recurso
  if (desenhos.error || arquivos.error) return NextResponse.json({ disponivel: false, divisa: geo?.geom ?? null, desenhos: [], arquivos: [] });
  return NextResponse.json({
    disponivel: true,
    divisa: geo?.geom ?? null,
    desenhos: desenhos.data ?? [],
    arquivos: (arquivos.data ?? []).map(({ storage_path, ...r }) => ({ ...r, url: urlArquivo(storage_path) })),
  });
}

export async function POST(request: Request, ctx: RouteContext<"/api/imoveis/[id]/minha-area">) {
  const { id } = await ctx.params;
  const c = await contexto(id, true);
  if ("erro" in c) return c.erro;
  const b = (await request.json().catch(() => null)) as Corpo | null;
  if (!b) return falha(400, "dados_invalidos", "Envie o desenho.");
  const v = lerCampos(b, false);
  if (!v.ok) return falha(400, "dados_invalidos", v.erro);
  const admin = supabaseAdmin();
  const { count } = await admin.from("property_area_desenhos").select("id", { count: "exact", head: true }).eq("property_id", id);
  if ((count ?? 0) >= MAX_DESENHOS) return falha(400, "limite", `Limite de ${MAX_DESENHOS} desenhos por imóvel.`);
  const { data, error } = await admin.from("property_area_desenhos")
    .insert({ ...v.dados, property_id: id, criado_por: c.a.userId }).select(CAMPOS).single();
  if (error) return falha(503, "banco", "Não foi possível salvar o desenho.", { motivo: error.message });
  return NextResponse.json({ ok: true, desenho: data });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/imoveis/[id]/minha-area">) {
  const { id } = await ctx.params;
  const c = await contexto(id, true);
  if ("erro" in c) return c.erro;
  const b = (await request.json().catch(() => null)) as Corpo | null;
  const desenho = String(b?.id ?? "");
  if (!b || !UUID.test(desenho)) return falha(400, "dados_invalidos", "Desenho inválido.");
  const v = lerCampos(b, true);
  if (!v.ok) return falha(400, "dados_invalidos", v.erro);
  if (!Object.keys(v.dados).length) return falha(400, "sem_mudanca", "Nada para alterar.");
  const { data, error } = await supabaseAdmin().from("property_area_desenhos")
    .update(v.dados).eq("id", desenho).eq("property_id", id).select(CAMPOS).maybeSingle();
  if (error) return falha(500, "banco", "Não foi possível salvar.", { motivo: error.message });
  if (!data) return falha(404, "nao_encontrado", "Desenho não encontrado.");
  return NextResponse.json({ ok: true, desenho: data });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/imoveis/[id]/minha-area">) {
  const { id } = await ctx.params;
  const c = await contexto(id, true);
  if ("erro" in c) return c.erro;
  const desenho = new URL(request.url).searchParams.get("desenho") ?? "";
  if (!UUID.test(desenho)) return falha(400, "dados_invalidos", "Desenho inválido.");
  // os arquivos do desenho continuam, ligados ao imóvel (on delete set null)
  const { error } = await supabaseAdmin().from("property_area_desenhos").delete().eq("id", desenho).eq("property_id", id);
  if (error) return falha(500, "banco", "Não foi possível apagar.", { motivo: error.message });
  return NextResponse.json({ ok: true });
}
