import "server-only";
import { urlDoSite } from "@/lib/compartilhar";
import { formatArea, formatBRL } from "@/lib/format";
import { responder, type Turno } from "@/lib/ia/assistente";
import { iaConfigurada } from "@/lib/ia/config";
import { STATUS_VITRINE } from "@/lib/imovel/vitrine";
import { enviarImagemWhatsapp } from "@/lib/meta";
import { contatoSocial } from "@/lib/meta-mensagens";
import { lerConfiguracoes } from "@/lib/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fotoUrl } from "@/lib/vendidos";

/**
 * Ari no WhatsApp (migration 0170, pedido do Carlos em 24/11/2026): o cliente
 * consulta imóveis à venda conversando, no mesmo número do atendimento.
 *
 * Entra de dois jeitos (lib/atendimento.ts decide):
 *   · opção do menu com acao = 'ari' ("Consultar imóveis à venda");
 *   · primeira mensagem que já é uma busca clara ("fazenda de 100 ha em Iturama").
 * Sai quando o cliente pede uma pessoa ("0", "corretor", "quero visitar"),
 * quando passa do limite diário ou quando alguém da equipe assume a conversa.
 *
 * A Ari usa as mesmas ferramentas do site (só a vitrine pública), sem dado
 * pessoal. Aqui só se adapta o formato ao WhatsApp e se mandam as fotos.
 */

