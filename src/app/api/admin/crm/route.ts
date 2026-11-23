import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor, type Ator } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { concluirTarefaDoEvento } from "@/lib/central";
import { notificar } from "@/lib/notificacoes";
import { SETORES, SETOR_IDS, type SetorId } from "@/lib/setores";
import { camposFaltando, extrasDoItem, normalizarDados, prazoDaEtapa, type CampoCrm, type Etapa } from "@/lib/crmSetores";

/**
 * Motor de CRM por setor (migration 0069). Configuração (funil, etapas e
 * campos) é da Diretoria; itens são de quem atua no setor do funil.
 */
const SETOR_NOMES = new Map<string, string>(SETORES.map((s) => [s.id, s.nome]));
class Erro extends Error { constructor(public msg: string, public status = 400) { super(msg); } }
const UUID = /^[0-9a-f-]{36}$/i;
const id = (v: unknown) => { if (typeof v !== "string" || !UUID.test(v)) throw new Erro("Registro inválido."); return v; };

function conferirGravacao(r: { data: unknown; error: { code: string } | null }) {
  if (r.error?.code === "23505") throw new Erro("Já existe um registro com esses dados.", 409);
  if (r.error?.code.startsWith("23")) throw new Erro("Os dados não são válidos para este registro.");
  if (r.error) throw new Erro("Falha ao gravar no banco.", 503);
  if (!r.data) throw new Erro("Registro removido ou alterado. Atualize a página.", 409);
}

async function pipelineDoSetor(a: Ator, pipelineId: string) {
  const { data, error } = await supabaseAdmin().from("crm_pipelines").select("id, setor").eq("id", pipelineId).maybeSingle();
  if (error) throw new Erro("Falha ao consultar o funil.", 503);
  if (!data) throw new Erro("Funil não encontrado.", 404);
  if (!temSetor(a, data.setor as SetorId)) throw new Erro("Você não atua no setor deste funil.", 403);
  return data;
}

/**
 * Quem pode mexer no item: quem atua no setor do funil ou o responsável a quem
 * ele foi delegado, mesmo sendo de outro setor (áudio do Carlos, 23/11/2026:
 * "não estou conseguindo delegar").
 */
async function acessoAoItem(a: Ator, item: { pipeline_id: string; responsavel: string | null }) {
  if (item.responsavel && item.responsavel === a.userId) return;
  await pipelineDoSetor(a, item.pipeline_id);
}

/** Membro ativo da equipe da Matriz (para delegar). */
async function membroDaEquipe(userId: string) {
  const { data, error } = await supabaseAdmin().from("profiles").select("user_id, nome, role, setores, ativo").eq("user_id", userId).maybeSingle();
  if (error) throw new Erro("Falha ao consultar a equipe.", 503);
  if (!data || data.ativo === false || !["admin_central", "analista_arini"].includes(String(data.role))) throw new Erro("Escolha alguém da equipe ativa.");
  return data as { user_id: string; nome: string | null; role: string; setores: string[] | null };
}

async function estrutura(pipelineId: string) {
  const admin = supabaseAdmin();
  const [resEtapas, resCampos] = await Promise.all([
    admin.from("crm_etapas").select("*").eq("pipeline_id", pipelineId).order("ordem"),
    admin.from("crm_campos").select("*").eq("pipeline_id", pipelineId).order("ordem"),
  ]);
  if (resEtapas.error || resCampos.error) throw new Erro("Falha ao consultar as etapas e os campos do funil.", 503);
  return { etapas: resEtapas.data as Etapa[], campos: resCampos.data as CampoCrm[] };
}

async function evento(itemId: string, tipo: string, autor: string, texto: string, dados: Record<string, unknown> = {}) {
  await supabaseAdmin().from("crm_item_eventos").insert({ item_id: itemId, tipo, autor, texto, dados });
}

