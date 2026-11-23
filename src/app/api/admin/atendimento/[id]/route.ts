import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor, type Ator } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { notificar } from "@/lib/notificacoes";
import { enviarWhatsapp, MetaErro, whatsappConfigurado } from "@/lib/meta";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { prazoDaEtapa, type Etapa } from "@/lib/crmSetores";
import { setoresDe, type SetorId } from "@/lib/setores";
import {
  eventoAtendimento, falta0156, nomeSetor, papelAtendimento, podeTriar, podeVer, SETORES_ATENDIMENTO,
  type Conversa,
} from "@/lib/atendimento";

/**
 * Uma conversa do Atendimento (migration 0156).
 *   GET  → conversa, mensagens, histórico, equipe, respostas prontas
 *   POST { acao: "responder", texto }
 *        { acao: "transferir", setor (""=caixa central), responsavel?, motivo? }   (triagem também)
 *        { acao: "assumir" } · { acao: "devolver", motivo? } · { acao: "resolver" } · { acao: "reabrir" } · { acao: "pendente" }
 *        { acao: "nota", texto } · { acao: "etiquetas", etiquetas: string[] }
 *        { acao: "criar_lead", codigo_imovel, rodizio?: boolean }      (Comercial)
 *        { acao: "abrir_crm", pipeline_id, titulo? }                     (funil do setor)
 */
class Erro extends Error { constructor(public msg: string, public status = 400) { super(msg); } }
const UUID = /^[0-9a-f-]{36}$/i;

async function carregar(id: string, a: Ator | null) {
  if (!a?.ehArini) throw new Erro("Restrito à equipe.", 403);
  if (!UUID.test(id)) throw new Erro("Conversa inválida.", 404);
  const { data, error } = await supabaseAdmin().from("atendimento_conversas").select("*").eq("id", id).maybeSingle();
  if (error) throw new Erro(falta0156(error.message) ? "Falta rodar a migration 0156 (Atendimento)." : "Falha ao carregar a conversa.", 503);
  if (!data) throw new Erro("Conversa não encontrada.", 404);
  const papel = await papelAtendimento(a);
  const c = data as Conversa;
  if (!podeVer(a, papel, c)) throw new Erro("Esta conversa é de outra fila.", 403);
  return { c, papel };
}

function resposta(e: unknown) {
  if (e instanceof Erro) return NextResponse.json({ error: e.msg }, { status: e.status });
  if (e instanceof MetaErro) return NextResponse.json({ error: e.mensagem }, { status: 400 });
  console.error("atendimento:", e);
  return NextResponse.json({ error: "Falha inesperada." }, { status: 500 });
}

