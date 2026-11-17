import "server-only";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { urlDoSite } from "@/lib/compartilhar";
import { canalDoTitular } from "@/lib/confirmacao-whatsapp";
import { garantirCarJanela } from "@/lib/geo/carSobDemanda";
import { catalogoCotacoes } from "@/lib/mercado/cotacoes";
import { formatarData, formatarValor, formatarVariacao, localDaSerie, PRODUTOS, type CotacaoAtual } from "@/lib/mercado/formato";
import { telefoneWhatsapp } from "@/lib/meta";
import { acessoDe } from "@/lib/planos-servidor";
import type { Acesso } from "@/lib/planos";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Atendimento automático pelo WhatsApp da ARINI (áudio do Carlos, 16/11/2026,
 * "igual o Dados Fazenda faz, só que com mais funções"): a pessoa pede pelo
 * WhatsApp sem entrar no site, o sistema reconhece a conta pelo número já
 * confirmado e responde conforme o plano.
 *
 * Só comandos explícitos e a localização abrem o atendimento. O resto da
 * conversa segue para o CRM como antes (webhook do WhatsApp).
 */

export type PedidoAtendimento =
  | { tipo: "menu" }
  | { tipo: "cotacao"; termo: string | null }
  | { tipo: "local"; lat: number; lng: number };

type Mensagem = { type: string; text?: { body: string }; location?: { latitude?: number; longitude?: number } };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Reconhece o pedido. Devolve null para conversa comum (vai ao CRM). */
export function pedidoAtendimento(m: Mensagem): PedidoAtendimento | null {
  if (m.type === "location") {
    const lat = Number(m.location?.latitude), lng = Number(m.location?.longitude);
    // o CAR é só do Brasil
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lng < -75 || lng > -28 || lat < -35 || lat > 7) return null;
    return { tipo: "local", lat, lng };
  }
  if (m.type !== "text" || !m.text?.body) return null;
  const t = semAcento(m.text.body).replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
  if (/^(menu|ajuda|arini|atendimento|opcoes)$/.test(t)) return { tipo: "menu" };
  if (/^(boi|boi gordo|arroba|arroba do boi)$/.test(t)) return { tipo: "cotacao", termo: "boi gordo" };
  const cot = /^(?:cotacao|cotacoes)(?:\s+(?:do|da|de|dos|das))?(?:\s+(.{2,40}))?$/.exec(t);
  if (cot) return { tipo: "cotacao", termo: cot[1]?.trim() || null };
  return null;
}

type Conta = { titular: string; nome: string; acesso: Acesso };

/**
 * Conta dona do número, só quando o WhatsApp foi confirmado na conta
 * (/conta › confirmar WhatsApp). Número sem confirmação é tratado como visitante:
 * o plano de alguém nunca vale para quem só digitou o mesmo telefone.
 */
export async function contaDoNumero(numero: string): Promise<Conta | null> {
  const tel = telefoneWhatsapp(numero);
  if (!tel) return null;
  const db = supabaseAdmin();
  const { data: titular, error } = await db.rpc("assinatura_titular_telefone", { p_numero: tel });
  if (error) throw Error("Falha ao identificar o número.");
  if (!titular) return null;
  const canal = await canalDoTitular(titular as string);
  if (!canal?.verificado || canal.telefone !== tel) return null;
  const [{ data: perfil }, acesso] = await Promise.all([
    db.from("profiles").select("nome").eq("user_id", titular).maybeSingle(),
    acessoDe(titular as string),
  ]);
  return { titular: titular as string, nome: String(perfil?.nome ?? "").split(" ")[0], acesso };
}

const RODAPE = "Envie MENU para ver as opções.";

function textoMenu(conta: Conta | null) {
  const site = urlDoSite();
  const linhas = [
    conta ? `Olá${conta.nome ? ", " + conta.nome : ""}! Atendimento ARINI.` : "Olá! Atendimento ARINI.",
    conta
      ? `Plano: ${conta.acesso.planNome ?? "Gratuito"}${conta.acesso.vencido ? " (vencido)" : ""}.`
      : `Não encontrei uma conta ARINI com este WhatsApp confirmado. Para receber as respostas do seu plano, confirme o número em ${site}/conta.`,
    "",
    "O que você pode pedir por aqui:",
    "• BOI: cotação do boi gordo",
    "• COTAÇÃO MILHO (ou SOJA, DÓLAR...): outras cotações",
    "• Envie a sua LOCALIZAÇÃO (clipe › Localização) para ver o imóvel do CAR naquele ponto",
    "• CONSULTAR CAR seguido do código do imóvel",
  ];
  const a = conta?.acesso;
  if (a?.recursos.has("relatorio_territorial")) linhas.push("", "Seu plano inclui o relatório territorial completo com as fontes oficiais.");
  else if (a?.recursos.has("consulta_area")) linhas.push("", "Seu plano inclui a consulta de área nas fontes oficiais (cota mensal).");
  else linhas.push("", `Relatório territorial e consulta nas fontes oficiais: veja os planos em ${site}/planos`);
  return linhas.join("\n");
}

function linhaCotacao(s: CotacaoAtual) {
  const lugar = localDaSerie(s);
  const variacao = s.variacao == null ? "" : ` (${formatarVariacao(s.variacao)})`;
  return `• ${s.nome}${lugar && !s.nome.includes(lugar) ? " " + lugar : ""}: ${formatarValor(s.valor, s.casas)} ${s.unidade}${variacao}, ${formatarData(s.data)}. Fonte: ${s.fonte}`;
}