export async function POST(request: Request) {
  try {
    const a = await ator();
    if (!a?.ehArini) throw new Erro("Restrito à equipe.", 403);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const acao = String(b.acao ?? "");
    const admin = supabaseAdmin();
    const diretoria = temSetor(a, "diretoria");
    const exigeDiretoria = () => { if (!diretoria) throw new Erro("Só a Diretoria configura os funis.", 403); };

    switch (acao) {
      // ------------------------------------------------ configuração
      case "salvar_pipeline": {
        exigeDiretoria();
        const setor = String(b.setor ?? "") as SetorId;
        if (!SETOR_IDS.includes(setor)) throw new Erro("Setor inválido.");
        const nome = String(b.nome ?? "").trim().slice(0, 120);
        if (nome.length < 3) throw new Erro("Dê um nome ao funil.");
        const linha = { setor, nome, descricao: String(b.descricao ?? "").slice(0, 500) || null, ativo: b.ativo !== false };
        if (b.id) {
          conferirGravacao(await admin.from("crm_pipelines").update(linha).eq("id", id(b.id)).select("id").maybeSingle());
        } else {
          const novo = await admin.rpc("fn_crm_criar_funil", {
            p_setor: setor, p_nome: nome, p_descricao: linha.descricao, p_ativo: linha.ativo,
          });
          conferirGravacao(novo);
          await logAudit({ user_id: a.userId, acao: "crm_funil_criado", entidade: "crm_pipelines", entidade_id: novo.data, dados_depois: linha });
          return NextResponse.json({ ok: true, id: novo.data });
        }
        await logAudit({ user_id: a.userId, acao: "crm_funil_editado", entidade: "crm_pipelines", entidade_id: String(b.id), dados_depois: linha });
        return NextResponse.json({ ok: true });
      }
      case "salvar_etapa": {
        exigeDiretoria();
        const sla = b.sla_horas === "" || b.sla_horas == null ? null : Math.round(Number(b.sla_horas));
        if (sla !== null && (!Number.isFinite(sla) || sla < 1 || sla > 8760)) throw new Erro("Prazo da etapa entre 1 e 8760 horas.");
        const linha = { nome: String(b.nome ?? "").trim().slice(0, 80), ordem: Math.round(Number(b.ordem) || 0), sla_horas: sla, final: b.final === true };
        if (!linha.nome) throw new Erro("Dê um nome à etapa.");
        const escrita = b.id ? admin.from("crm_etapas").update(linha).eq("id", id(b.id))
          : admin.from("crm_etapas").insert({ ...linha, pipeline_id: id(b.pipeline_id) });
        conferirGravacao(await escrita.select("id").maybeSingle());
        break;
      }
      case "remover_etapa": {
        exigeDiretoria();
        const { count, error } = await admin.from("crm_itens").select("id", { count: "exact", head: true }).eq("etapa_id", id(b.id)).eq("status", "aberto");
        if (error) throw new Erro("Falha ao verificar os itens desta etapa.", 503);
        if (count) throw new Erro(`Há ${count} item(ns) aberto(s) nesta etapa. Mova-os antes.`);
        conferirGravacao(await admin.from("crm_etapas").delete().eq("id", id(b.id)).select("id").maybeSingle());
        break;
      }
      case "salvar_campo": {
        exigeDiretoria();
        const rotulo = String(b.rotulo ?? "").trim().slice(0, 80);
        if (!rotulo) throw new Erro("Dê um nome ao campo.");
        const chave = (String(b.chave ?? "") || rotulo).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
        const tipo = String(b.tipo ?? "texto");
        const opcoes = Array.isArray(b.opcoes) ? b.opcoes.map((o) => String(o).trim()).filter(Boolean).slice(0, 30)
          : String(b.opcoes ?? "").split(",").map((o) => o.trim()).filter(Boolean).slice(0, 30);
        const linha = { rotulo, chave, tipo, opcoes, exigido_desde: b.exigido_desde ? id(b.exigido_desde) : null, ordem: Math.round(Number(b.ordem) || 0) };
        const escrita = b.id ? admin.from("crm_campos").update(linha).eq("id", id(b.id))
          : admin.from("crm_campos").insert({ ...linha, pipeline_id: id(b.pipeline_id) });
        conferirGravacao(await escrita.select("id").maybeSingle());
        break;
      }
      case "remover_campo": {
        exigeDiretoria();
        conferirGravacao(await admin.from("crm_campos").delete().eq("id", id(b.id)).select("id").maybeSingle());
        break;
      }

      // ------------------------------------------------ itens
      case "criar_item": {
        const p = await pipelineDoSetor(a, id(b.pipeline_id));
        const { etapas, campos } = await estrutura(p.id);
        const primeira = etapas[0];
        if (!primeira) throw new Erro("O funil não tem etapas.");
        const titulo = String(b.titulo ?? "").trim().slice(0, 200);
        if (!titulo) throw new Erro("Dê um título ao item.");
        const dados = normalizarDados(campos, (b.dados as Record<string, unknown>) ?? {});
        const falta = camposFaltando(campos, etapas, primeira.id, dados);
        if (falta.length) throw new Erro(`Preencha: ${falta.map((c) => c.rotulo).join(", ")}.`);
        const linha = {
          pipeline_id: p.id, etapa_id: primeira.id, titulo, descricao: String(b.descricao ?? "").slice(0, 5000) || null,
          responsavel: b.responsavel ? id(b.responsavel) : a.userId, dados, prazo_etapa: prazoDaEtapa(primeira), criado_por: a.userId,
          property_id: b.property_id ? id(b.property_id) : null, opportunity_id: b.opportunity_id ? id(b.opportunity_id) : null,
        };
        // prioridade, prazo final e etiquetas (0148); sem a migration, grava o resto
        const extras = extrasDoItem(b);
        let { data, error } = await admin.from("crm_itens").insert({ ...linha, ...extras }).select("id").single();
        if (error && extras && /column/i.test(error.message)) ({ data, error } = await admin.from("crm_itens").insert(linha).select("id").single());
        if (error || !data) throw new Erro("Não foi possível criar o item.");
        await evento(data.id, "criado", a.userId, `Criado em "${primeira.nome}"`);
        await logAudit({ user_id: a.userId, acao: "crm_item_criado", entidade: "crm_itens", entidade_id: data.id });
        return NextResponse.json({ ok: true, id: data.id });
      }
      case "delegar_item": {
        // Só troca o responsável: não exige os campos da etapa, que travavam a delegação pela ficha.
        const { data: item, error } = await admin.from("crm_itens").select("id, codigo, pipeline_id, responsavel, titulo, updated_at").eq("id", id(b.id)).maybeSingle();
        if (error) throw new Erro("Falha ao consultar o item.", 503);
        if (!item) throw new Erro("Item não encontrado.", 404);
        await acessoAoItem(a, item);
        const novo = b.responsavel ? id(b.responsavel) : null;
        const pessoa = novo ? await membroDaEquipe(novo) : null;
        if (novo === item.responsavel) throw new Erro("Esta pessoa já é a responsável.", 409);
        conferirGravacao(await admin.from("crm_itens").update({ responsavel: novo }).eq("id", item.id).eq("updated_at", item.updated_at).select("id").maybeSingle());
        const nota = String(b.nota ?? "").trim().slice(0, 1000);
        await evento(item.id, "responsavel", a.userId, (pessoa ? `Delegou para ${pessoa.nome || "colega"}` : "Deixou sem responsável") + (nota ? `: ${nota}` : ""),
          { de: item.responsavel, para: novo });
        // a tela promete o aviso: quem recebe vê na Central (sino) e acha em "Comigo"
        if (novo && novo !== a.userId) {
          await notificar(novo, "atencao", `CRM ${item.codigo ?? ""} delegado para você`,
            `${item.titulo}${nota ? " · " + nota : ""}`.slice(0, 200), `/admin/crm/item/${item.id}`);
        }
        await logAudit({ user_id: a.userId, acao: "crm_item_delegado", entidade: "crm_itens", entidade_id: item.id, dados_antes: { responsavel: item.responsavel }, dados_depois: { responsavel: novo } });
        return NextResponse.json({ ok: true });
      }
      case "encaminhar_item": {
        // Encaminhamento entre setores (Central de CRMs, item 4): o item muda de funil e
        // mantém código, campos, conversa e histórico; entra na primeira etapa do destino.
        const { data: item, error } = await admin.from("crm_itens").select("*").eq("id", id(b.id)).maybeSingle();
        if (error) throw new Erro("Falha ao consultar o item.", 503);
        if (!item) throw new Erro("Item não encontrado.", 404);
        await acessoAoItem(a, item);
        if (item.status !== "aberto") throw new Erro("Reabra o item antes de encaminhar.");
        const motivo = String(b.motivo ?? "").trim().slice(0, 1000);
        if (motivo.length < 5) throw new Erro("Explique em uma frase o que o outro setor precisa fazer.");
        const destinoId = id(b.pipeline_id);
        if (destinoId === item.pipeline_id) throw new Erro("O item já está neste funil.", 409);
        const [{ data: origem }, { data: destino, error: ed }] = await Promise.all([
          admin.from("crm_pipelines").select("id, setor, nome").eq("id", item.pipeline_id).maybeSingle(),
          admin.from("crm_pipelines").select("id, setor, nome, ativo").eq("id", destinoId).maybeSingle(),
        ]);
        if (ed) throw new Erro("Falha ao consultar o funil de destino.", 503);
        if (!destino || destino.ativo === false) throw new Erro("Funil de destino indisponível.");
        const { etapas: etapasDestino } = await estrutura(destino.id);
        const primeira = etapasDestino[0];
        if (!primeira) throw new Erro("O funil de destino ainda não tem etapas.");
        const novo = b.responsavel ? id(b.responsavel) : null;
        const pessoa = novo ? await membroDaEquipe(novo) : null;
        conferirGravacao(await admin.from("crm_itens").update({
          pipeline_id: destino.id, etapa_id: primeira.id, entrou_etapa_em: new Date().toISOString(),
          prazo_etapa: prazoDaEtapa(primeira), responsavel: novo,
        }).eq("id", item.id).eq("updated_at", item.updated_at).select("id").maybeSingle());
        if (item.etapa_id) await concluirTarefaDoEvento(`crm_sla:${item.id}:${item.etapa_id}`, a.userId, `Item encaminhado para ${destino.nome}`, "crm_itens", item.id);
        const setorDe = (sid?: string) => SETOR_NOMES.get(sid ?? "") ?? sid ?? "—";
        await evento(item.id, "encaminhado", a.userId,
          `Encaminhado de ${setorDe(origem?.setor)} (${origem?.nome ?? "—"}) para ${setorDe(destino.setor)} (${destino.nome})${pessoa ? `, aos cuidados de ${pessoa.nome || "colega"}` : ""}: ${motivo}`,
          { de_pipeline: item.pipeline_id, para_pipeline: destino.id, responsavel_anterior: item.responsavel, etapa_anterior: item.etapa_id });
        if (novo && novo !== a.userId) {
          await notificar(novo, "atencao", `CRM ${item.codigo ?? ""} encaminhado para você`,
            `${item.titulo} · ${motivo}`.slice(0, 200), `/admin/crm/item/${item.id}`);
        }
        await logAudit({ user_id: a.userId, acao: "crm_item_encaminhado", entidade: "crm_itens", entidade_id: item.id, dados_antes: item, dados_depois: { pipeline_id: destino.id, responsavel: novo } });
        return NextResponse.json({ ok: true, pipeline_id: destino.id });
      }
      case "mover_item": case "editar_item": case "status_item": {
        const { data: item, error } = await admin.from("crm_itens").select("*").eq("id", id(b.id)).maybeSingle();
        if (error) throw new Erro("Falha ao consultar o item.", 503);
        if (!item) throw new Erro("Item não encontrado.", 404);
        await acessoAoItem(a, item);
        const { etapas, campos } = await estrutura(item.pipeline_id);
        const atualizar = async (mudanca: Record<string, unknown>) => conferirGravacao(
          await admin.from("crm_itens").update(mudanca).eq("id", item.id).eq("updated_at", item.updated_at).select("id").maybeSingle()
        );
        // Concluir diretamente deve exigir tanto quanto avançar pelo funil inteiro.
        const validarCampos = (destino: string | null, dados: Record<string, unknown>, concluido: boolean) => {
          const etapa = concluido ? etapas.at(-1)?.id : destino;
          if (!etapa) return;
          const falta = camposFaltando(campos, etapas, etapa, dados);
          if (falta.length) throw new Erro(`Preencha os campos obrigatórios: ${falta.map((c) => c.rotulo).join(", ")}.`);
        };
        if (acao === "mover_item") {
          const destino = etapas.find((e) => e.id === b.etapa_id);
          if (!destino) throw new Erro("Etapa inválida.");
          if (item.status !== "aberto") throw new Erro("Reabra o item antes de mover.");
          if (destino.id === item.etapa_id) throw new Erro("O item já está nesta etapa.", 409);
          const falta = camposFaltando(campos, etapas, destino.id, item.dados ?? {});
          if (falta.length) throw new Erro(`Para entrar em "${destino.nome}", preencha: ${falta.map((c) => c.rotulo).join(", ")}.`);
          const de = etapas.find((e) => e.id === item.etapa_id);
          await atualizar({
            etapa_id: destino.id, entrou_etapa_em: new Date().toISOString(), prazo_etapa: prazoDaEtapa(destino),
            ...(destino.final ? { status: "concluido" } : {}),
          });
          if (de) await concluirTarefaDoEvento(`crm_sla:${item.id}:${de.id}`, a.userId, `Item seguiu para "${destino.nome}"`, "crm_itens", item.id);
          await evento(item.id, "etapa", a.userId, `${de?.nome ?? "—"} → ${destino.nome}`, { de: de?.id, para: destino.id });
        } else if (acao === "editar_item") {
          const dados = { ...(item.dados ?? {}), ...normalizarDados(campos, (b.dados as Record<string, unknown>) ?? {}) };
          validarCampos(item.etapa_id, dados, item.status === "concluido");
          const mud: Record<string, unknown> = { dados };
          if (typeof b.titulo === "string" && b.titulo.trim()) mud.titulo = b.titulo.trim().slice(0, 200);
          if (typeof b.descricao === "string") mud.descricao = b.descricao.slice(0, 5000) || null;
          if (b.responsavel !== undefined) mud.responsavel = b.responsavel ? id(b.responsavel) : null;
          // o responsável escolhido na ficha também precisa ser da equipe ativa (como em "Delegar")
          if (mud.responsavel && mud.responsavel !== item.responsavel) await membroDaEquipe(mud.responsavel as string);
          const extras = extrasDoItem(b);
          if (extras && "prioridade" in item) Object.assign(mud, extras);
          await atualizar(mud);
          if (extras?.prioridade && extras.prioridade !== item.prioridade && "prioridade" in item) await evento(item.id, "campo", a.userId, `Prioridade: ${extras.prioridade}`);
          const mudou = campos.filter((c) => JSON.stringify(item.dados?.[c.chave] ?? null) !== JSON.stringify(dados[c.chave] ?? null)).map((c) => c.rotulo);
          if (mudou.length) await evento(item.id, "campo", a.userId, `Atualizou: ${mudou.join(", ")}`);
          if (mud.responsavel !== undefined && mud.responsavel !== item.responsavel) {
            await evento(item.id, "responsavel", a.userId, "Trocou o responsável");
            if (mud.responsavel && mud.responsavel !== a.userId) {
              await notificar(mud.responsavel as string, "atencao", `CRM ${item.codigo ?? ""} com você`, String(mud.titulo ?? item.titulo).slice(0, 200), `/admin/crm/item/${item.id}`);
            }
          }
        } else {
          const status = String(b.status ?? "");
          if (!["aberto", "concluido", "cancelado"].includes(status)) throw new Erro("Situação inválida.");
          const motivo = String(b.motivo ?? "").trim();
          if (status === "cancelado" && motivo.length < 5) throw new Erro("Explique o motivo do cancelamento.");
          if (status === "concluido") validarCampos(item.etapa_id, item.dados ?? {}, true);
          await atualizar({ status });
          await evento(item.id, "status", a.userId, status === "aberto" ? "Reaberto" : status === "concluido" ? "Concluído" : `Cancelado: ${motivo}`);
        }
        await logAudit({ user_id: a.userId, acao: `crm_${acao}`, entidade: "crm_itens", entidade_id: item.id, dados_antes: item });
        break;
      }
      default:
        throw new Erro("Ação inválida.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Erro) return NextResponse.json({ error: e.msg }, { status: e.status });
    console.error("crm:", e);
    return NextResponse.json({ error: "Não foi possível salvar." }, { status: 500 });
  }
}
