import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { falta0156, SETORES_ATENDIMENTO } from "@/lib/atendimento";
import type { SetorId } from "@/lib/setores";
import { validarHorario, type HorarioSetor } from "@/lib/atendimento-horario";

/**
 * Configuração do Atendimento (Diretoria):
 *   { acao: "menu", ativo, saudacao, confirmacao, nao_entendi, fora_expediente, max_tentativas, setor_escape, expira_minutos, reenviar_apos_horas, ari_ativo?, ari_limite_dia? }
 *   { acao: "opcao", id?, chave, rotulo, setor, responsavel?, etiqueta?, confirmacao?, ordem, ativo, acao_opcao? ("setor" | "ari", 0170) }
 *   { acao: "remover_opcao", id }
 *   { acao: "resposta", id?, atalho, titulo, texto, setor? } · { acao: "remover_resposta", id }
 *   { acao: "recepcao", user_id, ativo }
 *   { acao: "prazo", minutos }
 *   { acao: "horario", setor, dias, inicio, fim, prazo_minutos, mensagem_fora }   (0171)
 *   { acao: "remover_horario", setor } · { acao: "chat_site", ativo }             (0171)
 */
class Erro extends Error { constructor(public msg: string, public status = 400) { super(msg); } }
const UUID = /^[0-9a-f-]{36}$/i;
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const setorOuNulo = (v: unknown) => {
  const s = String(v ?? "");
  if (!s) return null;
  if (!SETORES_ATENDIMENTO.includes(s as SetorId)) throw new Erro("Setor inválido.");
  return s;
};
const int = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