export type ConversaAri = {
  id: string; telefone: string; nome: string | null; setor: string | null; responsavel: string | null;
  ari_ativa_em?: string | null; ari_dia?: string | null; ari_respostas_dia?: number | null; ari_ultimo_imovel?: string | null;
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const TIPO_IMOVEL = /\b(fazendas?|sitios?|chacaras?|ranchos?|terrenos?|lotes?|casas?|imoveis|imovel|propriedades?|area rural|areas rurais|hectares?|alqueires?|\d+\s*ha)\b/;
const INTENCAO = /\b(tem|tens|teria|procuro|procurando|busco|buscando|comprar|compra|a venda|venda|vende|vendendo|disponivel|disponiveis|valor|preco|ate|quanto|opcoes)\b/;
const CIDADES = /\b(iturama|uniao de minas|limeira do oeste|carneirinho|sao francisco de sales|campina verde|pontal)\b/;
// dono querendo vender/anunciar não é busca: vai pelo menu (Operações)
const DONO = /\b(vender (a |o )?(minha|meu)|anunciar|minha (fazenda|casa|chacara|area|propriedade)|meu (sitio|lote|terreno|imovel))\b/;

/** A primeira mensagem já é um pedido de imóvel? Conservador: na dúvida, menu. */
export function buscaClaraDeImovel(texto: string) {
  const t = semAcento(texto).replace(/\s+/g, " ").trim();
  if (t.length < 8 || t.length > 300 || DONO.test(t)) return false;
  return TIPO_IMOVEL.test(t) && (INTENCAO.test(t) || CIDADES.test(t) || /\d/.test(t));
}

/** O cliente quer uma pessoa (corretor, visita, proposta)? */
export function pedeHumano(texto: string) {
  const t = semAcento(texto).replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
  if (/^(0|corretor|atendente|humano|pessoa|vendedor)$/.test(t)) return true;
  return /\b(falar|conversar)\s+com\s+(um |uma |o |a )?(corretor|corretora|atendente|humano|pessoa|alguem|vendedor)\b/.test(t)
    || /\b(quero|gostaria de|posso|queria) (visitar|agendar|marcar)\b/.test(t)
    || /\b(agendar|marcar) (uma )?visita\b/.test(t)
    || /\b(tenho interesse|quero fazer (uma )?proposta|fazer uma oferta)\b/.test(t);
}

/** A Ari pode falar agora? (chave instalada, IA ligada nas Configurações e no Atendimento) */
export async function ariLigada(menu: { ari_ativo?: boolean } | null) {
  if (menu?.ari_ativo !== true || !iaConfigurada()) return false;
  const cfg = await lerConfiguracoes().catch(() => ({} as Record<string, unknown>));
  return (cfg as { ia_chat_ativo?: boolean }).ia_chat_ativo !== false;
}

const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const INSTRUCOES_WHATSAPP = `Canal desta conversa: WhatsApp da ARINI. O cliente escreve do celular.
- Formato do WhatsApp: texto simples, frases curtas. Negrito só com *um asterisco de cada lado*. Não use títulos (#), tabelas nem listas aninhadas.
- Mostre no máximo 5 imóveis, um por linha, assim: *AIB-000123* · título curto · município · área · valor. Logo depois da sua mensagem o sistema manda a foto de até 3 deles, então não descreva fotos.
- Termine oferecendo um próximo passo curto: refinar a busca (cidade, tamanho, valor), pedir os detalhes de um código, ou responder *0* para falar com um corretor (que agenda visita e negocia).
- Aqui não existe botão "Tenho interesse": para interesse ou visita, o cliente responde *0* ou "quero visitar".
- Cotações e consulta do CAR têm atalho próprio: o cliente pode mandar BOI, COTAÇÃO MILHO ou a localização pelo clipe.
- Não peça nome, CPF, e-mail nem outro dado pessoal.`;

/** Markdown do site → texto do WhatsApp, com links completos. */
export function paraWhatsapp(texto: string) {
  const site = urlDoSite().replace(/\/+$/, "");
  return texto
    .replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, (_, rotulo: string, caminho: string) => `${rotulo} (${site}${caminho})`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    .replace(/__([^_]+)__/g, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 3900);
}

/** Histórico curto desde que a Ari entrou: o que o cliente e o robô escreveram. */
async function historico(c: ConversaAri, mensagemAtual: string): Promise<Turno[]> {
  if (!c.ari_ativa_em) return [];
  const { data } = await supabaseAdmin().from("whatsapp_mensagens").select("id, direcao, texto, tipo, created_at")
    .eq("conversa_id", c.id).gte("created_at", c.ari_ativa_em).order("created_at", { ascending: false }).limit(14);
  const linhas = (data ?? []).filter((m) => m.id !== mensagemAtual && m.texto && m.tipo !== "image").reverse();
  const turnos: Turno[] = [];
  for (const m of linhas) {
    const papel = m.direcao === "entrada" ? "user" : "assistant";
    const ultimo = turnos[turnos.length - 1];
    if (ultimo?.papel === papel) ultimo.conteudo += `\n${m.texto}`;
    else turnos.push({ papel, conteudo: String(m.texto) });
  }
  return turnos;
}

type CardImovel = { codigo: string; legenda: string; foto: string | null };

/** Foto de capa e legenda dos imóveis que a Ari citou (só os da vitrine pública). */
async function cards(codigos: string[]): Promise<CardImovel[]> {
  if (!codigos.length) return [];
  const { data } = await supabaseAdmin().from("properties")
    .select("codigo, titulo, tipo, valor, municipality:municipalities!properties_municipality_id_fkey(nome, uf), geo:property_geometries(area_m2), media:property_media(storage_path, capa, tipo, ordem)")
    .in("codigo", codigos).in("status", [...STATUS_VITRINE]);
  const site = urlDoSite().replace(/\/+$/, "");
  return codigos.flatMap((cod) => {
    const p = data?.find((x) => x.codigo === cod);
    if (!p) return [];
    const mun = p.municipality as unknown as { nome: string; uf: string } | null;
    const area = Number((p.geo as unknown as { area_m2: number | null } | null)?.area_m2 ?? 0) || null;
    const fotos = ((p.media ?? []) as { storage_path: string; capa: boolean; tipo: string | null; ordem: number | null }[])
      .filter((m) => !m.tipo || m.tipo === "foto")
      .sort((a, b) => Number(b.capa) - Number(a.capa) || (a.ordem ?? 0) - (b.ordem ?? 0));
    const partes = [mun ? `${mun.nome}/${mun.uf}` : null, formatArea(area, p.tipo as "urbano" | "rural"), p.valor == null ? null : formatBRL(Number(p.valor))]
      .filter((x) => x && x !== "—");
    return [{
      codigo: p.codigo,
      legenda: `*${p.codigo}* · ${p.titulo}\n${partes.join(" · ")}\n${site}/imovel/${p.codigo}`,
      foto: fotos[0] ? fotoUrl(fotos[0].storage_path) : null,
    }];
  });
}

export type EnviarRobo = (texto: string) => Promise<void>;

/**
 * Uma resposta da Ari. Devolve false quando ela não pôde responder (limite do
 * dia ou falha); quem chamou passa a conversa para a equipe.
 */
export async function responderComAri(c: ConversaAri, texto: string, mensagemId: string, enviar: EnviarRobo, canal?: string, limiteDia = 40): Promise<"ok" | "limite" | "falha"> {
  const admin = supabaseAdmin();
  const hoje = hojeSP();
  const usadas = c.ari_dia === hoje ? (c.ari_respostas_dia ?? 0) : 0;
  if (usadas >= limiteDia) return "limite";
  await admin.from("atendimento_conversas").update({ ari_dia: hoje, ari_respostas_dia: usadas + 1 }).eq("id", c.id);

  let r;
  try {
    r = await responder({
      historico: await historico(c, mensagemId),
      pergunta: texto.slice(0, 2000),
      podeRegistrarLacuna: true,
      consultaTerritorial: false,
      instrucoesCanal: INSTRUCOES_WHATSAPP,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    console.error("ari whatsapp:", e instanceof Error ? e.message : e);
    return "falha";
  }
  const resposta = paraWhatsapp(r.texto);
  if (!resposta) return "falha";
  await enviar(resposta);

  // fotos dos imóveis citados (só WhatsApp; Instagram/Messenger ficam no texto)
  const codigos = [...new Set(r.fontes.filter((f) => f.tipo === "imovel" && f.href?.startsWith("/imovel/"))
    .map((f) => f.href!.slice("/imovel/".length)))].filter((cod) => resposta.includes(cod));
  if (codigos.length) {
    await admin.from("atendimento_conversas").update({ ari_ultimo_imovel: codigos[0] }).eq("id", c.id);
    c.ari_ultimo_imovel = codigos[0];
  }
  if (!contatoSocial(c.telefone)) {
    for (const card of (await cards(codigos.slice(0, 3)).catch(() => []))) {
      if (!card.foto) continue;
      try {
        const waId = await enviarImagemWhatsapp(c.telefone, card.foto, card.legenda, canal);
        await admin.from("whatsapp_mensagens").insert({ wa_id: waId || null, telefone: c.telefone, direcao: "saida", tipo: "image", texto: card.legenda, conversa_id: c.id, status: "sent" });
      } catch (e) {
        console.error("ari whatsapp: foto", card.codigo, e instanceof Error ? e.message : e);
      }
    }
  }
  return "ok";
}

/** Código de imóvel citado pelo cliente ("quero visitar a AIB-000123"). */
export function codigoNoTexto(texto: string) {
  // só código de anúncio (AIB-000123); código do CAR (MG-3134202-…) não conta
  return texto.toUpperCase().match(/\bAIB-\d{4,8}\b/)?.[0] ?? null;
}