export async function GET(_request: Request, ctx: RouteContext<"/api/admin/atendimento/[id]">) {
  try {
    const a = await ator();
    const { id } = await ctx.params;
    const { c, papel } = await carregar(id, a);
    const admin = supabaseAdmin();
    const [msgs, evs, equipe, respostas, opp, item, perfil] = await Promise.all([
      admin.from("whatsapp_mensagens").select("id, direcao, tipo, texto, status, erro, enviado_por, created_at")
        .eq("conversa_id", c.id).order("created_at", { ascending: false }).limit(300),
      admin.from("atendimento_eventos").select("id, acao, de_setor, para_setor, de_user, para_user, texto, autor, created_at")
        .eq("conversa_id", c.id).order("created_at", { ascending: false }).limit(200),
      admin.from("profiles").select("user_id, nome, role, setores").in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("nome"),
      admin.from("atendimento_respostas").select("id, atalho, titulo, texto, setor").order("atalho"),
      c.opportunity_id ? admin.from("opportunities").select("id, codigo, etapa").eq("id", c.opportunity_id).maybeSingle() : Promise.resolve({ data: null }),
      c.crm_item_id ? admin.from("crm_itens").select("id, codigo, titulo, status").eq("id", c.crm_item_id).maybeSingle() : Promise.resolve({ data: null }),
      c.perfil_user_id ? admin.from("profiles").select("user_id, nome, role, email").eq("user_id", c.perfil_user_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const pipelines = c.setor
      ? (await admin.from("crm_pipelines").select("id, nome").eq("setor", c.setor).order("nome")).data ?? []
      : [];
    if (c.nao_lidas) await admin.from("atendimento_conversas").update({ nao_lidas: 0 }).eq("id", c.id);
    const pessoas = (equipe.data ?? []).map((p) => ({ user_id: p.user_id as string, nome: (p.nome as string) || "Sem nome", setores: setoresDe(p.role as string, p.setores as string[] | null) }));
    return NextResponse.json({
      conversa: c, papel, eu: a!.userId, configurado: whatsappConfigurado(),
      mensagens: (msgs.data ?? []).reverse(), eventos: (evs.data ?? []).reverse(),
      equipe: pessoas,
      respostas: (respostas.data ?? []).filter((r) => !r.setor || r.setor === c.setor),
      oportunidade: opp.data, crm_item: item.data, perfil: perfil.data, pipelines,
      setores: SETORES_ATENDIMENTO.map((s) => ({ id: s, nome: nomeSetor(s) })),
      pode: { triar: podeTriar(papel), lead: temSetor(a, "comercial", "diretoria") },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return resposta(e);
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/admin/atendimento/[id]">) {
  try {
    const a = await ator();
    const { id } = await ctx.params;
    const { c, papel } = await carregar(id, a);
    const eu = a!.userId;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const admin = supabaseAdmin();
    const atualizar = async (mud: Record<string, unknown>) => {
      const { error } = await admin.from("atendimento_conversas").update(mud).eq("id", c.id);
      if (error) throw new Erro("Não foi possível salvar.", 503);
    };

    switch (String(b.acao ?? "")) {
      case "responder": {
        const texto = String(b.texto ?? "").trim();
        if (!texto || texto.length > 4000) throw new Erro("Escreva uma mensagem de até 4.000 caracteres.");
        if (!c.setor && !c.responsavel && !podeTriar(papel)) throw new Erro("Conversa ainda na caixa central.", 403);
        const limite = await limitar("atendimento:" + eu, 60, 600);
        if (!limite.permitido) return respostaLimite(limite, "mensagens");
        const waId = await enviarWhatsapp(c.telefone, texto);
        const agora = new Date().toISOString();
        const { data: saida, error } = await admin.from("whatsapp_mensagens").insert({
          wa_id: waId || null, telefone: c.telefone, direcao: "saida", texto, conversa_id: c.id,
          opportunity_id: c.opportunity_id, enviado_por: eu, status: "sent",
        }).select("id").single();
        if (error || !saida) throw new Erro("O WhatsApp aceitou a mensagem, mas o registro local falhou. Confira antes de reenviar.", 503);
        const mud: Record<string, unknown> = { ultima_saida_em: agora, ultima_mensagem_em: agora, ultimo_texto: texto.slice(0, 300), nao_lidas: 0 };
        if (!c.responsavel) mud.responsavel = eu;
        if (c.status === "resolvida") { mud.status = "aberta"; mud.resolvida_em = null; }
        await atualizar(mud);
        if (!c.responsavel) await eventoAtendimento({ conversa_id: c.id, acao: "assumir", autor: eu, para_user: eu, de_setor: c.setor, para_setor: c.setor, texto: "Assumiu ao responder." });
        if (c.opportunity_id) {
          await admin.from("opportunity_events").insert({ opportunity_id: c.opportunity_id, tipo: "contato", descricao: "WhatsApp enviado: " + texto.slice(0, 500), autor: eu });
        }
        await logAudit({ user_id: eu, acao: "atendimento_resposta", entidade: "atendimento_conversas", entidade_id: c.id });
        break;
      }
      case "transferir": {
        const setor = String(b.setor ?? "");
        if (setor && !SETORES_ATENDIMENTO.includes(setor as SetorId)) throw new Erro("Setor inválido.");
        if (!setor && !podeTriar(papel) && c.responsavel !== eu) throw new Erro("Só a recepção ou a diretoria devolvem para a caixa central.", 403);
        if (!c.setor && !podeTriar(papel)) throw new Erro("Só a recepção ou a diretoria fazem a triagem.", 403);
        let responsavel: string | null = null;
        if (b.responsavel) {
          if (typeof b.responsavel !== "string" || !UUID.test(b.responsavel)) throw new Erro("Responsável inválido.");
          const { data: p } = await admin.from("profiles").select("user_id, role, setores, ativo").eq("user_id", b.responsavel).maybeSingle();
          if (!p || p.ativo === false || !["admin_central", "analista_arini"].includes(p.role)) throw new Erro("O responsável precisa ser da equipe.");
          if (setor && !setoresDe(p.role, p.setores).includes(setor as SetorId)) throw new Erro(`Essa pessoa não atua em ${nomeSetor(setor)}.`);
          responsavel = p.user_id;
        }
        const motivo = String(b.motivo ?? "").trim().slice(0, 500);
        if (c.setor && setor !== c.setor && !motivo) throw new Erro("Diga o motivo da transferência (fica no histórico).");
        const acao = !c.setor && setor ? "triagem" : !setor ? "devolver" : "transferencia";
        await atualizar({ setor: setor || null, responsavel, triada_em: setor ? new Date().toISOString() : null, status: c.status === "resolvida" ? "aberta" : c.status });
        await eventoAtendimento({ conversa_id: c.id, acao, autor: eu, de_setor: c.setor, para_setor: setor || null, de_user: c.responsavel, para_user: responsavel, texto: motivo || null });
        if (responsavel && responsavel !== eu) {
          await notificar(responsavel, "atencao", `Atendimento ${c.codigo} encaminhado para você`, `${c.nome || "+" + c.telefone}${motivo ? " · " + motivo : ""}`.slice(0, 200), `/admin/atendimento?conversa=${c.id}`);
        }
        await logAudit({ user_id: eu, acao: "atendimento_" + acao, entidade: "atendimento_conversas", entidade_id: c.id, dados_depois: { de: c.setor, para: setor || null, responsavel } });
        break;
      }
      case "assumir": {
        if (!c.setor && !podeTriar(papel)) throw new Erro("Conversa ainda na caixa central.", 403);
        if (c.responsavel === eu) break;
        await atualizar({ responsavel: eu });
        await eventoAtendimento({ conversa_id: c.id, acao: "assumir", autor: eu, de_user: c.responsavel, para_user: eu, de_setor: c.setor, para_setor: c.setor });
        if (c.responsavel) await notificar(c.responsavel, "info", `Atendimento ${c.codigo} foi assumido por outra pessoa`, null, `/admin/atendimento?conversa=${c.id}`);
        break;
      }
      case "devolver": {
        // volta para a fila do setor, sem responsável
        await atualizar({ responsavel: null });
        await eventoAtendimento({ conversa_id: c.id, acao: "devolver", autor: eu, de_user: c.responsavel, de_setor: c.setor, para_setor: c.setor,
          texto: String(b.motivo ?? "").trim().slice(0, 500) || "Devolvido para a fila do setor." });
        break;
      }
      case "resolver": case "reabrir": case "pendente": {
        const status = b.acao === "resolver" ? "resolvida" : b.acao === "pendente" ? "pendente" : "aberta";
        await atualizar({ status, resolvida_em: status === "resolvida" ? new Date().toISOString() : null, nao_lidas: 0 });
        await eventoAtendimento({ conversa_id: c.id, acao: b.acao === "reabrir" ? "reabrir" : "resolver", autor: eu,
          texto: status === "pendente" ? "Marcada como aguardando o cliente." : status === "resolvida" ? "Marcada como resolvida." : "Reaberta." });
        break;
      }
      case "nota": {
        const texto = String(b.texto ?? "").trim();
        if (!texto || texto.length > 2000) throw new Erro("Escreva a nota (até 2.000 caracteres).");
        await eventoAtendimento({ conversa_id: c.id, acao: "nota", autor: eu, texto });
        break;
      }
      case "etiquetas": {
        const etiquetas = Array.isArray(b.etiquetas)
          ? [...new Set(b.etiquetas.map((e) => String(e).trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30)).filter(Boolean))].slice(0, 12)
          : [];
        await atualizar({ etiquetas });
        await eventoAtendimento({ conversa_id: c.id, acao: "etiquetas", autor: eu, texto: etiquetas.join(", ") || "sem etiquetas" });
        break;
      }
      case "criar_lead": {
        if (!temSetor(a, "comercial", "diretoria")) throw new Erro("Só o Comercial cria leads.", 403);
        if (c.opportunity_id) throw new Erro("Esta conversa já está ligada a uma negociação.");
        const codigo = String(b.codigo_imovel ?? "").trim().toUpperCase();
        if (!codigo) throw new Erro("Informe o código do imóvel de interesse.");
        const rodizio = b.rodizio !== false;
        const { data, error } = await admin.rpc("fn_crm_lead_manual", {
          p_autor: eu, p_codigo_imovel: codigo, p_nome: c.nome || "Cliente do WhatsApp", p_telefone: "+" + c.telefone, p_email: null,
          p_mensagem: c.ultimo_texto, p_origem: "whatsapp", p_temperatura: null, p_etiquetas: c.etiquetas,
          p_responsavel: rodizio ? null : eu, p_rodizio: rodizio,
        });
        if (error) throw new Erro(error.code === "P0001" ? error.message : "Não foi possível criar o lead.", error.code === "P0001" ? 400 : 503);
        const r = data as { id: string; codigo: string; responsavel: string | null };
        await atualizar({ opportunity_id: r.id, setor: "comercial", responsavel: r.responsavel ?? c.responsavel, triada_em: c.triada_em ?? new Date().toISOString() });
        await admin.from("whatsapp_mensagens").update({ opportunity_id: r.id }).eq("conversa_id", c.id);
        await eventoAtendimento({ conversa_id: c.id, acao: "lead", autor: eu, para_setor: "comercial", para_user: r.responsavel,
          texto: `Lead criado na negociação ${r.codigo}${rodizio ? " (rodízio)" : ""}.` });
        return NextResponse.json({ ok: true, oportunidade: r });
      }
      case "abrir_crm": {
        const pid = String(b.pipeline_id ?? "");
        if (!UUID.test(pid)) throw new Erro("Escolha o funil.");
        const { data: p } = await admin.from("crm_pipelines").select("id, setor, nome").eq("id", pid).maybeSingle();
        if (!p) throw new Erro("Funil não encontrado.", 404);
        if (!temSetor(a, p.setor as SetorId)) throw new Erro("Você não atua no setor deste funil.", 403);
        const { data: etapas } = await admin.from("crm_etapas").select("*").eq("pipeline_id", p.id).order("ordem");
        const primeira = (etapas as Etapa[] | null)?.[0];
        if (!primeira) throw new Erro("O funil não tem etapas.");
        const titulo = (String(b.titulo ?? "").trim() || `WhatsApp · ${c.nome || "+" + c.telefone}`).slice(0, 200);
        const { data: item, error } = await admin.from("crm_itens").insert({
          pipeline_id: p.id, etapa_id: primeira.id, titulo, responsavel: c.responsavel ?? eu, criado_por: eu,
          descricao: `Aberto pelo Atendimento (${c.codigo}). Telefone: +${c.telefone}.\nÚltima mensagem: ${c.ultimo_texto ?? ""}`.slice(0, 5000),
          dados: { telefone: "+" + c.telefone, atendimento: c.codigo }, prazo_etapa: prazoDaEtapa(primeira), opportunity_id: c.opportunity_id,
        }).select("id, codigo").single();
        if (error || !item) throw new Erro("Não foi possível criar o item no funil.", 503);
        await admin.from("crm_item_eventos").insert({ item_id: item.id, tipo: "criado", autor: eu, texto: `Criado em "${primeira.nome}" pelo Atendimento ${c.codigo}` });
        await atualizar({ crm_item_id: item.id });
        await eventoAtendimento({ conversa_id: c.id, acao: "crm", autor: eu, texto: `Item ${item.codigo} aberto no funil "${p.nome}" (${nomeSetor(p.setor)}).` });
        return NextResponse.json({ ok: true, item });
      }
      default:
        throw new Erro("Ação desconhecida.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return resposta(e);
  }
}

