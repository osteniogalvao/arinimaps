import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor, type Ator } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { concluirTarefaDoEvento } from "@/lib/central";
import { SETOR_IDS, type SetorId } from "@/lib/setores";
import { camposFaltando, normalizarDados, prazoDaEtapa, type CampoCrm, type Etapa } from "@/lib/crmSetores";

/**
 * Motor de CRM por setor (migration 0069). Configuração (funil, etapas e
 * campos) é da Diretoria; itens são de quem atua no setor do funil.
 */
class Erro extends Error { constructor(public msg: string, public status = 400) { super(msg); } }
const UUID = /^[0-9a-f-]{36}$/i;
const id = (v: unknown) => { if (typeof v !== "string" || !UUID.test(v)) throw new Erro("Registro inválido."); return v; };

async function pipelineDoSetor(a: Ator, pipelineId: string) {
  const { data } = await supabaseAdmin().from("crm_pipelines").select("id, setor").eq("id", pipelineId).maybeSingle();
  if (!data) throw new Erro("Funil não encontrado.", 404);
  if (!temSetor(a, data.setor as SetorId)) throw new Erro("Você não atua no setor deste funil.", 403);
  return data;
}

async function estrutura(pipelineId: string) {
  const admin = supabaseAdmin();
  const [{ data: etapas }, { data: campos }] = await Promise.all([
    admin.from("crm_etapas").select("*").eq("pipeline_id", pipelineId).order("ordem"),
    admin.from("crm_campos").select("*").eq("pipeline_id", pipelineId).order("ordem"),
  ]);
  return { etapas: (etapas ?? []) as Etapa[], campos: (campos ?? []) as CampoCrm[] };
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
          await admin.from("crm_pipelines").update(linha).eq("id", id(b.id));
        } else {
          const { data, error } = await admin.from("crm_pipelines").insert(linha).select("id").single();
          if (error) throw new Erro("Falta rodar a migration 0069.", 503);
          await admin.from("crm_etapas").insert([
            { pipeline_id: data.id, nome: "Entrada", ordem: 1, sla_horas: 48 },
            { pipeline_id: data.id, nome: "Em andamento", ordem: 2, sla_horas: 120 },
            { pipeline_id: data.id, nome: "Concluído", ordem: 3, final: true },
          ]);
          await logAudit({ user_id: a.userId, acao: "crm_funil_criado", entidade: "crm_pipelines", entidade_id: data.id, dados_depois: linha });
          return NextResponse.json({ ok: true, id: data.id });
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
        if (b.id) await admin.from("crm_etapas").update(linha).eq("id", id(b.id));
        else await admin.from("crm_etapas").insert({ ...linha, pipeline_id: id(b.pipeline_id) });
        break;
      }
      case "remover_etapa": {
        exigeDiretoria();
        const { count } = await admin.from("crm_itens").select("id", { count: "exact", head: true }).eq("etapa_id", id(b.id)).eq("status", "aberto");
        if (count) throw new Erro(`Há ${count} item(ns) aberto(s) nesta etapa. Mova-os antes.`);
        await admin.from("crm_etapas").delete().eq("id", id(b.id));
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
        const { error } = b.id
          ? await admin.from("crm_campos").update(linha).eq("id", id(b.id))
          : await admin.from("crm_campos").insert({ ...linha, pipeline_id: id(b.pipeline_id) });
        if (error) throw new Erro(error.code === "23505" ? "Já existe um campo com esse nome." : "Tipo de campo inválido.");
        break;
      }
      case "remover_campo": {
        exigeDiretoria();
        await admin.from("crm_campos").delete().eq("id", id(b.id));
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
        const { data, error } = await admin.from("crm_itens").insert({
          pipeline_id: p.id, etapa_id: primeira.id, titulo, descricao: String(b.descricao ?? "").slice(0, 5000) || null,
          responsavel: b.responsavel ? id(b.responsavel) : a.userId, dados, prazo_etapa: prazoDaEtapa(primeira), criado_por: a.userId,
          property_id: b.property_id ? id(b.property_id) : null, opportunity_id: b.opportunity_id ? id(b.opportunity_id) : null,
        }).select("id").single();
        if (error) throw new Erro("Não foi possível criar o item.");
        await evento(data.id, "criado", a.userId, `Criado em "${primeira.nome}"`);
        await logAudit({ user_id: a.userId, acao: "crm_item_criado", entidade: "crm_itens", entidade_id: data.id });
        return NextResponse.json({ ok: true, id: data.id });
      }
      case "mover_item": case "editar_item": case "status_item": {
        const { data: item } = await admin.from("crm_itens").select("*").eq("id", id(b.id)).maybeSingle();
        if (!item) throw new Erro("Item não encontrado.", 404);
        await pipelineDoSetor(a, item.pipeline_id);
        const { etapas, campos } = await estrutura(item.pipeline_id);
        if (acao === "mover_item") {
          const destino = etapas.find((e) => e.id === b.etapa_id);
          if (!destino) throw new Erro("Etapa inválida.");
          if (item.status !== "aberto") throw new Erro("Reabra o item antes de mover.");
          const falta = camposFaltando(campos, etapas, destino.id, item.dados ?? {});
          if (falta.length) throw new Erro(`Para entrar em "${destino.nome}", preencha: ${falta.map((c) => c.rotulo).join(", ")}.`);
          const de = etapas.find((e) => e.id === item.etapa_id);
          await admin.from("crm_itens").update({
            etapa_id: destino.id, entrou_etapa_em: new Date().toISOString(), prazo_etapa: prazoDaEtapa(destino),
            ...(destino.final ? { status: "concluido" } : {}),
          }).eq("id", item.id);
          if (de) await concluirTarefaDoEvento(`crm_sla:${item.id}:${de.id}`, a.userId, `Item seguiu para "${destino.nome}"`);
          await evento(item.id, "etapa", a.userId, `${de?.nome ?? "—"} → ${destino.nome}`, { de: de?.id, para: destino.id });
        } else if (acao === "editar_item") {
          const dados = { ...(item.dados ?? {}), ...normalizarDados(campos, (b.dados as Record<string, unknown>) ?? {}) };
          const mud: Record<string, unknown> = { dados };
          if (typeof b.titulo === "string" && b.titulo.trim()) mud.titulo = b.titulo.trim().slice(0, 200);
          if (typeof b.descricao === "string") mud.descricao = b.descricao.slice(0, 5000) || null;
          if (b.responsavel !== undefined) mud.responsavel = b.responsavel ? id(b.responsavel) : null;
          await admin.from("crm_itens").update(mud).eq("id", item.id);
          const mudou = campos.filter((c) => JSON.stringify(item.dados?.[c.chave] ?? null) !== JSON.stringify(dados[c.chave] ?? null)).map((c) => c.rotulo);
          if (mudou.length) await evento(item.id, "campo", a.userId, `Atualizou: ${mudou.join(", ")}`);
          if (mud.responsavel !== undefined && mud.responsavel !== item.responsavel) await evento(item.id, "responsavel", a.userId, "Trocou o responsável");
        } else {
          const status = String(b.status ?? "");
          if (!["aberto", "concluido", "cancelado"].includes(status)) throw new Erro("Situação inválida.");
          const motivo = String(b.motivo ?? "").trim();
          if (status === "cancelado" && motivo.length < 5) throw new Erro("Explique o motivo do cancelamento.");
          await admin.from("crm_itens").update({ status }).eq("id", item.id);
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