export async function POST(request: Request) {
  try {
    const a = await ator();
    if (!temSetor(a, "diretoria")) throw new Erro("Só a Diretoria configura o atendimento.", 403);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const admin = supabaseAdmin();
    const conferir = (r: { error: { code?: string; message: string } | null }) => {
      if (r.error?.code === "23505") throw new Erro("Já existe um registro com essa chave/atalho.", 409);
      if (r.error?.code === "23514") throw new Erro("Valor fora do permitido.");
      if (r.error) throw new Erro(falta0156(r.error.message) ? "Falta rodar a migration 0156 (Atendimento)." : "Falha ao gravar.", 503);
    };
    switch (String(b.acao ?? "")) {
      case "menu": {
        const saudacao = txt(b.saudacao, 1000);
        if (!saudacao) throw new Erro("Escreva a saudação do menu.");
        // Ari no WhatsApp (0170): só grava quando a tela manda (antes da migration ela não manda)
        const ari = typeof b.ari_ativo === "boolean" ? { ari_ativo: b.ari_ativo, ari_limite_dia: int(b.ari_limite_dia, 1, 500, 40) } : {};
        conferir(await admin.from("atendimento_menu").update({
          ...ari,
          ativo: b.ativo !== false, saudacao, confirmacao: txt(b.confirmacao, 1000) || "Seu atendimento foi encaminhado para {{setor}}.",
          nao_entendi: txt(b.nao_entendi, 500) || "Não entendi. Responda só com o número:", fora_expediente: txt(b.fora_expediente, 1000),
          max_tentativas: int(b.max_tentativas, 1, 5, 2), setor_escape: setorOuNulo(b.setor_escape),
          expira_minutos: int(b.expira_minutos, 5, 10080, 720), reenviar_apos_horas: int(b.reenviar_apos_horas, 1, 720, 12),
          updated_at: new Date().toISOString(),
        }).eq("id", 1));
        break;
      }
      case "opcao": {
        const chave = txt(b.chave, 3).toLowerCase();
        const rotulo = txt(b.rotulo, 120);
        if (!/^\w{1,3}$/.test(chave) || !rotulo) throw new Erro("Informe a tecla (1 a 3 caracteres) e o texto da opção.");
        const responsavel = b.responsavel && UUID.test(String(b.responsavel)) ? String(b.responsavel) : null;
        const linha = {
          chave, rotulo, setor: setorOuNulo(b.setor), responsavel, etiqueta: txt(b.etiqueta, 30).toLowerCase() || null,
          confirmacao: txt(b.confirmacao, 1000) || null, ordem: int(b.ordem, 0, 99, 0), ativo: b.ativo !== false,
          ...(b.acao_opcao === "ari" || b.acao_opcao === "setor" ? { acao: b.acao_opcao } : {}),
        };
        if (linha.acao === "ari") { linha.setor = null; linha.responsavel = null; }
        conferir(b.id && UUID.test(String(b.id))
          ? await admin.from("atendimento_menu_opcoes").update(linha).eq("id", String(b.id))
          : await admin.from("atendimento_menu_opcoes").insert(linha));
        break;
      }
      case "remover_opcao":
        if (!UUID.test(String(b.id))) throw new Erro("Opção inválida.");
        conferir(await admin.from("atendimento_menu_opcoes").delete().eq("id", String(b.id)));
        break;
      case "resposta": {
        const atalho = txt(b.atalho, 30).toLowerCase();
        const titulo = txt(b.titulo, 80), texto = txt(b.texto, 4000);
        if (!/^[a-z0-9_-]{2,30}$/.test(atalho)) throw new Erro("Atalho: 2 a 30 letras minúsculas, números, - ou _.");
        if (!titulo || !texto) throw new Erro("Preencha título e texto.");
        const linha = { atalho, titulo, texto, setor: setorOuNulo(b.setor) };
        conferir(b.id && UUID.test(String(b.id))
          ? await admin.from("atendimento_respostas").update(linha).eq("id", String(b.id))
          : await admin.from("atendimento_respostas").insert({ ...linha, criado_por: a!.userId }));
        break;
      }
      case "remover_resposta":
        if (!UUID.test(String(b.id))) throw new Erro("Resposta inválida.");
        conferir(await admin.from("atendimento_respostas").delete().eq("id", String(b.id)));
        break;
      case "recepcao": {
        if (!UUID.test(String(b.user_id))) throw new Erro("Pessoa inválida.");
        conferir(await admin.from("profiles").update({ atendimento_recepcao: b.ativo === true }).eq("user_id", String(b.user_id))
          .in("role", ["admin_central", "analista_arini"]));
        break;
      }
      case "prazo":
        conferir(await admin.from("settings").upsert({ chave: "atendimento_prazo_minutos", valor: int(b.minutos, 5, 1440, 30), updated_at: new Date().toISOString() }));
        break;
      case "horario": {
        const setor = setorOuNulo(b.setor);
        if (!setor) throw new Erro("Escolha o setor.");
        const h: Partial<HorarioSetor> = {
          dias: Array.isArray(b.dias) ? [...new Set(b.dias.map(Number))].sort() : [],
          inicio: String(b.inicio ?? ""), fim: String(b.fim ?? ""),
          prazo_minutos: Math.trunc(Number(b.prazo_minutos)), mensagem_fora: txt(b.mensagem_fora, 1000),
        };
        const problema = validarHorario(h);
        if (problema) throw new Erro(problema);
        const r = await admin.from("atendimento_setores_horario").upsert({ setor, ...h, updated_by: a!.userId, updated_at: new Date().toISOString() });
        if (r.error && /atendimento_setores_horario/.test(r.error.message)) throw new Erro("Falta rodar a migration 0171 (horários do atendimento).", 503);
        conferir(r);
        break;
      }
      case "remover_horario": {
        const setor = setorOuNulo(b.setor);
        if (!setor) throw new Erro("Escolha o setor.");
        conferir(await admin.from("atendimento_setores_horario").delete().eq("setor", setor));
        break;
      }
      case "chat_site":
        conferir(await admin.from("settings").upsert({ chave: "atendimento_chat_site", valor: b.ativo === true, updated_at: new Date().toISOString() }));
        break;
      default:
        throw new Erro("Ação desconhecida.");
    }
    await logAudit({ user_id: a!.userId, acao: "atendimento_config", entidade: "atendimento", dados_depois: { acao: b.acao } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Erro) return NextResponse.json({ error: e.msg }, { status: e.status });
    console.error("atendimento config:", e);
    return NextResponse.json({ error: "Falha inesperada." }, { status: 500 });
  }
}
