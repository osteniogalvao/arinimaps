import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatBRL } from "@/lib/format";
import { briefing } from "@/lib/ia/central";
import { concluirTarefaDoEvento } from "@/lib/central";
import { MetaErro, publicarFacebook, publicarInstagram } from "@/lib/meta";
import { ErroRegistro, registrarAcoes, registrarAntesCriar } from "@/lib/registros-servidor";

/** Central de publicação multicanal (migration 0068). */

const urlMidia = (path: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? "https://arinibrasil.com.br";

async function imovel(id: string) {
  const { data } = await supabaseAdmin().from("properties")
    .select("id, codigo, titulo, descricao, tipo, valor, area_declarada, status, caracteristicas, municipio:municipalities(nome, uf), media:property_media(storage_path, capa, ordem, tipo)")
    .eq("id", id).maybeSingle();
  return data;
}

/** Publica de verdade no canal. Devolve o que gravar na publicação. */
export async function publicarAgora(linha: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = await imovel(String(linha.property_id));
  if (!p || !["publicado", "em_negociacao"].includes(p.status)) {
    return { status: "erro", erro: "O imóvel não está publicado no site." };
  }
  const fotos = ((p.media ?? []) as { storage_path: string; capa: boolean; ordem: number; tipo: string }[])
    .filter((m) => m.tipo === "foto").sort((a, b) => Number(b.capa) - Number(a.capa) || a.ordem - b.ordem).map((m) => urlMidia(m.storage_path));
  const link = `${site()}/imovel/${p.codigo}`;
  const legenda = String(linha.legenda ?? "").trim() || `${p.titulo}\n${link}`;
  const agora = new Date().toISOString();
  try {
    switch (linha.canal) {
      case "instagram": {
        const r = await publicarInstagram(fotos.slice(0, 10), legenda);
        return { status: "publicada", publicado_em: agora, externo_id: r.id, link_externo: r.link, erro: null, midias: fotos.slice(0, 10) };
      }
      case "facebook": {
        const r = await publicarFacebook(fotos[0] ?? null, legenda, link);
        return { status: "publicada", publicado_em: agora, externo_id: r.id, link_externo: r.link, erro: null, midias: fotos.slice(0, 1) };
      }
      default:
        // portais: o feed XML passa a incluir o imóvel; site: destaque na vitrine
        return { status: "publicada", publicado_em: agora, erro: null, link_externo: linha.canal === "portais" ? `${site()}/api/feeds/portais` : link };
    }
  } catch (e) {
    if (e instanceof MetaErro) return { status: "erro", erro: e.mensagem };
    throw e;
  }
}

registrarAntesCriar("publicacoes", async (ator, linha) => {
  linha.status = "rascunho";
  linha.criado_por = ator.userId;
});

registrarAcoes("publicacoes", {
  async gerar_legenda({ linha }) {
    const p = await imovel(String(linha.property_id));
    if (!p) throw new ErroRegistro("Imóvel não encontrado.");
    const area = p.area_declarada ? `${Number(p.area_declarada).toLocaleString("pt-BR")} ${p.tipo === "rural" ? "ha" : "m²"}` : null;
    const mun = p.municipio as unknown as { nome: string; uf: string } | null;
    const r = await briefing(
      `Escreva a legenda de um post de ${linha.canal === "instagram" ? "Instagram" : "rede social"} para este imóvel à venda. ` +
      "Formato: 1 frase de abertura forte, 3 a 5 linhas com os pontos fortes (sem inventar nada), chamada para ação com o link, e até 6 hashtags locais. " +
      "Sem emojis em excesso (no máximo 3). Não use lista com '- '. Não prometa valorização nem rentabilidade.",
      { codigo: p.codigo, titulo: p.titulo, tipo: p.tipo, valor: p.valor ? formatBRL(Number(p.valor)) : "sob consulta", area,
        municipio: mun ? `${mun.nome}/${mun.uf}` : null, descricao: String(p.descricao ?? "").slice(0, 1500), link: `${site()}/imovel/${p.codigo}` },
      600);
    if (!r) throw new ErroRegistro("A IA não está configurada. Escreva a legenda à mão.", 503);
    return { legenda: r.texto };
  },
  async enviar({ linha }) {
    if (!String(linha.legenda ?? "").trim() && linha.canal !== "portais") throw new ErroRegistro("Escreva ou gere a legenda antes.");
    return { status: "aprovacao", erro: null, motivo: null };
  },
  async aprovar({ ator, linha }) {
    if (linha.criado_por === ator.userId && !ator.setores.includes("diretoria")) {
      throw new ErroRegistro("Quem preparou a publicação não aprova a própria; peça para o tráfego ou a Diretoria.", 403);
    }
    await concluirTarefaDoEvento(`publicacao_aprovacao:${linha.id}`, ator.userId, "Publicação aprovada");
    const base = { aprovado_por: ator.userId, aprovado_em: new Date().toISOString() };
    if (linha.agendada_para && +new Date(String(linha.agendada_para)) > Date.now()) return { ...base, status: "agendada" };
    return { ...base, ...(await publicarAgora(linha)) };
  },
  async devolver({ motivo }) {
    return { status: "rascunho", motivo };
  },
  async publicar({ linha }) {
    return publicarAgora(linha);
  },
  async cancelar({ motivo }) {
    return { status: "cancelada", motivo };
  },
});

registrarAntesCriar("campanhas", async (ator, linha) => {
  if (typeof linha.utm_campaign === "string") linha.utm_campaign = linha.utm_campaign.trim().toLowerCase() || null;
  linha.criado_por = ator.userId;
});
