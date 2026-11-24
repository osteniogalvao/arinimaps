"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CACHE_TAGS_MARKETING } from "@/lib/tags-marketing-servidor";
import { LIMITE_CAMINHOS, normalizarRegra, problemaNoCodigo, type PosicaoTag } from "@/lib/tags-marketing";

export type DadosTag = {
  id?: string;
  nome: string;
  codigo: string;
  posicao: PosicaoTag;
  ativo: boolean;
  todas_paginas: boolean;
  paginas: string[];
  excluir: string[];
  observacao: string;
};

type Resposta = { erro?: string; id?: string };

const UUID = /^[0-9a-f-]{36}$/i;
const POSICOES: PosicaoTag[] = ["head", "body_inicio", "body_fim"];

/**
 * Só Marketing (produção ou tráfego) e Diretoria. Código de terceiros roda no
 * navegador de todos os visitantes, então esta é a única porta de entrada:
 * nada de policy no banco para o navegador, e cada mudança vai ao audit_log
 * com o código antes e depois.
 */
async function quemPode() {
  const user = await ator();
  if (!user || user.somenteLeitura || !temSetor(user, "marketing", "marketing_trafego", "diretoria")) return null;
  return user;
}

function limparLista(lista: unknown): string[] | string {
  if (!Array.isArray(lista)) return [];
  const saida = new Set<string>();
  for (const item of lista) {
    const r = normalizarRegra(String(item ?? ""));
    if (!r) return `Endereço inválido: "${String(item).slice(0, 80)}". Use o formato /pagina ou /pagina/** para incluir as subpáginas.`;
    saida.add(r);
  }
  if (saida.size > LIMITE_CAMINHOS) return `No máximo ${LIMITE_CAMINHOS} endereços por lista.`;
  return [...saida];
}

function invalidar() {
  revalidateTag(CACHE_TAGS_MARKETING, { expire: 0 });
  revalidatePath("/admin/marketing/tags");
}

export async function salvarTag(dados: DadosTag): Promise<Resposta> {
  const user = await quemPode();
  if (!user) return { erro: "Só o Marketing e a Diretoria podem instalar códigos no site." };
  const nome = String(dados.nome ?? "").trim();
  const codigo = String(dados.codigo ?? "").trim();
  const observacao = String(dados.observacao ?? "").trim().slice(0, 500);
  if (nome.length < 1 || nome.length > 120) return { erro: "Dê um nome ao código (ex.: Meta Pixel, Google Tag Manager)." };
  const problema = problemaNoCodigo(codigo);
  if (problema) return { erro: problema };
  if (!POSICOES.includes(dados.posicao)) return { erro: "Escolha onde o código entra na página." };
  const paginas = limparLista(dados.paginas);
  if (typeof paginas === "string") return { erro: paginas };
  const excluir = limparLista(dados.excluir);
  if (typeof excluir === "string") return { erro: excluir };
  const todas = !!dados.todas_paginas;
  if (!todas && !paginas.length) return { erro: "Escolha ao menos uma página, ou marque “Todas as páginas”." };

  const linha = {
    nome, codigo, observacao, posicao: dados.posicao, ativo: !!dados.ativo,
    todas_paginas: todas, paginas: todas ? [] : paginas, excluir,
    updated_by: user.userId, updated_at: new Date().toISOString(),
  };
  const admin = supabaseAdmin();

  if (dados.id) {
    if (!UUID.test(dados.id)) return { erro: "Código não encontrado." };
    const { data: antes } = await admin.from("marketing_tags").select("*").eq("id", dados.id).maybeSingle();
    if (!antes) return { erro: "Código não encontrado. Recarregue a página." };
    const { error } = await admin.from("marketing_tags").update(linha).eq("id", dados.id);
    if (error) return { erro: "Não foi possível salvar. Tente novamente." };
    await logAudit({ user_id: user.userId, acao: "marketing_tag_editada", entidade: "marketing_tags", entidade_id: dados.id, dados_antes: antes, dados_depois: linha });
    invalidar();
    return { id: dados.id };
  }

  const { data, error } = await admin.from("marketing_tags").insert({ ...linha, created_by: user.userId }).select("id").single();
  if (error || !data) return { erro: error?.message.includes("marketing_tags") ? "Falta rodar a migration 0172 no banco." : "Não foi possível salvar. Tente novamente." };
  await logAudit({ user_id: user.userId, acao: "marketing_tag_criada", entidade: "marketing_tags", entidade_id: data.id, dados_depois: linha });
  invalidar();
  return { id: data.id };
}

export async function ligarTag(id: string, ativo: boolean): Promise<Resposta> {
  const user = await quemPode();
  if (!user) return { erro: "Só o Marketing e a Diretoria podem alterar os códigos do site." };
  if (!UUID.test(id)) return { erro: "Código não encontrado." };
  const { error } = await supabaseAdmin().from("marketing_tags")
    .update({ ativo: !!ativo, updated_by: user.userId, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { erro: "Não foi possível alterar. Tente novamente." };
  await logAudit({ user_id: user.userId, acao: ativo ? "marketing_tag_ativada" : "marketing_tag_desativada", entidade: "marketing_tags", entidade_id: id });
  invalidar();
  return { id };
}

export async function excluirTag(id: string): Promise<Resposta> {
  const user = await quemPode();
  if (!user) return { erro: "Só o Marketing e a Diretoria podem remover códigos do site." };
  if (!UUID.test(id)) return { erro: "Código não encontrado." };
  const admin = supabaseAdmin();
  const { data: antes } = await admin.from("marketing_tags").select("*").eq("id", id).maybeSingle();
  if (!antes) return { erro: "Código não encontrado. Recarregue a página." };
  const { error } = await admin.from("marketing_tags").delete().eq("id", id);
  if (error) return { erro: "Não foi possível remover. Tente novamente." };
  await logAudit({ user_id: user.userId, acao: "marketing_tag_removida", entidade: "marketing_tags", entidade_id: id, dados_antes: antes });
  invalidar();
  return { id };
}