async function textoCotacao(termo: string | null) {
  const site = urlDoSite();
  const series = await catalogoCotacoes();
  if (!series.length) return `As cotações estão indisponíveis agora. Veja em ${site}/mercado`;
  let escolhidas: CotacaoAtual[];
  if (!termo) {
    escolhidas = series.filter((s) => s.destaque).slice(0, 8);
  } else {
    const t = semAcento(termo);
    const produto = Object.entries(PRODUTOS).find(([slug, nome]) => semAcento(nome) === t || slug === t.replace(/\s+/g, "-"))?.[0];
    escolhidas = series.filter((s) => (produto ? s.produto === produto : semAcento(`${s.nome} ${s.descricao ?? ""}`).includes(t)));
    // indicadores nacionais primeiro, depois as praças
    escolhidas.sort((a, b) => Number(!!a.praca) - Number(!!b.praca) || a.ordem - b.ordem);
    escolhidas = escolhidas.slice(0, 6);
  }
  if (!escolhidas.length) return `Não encontrei cotação para "${termo}". Veja todas em ${site}/mercado\n${RODAPE}`;
  return [`Cotações ARINI${termo ? ": " + termo : ""}`, ...escolhidas.map(linhaCotacao), "", `Histórico e outras praças: ${site}/mercado`].join("\n");
}

type ImovelCar = { cod: string; area_ha: number | null; condicao: string | null; status: string | null; tipo: string | null; municipio: string | null };

/** Imóvel do CAR que contém o ponto (o menor, se houver sobreposição). */
async function carNoPonto(lat: number, lng: number): Promise<ImovelCar | null> {
  // garante a célula do SICAR, sem segurar a resposta além de ~12 s
  await Promise.race([
    garantirCarJanela({ xmin: lng - 0.001, ymin: lat - 0.001, xmax: lng + 0.001, ymax: lat + 0.001 }).catch(() => null),
    new Promise((ok) => setTimeout(ok, 12_000)),
  ]);
  const d = 0.0005;
  const { data, error } = await supabaseAdmin().rpc("fn_car_bbox", { p_x0: lng - d, p_y0: lat - d, p_x1: lng + d, p_y1: lat + d, p_limite: 50 });
  if (error) throw Error("Falha ao consultar o CAR.");
  const features = ((data as { features?: Feature<Polygon | MultiPolygon, ImovelCar>[] } | null)?.features ?? [])
    .filter((f) => f.geometry && booleanPointInPolygon([lng, lat], f));
  features.sort((a, b) => Number(a.properties.area_ha ?? Infinity) - Number(b.properties.area_ha ?? Infinity));
  return features[0]?.properties ?? null;
}

async function textoLocal(lat: number, lng: number, conta: Conta | null) {
  const site = urlDoSite();
  const imovel = await carNoPonto(lat, lng);
  if (!imovel) {
    return [
      "Não encontrei imóvel rural do CAR neste ponto.",
      `Abra o mapa da ARINI para conferir a área ou informar um imóvel ausente: ${site}/mapa`,
      RODAPE,
    ].join("\n");
  }
  const area = imovel.area_ha == null ? null : `${formatarValor(Number(imovel.area_ha), 2)} ha`;
  const linhas = [
    "Imóvel do CAR neste ponto:",
    `• Código: ${imovel.cod}`,
    imovel.municipio ? `• Município: ${imovel.municipio}` : null,
    area ? `• Área declarada: ${area}` : null,
    imovel.condicao ? `• Situação: ${imovel.condicao}` : null,
    "",
    `Ficha e PDF: ${site}/consulta/car/${imovel.cod}`,
  ].filter((l): l is string => l !== null);
  const a = conta?.acesso;
  if (a?.recursos.has("relatorio_territorial")) {
    linhas.push("Seu plano inclui o relatório territorial completo: entre na conta pelo link e baixe o relatório com todas as fontes oficiais.");
  } else if (a?.recursos.has("consulta_area")) {
    linhas.push("Seu plano inclui a consulta desta área nas fontes oficiais (IBAMA, ICMBio, INPE, ANM, SIGEF...), dentro da cota do mês.");
  } else if (conta) {
    linhas.push(`O relatório territorial com as fontes oficiais não está no seu plano (${a?.planNome ?? "Gratuito"}). Veja os planos: ${site}/planos`);
  } else {
    linhas.push(`Para receber o relatório do seu plano por aqui, confirme este WhatsApp na sua conta: ${site}/conta`);
  }
  return linhas.join("\n");
}

/** Texto da resposta. Nunca lança: uma falha vira um aviso para tentar de novo. */
export async function respostaAtendimento(pedido: PedidoAtendimento, numero: string) {
  try {
    const conta = await contaDoNumero(numero).catch(() => null);
    if (pedido.tipo === "menu") return textoMenu(conta);
    if (pedido.tipo === "cotacao") return await textoCotacao(pedido.termo);
    return await textoLocal(pedido.lat, pedido.lng, conta);
  } catch {
    return `Não consegui responder agora. Tente de novo em alguns minutos ou use o site: ${urlDoSite()}\n${RODAPE}`;
  }
}
