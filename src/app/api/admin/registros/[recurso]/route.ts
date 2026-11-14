import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator } from "@/lib/authz";
import { recursoPorId } from "@/lib/registros";
import {
  antesCriar, depoisCriar, ehUuid, ErroRegistro, executorDe, podeEscrever, validarRegistro,
} from "@/lib/registros-servidor";
import "@/lib/modulos";

/**
 * Cadastros da Central (src/lib/registros.ts): criar (POST), editar ou
 * executar uma ação (PATCH) e excluir (DELETE, só onde o cadastro permite).
 */
type Ctx = RouteContext<"/api/admin/registros/[recurso]">;

function falha(e: unknown) {
  if (e instanceof ErroRegistro) return NextResponse.json({ error: e.mensagem }, { status: e.status });
  console.error("registros:", e);
  return NextResponse.json({ error: "Não foi possível salvar." }, { status: 500 });
}

async function preparar(ctx: Ctx) {
  const { recurso: id } = await ctx.params;
  const r = recursoPorId(id);
  if (!r) throw new ErroRegistro("Cadastro inexistente.", 404);
  const a = await ator();
  if (!podeEscrever(a, r)) throw new ErroRegistro("Você não tem acesso a este cadastro.", 403);
  return { r, a: a! };
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { r, a } = await preparar(ctx);
    const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const linha = validarRegistro(r, corpo, true);
    await antesCriar(r.id)?.(a, linha);
    if (r.autorColuna && linha[r.autorColuna] === undefined) linha[r.autorColuna] = a.userId;
    const admin = supabaseAdmin();
    const { data, error } = await admin.from(r.tabela).insert(linha).select("*").single();
    if (error) {
      if (error.code === "23505") throw new ErroRegistro("Já existe um registro com esses dados.");
      if (error.code === "42P01") throw new ErroRegistro("Falta rodar a migration deste módulo no banco.", 503);
      throw new ErroRegistro(error.message);
    }
    await logAudit({ user_id: a.userId, acao: `${r.tabela}_criado`, entidade: r.tabela, entidade_id: data.id, dados_depois: data });
    await depoisCriar(r.id)?.(a, data);
    return NextResponse.json({ ok: true, id: data.id });
  } catch (e) { return falha(e); }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { r, a } = await preparar(ctx);
    const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!ehUuid(corpo.id)) throw new ErroRegistro("Registro inválido.");
    const admin = supabaseAdmin();
    const { data: antes } = await admin.from(r.tabela).select("*").eq("id", corpo.id).maybeSingle();
    if (!antes) throw new ErroRegistro("Registro não encontrado.", 404);

    let mudanca: Record<string, unknown> | null;
    let acaoAudit = `${r.tabela}_editado`;
    const acao = typeof corpo.acao === "string" ? corpo.acao : "";
    if (acao) {
      const def = r.acoes?.find((x) => x.id === acao);
      const exec = executorDe(r.id, acao);
      if (!def || !exec) throw new ErroRegistro("Ação inválida.");
      const status = r.status ? String(antes[r.status.coluna]) : "";
      if (r.status && !def.quando.includes(status)) throw new ErroRegistro("Esta ação não vale para a situação atual.");
      const motivo = String(corpo.motivo ?? "").trim().slice(0, 1000);
      if (def.pedeMotivo && motivo.length < 5) throw new ErroRegistro("Explique o motivo (pelo menos 5 letras).");
      mudanca = await exec({ ator: a, recurso: r, id: corpo.id, linha: antes, motivo, admin });
      acaoAudit = `${r.tabela}_${acao}`;
    } else {
      // edição: não mexe em registro que já saiu do fluxo aberto
      const editaveis = r.status?.editaveis ?? r.status?.abertos;
      if (r.status && editaveis && !editaveis.includes(String(antes[r.status.coluna]))) {
        throw new ErroRegistro("Este registro não permite edição na situação atual.");
      }
      mudanca = validarRegistro(r, corpo, false);
    }
    if (mudanca && Object.keys(mudanca).length) {
      let escrita = admin.from(r.tabela).update(mudanca).eq("id", corpo.id);
      if (r.id === "publicacoes" || r.id === "notas-fiscais") escrita = escrita.eq("updated_at", antes.updated_at);
      const { data: gravada, error } = await escrita.select("id").maybeSingle();
      if (error) throw new ErroRegistro(error.message);
      if (!gravada) throw new ErroRegistro("O registro foi alterado. Atualize a página.", 409);
    }
    await logAudit({ user_id: a.userId, acao: acaoAudit, entidade: r.tabela, entidade_id: corpo.id, dados_antes: antes, dados_depois: mudanca });
    return NextResponse.json({ ok: true });
  } catch (e) { return falha(e); }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const { r, a } = await preparar(ctx);
    if (!r.excluir) throw new ErroRegistro("Este cadastro não permite excluir; desative ou cancele.");
    const id = new URL(request.url).searchParams.get("id");
    if (!ehUuid(id)) throw new ErroRegistro("Registro inválido.");
    const { error } = await supabaseAdmin().from(r.tabela).delete().eq("id", id);
    if (error) throw new ErroRegistro(error.code === "23503" ? "Este registro está em uso e não pode ser excluído." : error.message);
    await logAudit({ user_id: a.userId, acao: `${r.tabela}_excluido`, entidade: r.tabela, entidade_id: id });
    return NextResponse.json({ ok: true });
  } catch (e) { return falha(e); }
}
