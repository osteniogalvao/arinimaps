import "server-only";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { urlDoSite } from "@/lib/compartilhar";
import { canalDoTitular } from "@/lib/confirmacao-whatsapp";
import { garantirCarJanela } from "@/lib/geo/carSobDemanda";
import { catalogoCotacoes, historicoCotacao } from "@/lib/mercado/cotacoes";
import { buscarSafra, formatarHectares, formatarToneladas, nomeProduto, safrasConab } from "@/lib/mercado/safras";
import { estatisticas, formatarData, formatarValor, formatarVariacao, localDaSerie, PRODUTOS, recortar, type CotacaoAtual } from "@/lib/mercado/formato";
import { telefoneWhatsapp } from "@/lib/meta";
import { parametrosLinkWhatsapp } from "@/lib/relatorio/link-whatsapp";
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
  | { tipo: "safra"; termo: string | null }
  | { tipo: "local"; lat: number; lng: number }
  | { tipo: "car"; cod: string };

/** Resposta do atendimento: texto e, quando o plano permite, o PDF do relatório. */
export type AnexoWhatsapp = { link: string; nome: string; legenda: string; mimetype?: string };
export type RespostaAtendimento = { texto: string; documento?: AnexoWhatsapp; anexos?: AnexoWhatsapp[] };

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
  const car = /^(?:consultar|consulta|relatorio|laudo)(?:\s+(?:do|de))?\s+car\s*[:#]?\s+([a-z]{2}-\d{7}-[\da-f.]{32,39})$/.exec(t);
  if (car) {
    const cod = car[1].toUpperCase().replace(/\./g, "");
    if (/^[A-Z]{2}-\d{7}-[A-F0-9]{32}$/.test(cod)) return { tipo: "car", cod };
  }
  if (/^(menu|ajuda|arini|atendimento|opcoes)$/.test(t)) return { tipo: "menu" };
  if (/^(boi|boi gordo|arroba|arroba do boi)$/.test(t)) return { tipo: "cotacao", termo: "boi gordo" };
  const cot = /^(?:cotacao|cotacoes)(?:\s+(?:do|da|de|dos|das))?(?:\s+(.{2,40}))?$/.exec(t);
  if (cot) return { tipo: "cotacao", termo: cot[1]?.trim() || null };
  const safra = /^(?:safra|safras|conab)(?:\s+(?:do|da|de|dos|das))?(?:\s+(.{2,40}))?$/.exec(t);
  if (safra) return { tipo: "safra", termo: safra[1]?.trim() || null };
  return cotacaoEmFrase(t);
}

/**
 * Pedido de preço em frase comum (áudio do Carlos, 17/11 16h43): "valor do boi
 * gordo hoje", "quanto tá a arroba?", "preço do milho". Precisa de uma palavra
 * de preço e de um produto, para não tirar do CRM uma conversa de negócio.
 */
const PRODUTO_NA_FRASE: [RegExp, string][] = [
  [/\b(boi|boi gordo|arroba)\b/, "boi gordo"],
  [/\bvacas?\b/, "vacas"],
  [/\bnovilhas?\b/, "novilhas"],
  [/\bmilho\b/, "milho"],
  [/\bsoja\b/, "soja"],
  [/\bfrangos?\b/, "frango"],
  [/\bdolar\b/, "dolar"],
];
export function cotacaoEmFrase(t: string): PedidoAtendimento | null {
  if (t.length > 80) return null;
  const produto = PRODUTO_NA_FRASE.find(([re]) => re.test(t))?.[1];
  if (!produto) return null;
  const sozinho = t.replace(/\b(hoje|agora|ai|por favor|pfv|pf)\b/g, "").replace(/\s+/g, " ").trim();
  const pedePreco = /\b(valor|preco|precos|cotacao|cotacoes|quanto|qto|quanto ta|quanto esta|ta pagando|pagando|referencia)\b/.test(t);
  if (!pedePreco && !PRODUTO_NA_FRASE.some(([re]) => new RegExp("^" + re.source + "$").test(sozinho))) return null;
  return { tipo: "cotacao", termo: produto };
}

/**
 * Número só de cotações (áudio do Carlos, 16/11 23h40): gratuito, sem conta.
 * Qualquer texto vira busca de cotação; saudação, MENU ou mídia mostram os destaques.
 */
export function pedidoLinhaCotacoes(m: Mensagem): PedidoAtendimento {
  const geral: PedidoAtendimento = { tipo: "cotacao", termo: null };
  if (m.type !== "text" || !m.text?.body) return geral;
  const pedido = pedidoAtendimento(m);
  if (pedido?.tipo === "cotacao" || pedido?.tipo === "safra") return pedido;
  const t = semAcento(m.text.body).replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40 || /^(menu|ajuda|oi|ola|bom dia|boa tarde|boa noite|cotacao|cotacoes|inicio)\b/.test(t)) return geral;
  return { tipo: "cotacao", termo: t };
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
    "• BOI (ou \"valor do boi gordo hoje\"): cotação do boi gordo com a referência dos últimos 7 e 30 dias, grátis",
    "• COTAÇÃO MILHO (ou SOJA, DÓLAR...): outras cotações",
    "• SAFRA SOJA (ou MILHO, CAFÉ...): produção, área e produtividade da safra pela CONAB",
    "• Envie a sua LOCALIZAÇÃO (clipe › Localização) para receber o imóvel do CAR naquele ponto, o relatório em PDF e a rota de como chegar",
    "• CONSULTAR CAR seguido do código do imóvel, para receber o relatório em PDF",
    "• Nos planos com exportação, a área vem também em KMZ e KML; com consulta de área, vem o link do Tour 3D",
  ];
  const a = conta?.acesso;
  if (a?.recursos.has("relatorio_territorial")) linhas.push("", "Seu plano inclui o relatório territorial completo com as fontes oficiais.");
  else if (a?.recursos.has("consulta_area")) linhas.push("", "Seu plano inclui a consulta de área nas fontes oficiais (cota mensal).");
  else linhas.push("", `Relatório territorial e consulta nas fontes oficiais: veja os planos em ${site}/planos`);
  return linhas.join("\n");
}

async function linhaCotacao(s: CotacaoAtual, comPeriodos: boolean) {
  const lugar = localDaSerie(s);
  const partes = [`• ${s.nome}${lugar && !s.nome.includes(lugar) ? " " + lugar : ""}: ${formatarValor(s.valor, s.casas)} ${s.unidade}, ${formatarData(s.data)}`];
  const periodos: string[] = [];
  if (s.variacao != null) periodos.push(`dia ${formatarVariacao(s.variacao)}`);
  if (comPeriodos) {
    const historico = await historicoCotacao(s.id);
    for (const [rotulo, dias] of [["7 dias", 7], ["30 dias", 30]] as const) {
      const e = estatisticas(recortar(historico, dias));
      if (e && e.n > 1) periodos.push(`${rotulo} ${formatarVariacao(e.variacao)}`);
    }
  }
  if (periodos.length) partes.push(`  (${periodos.join(" · ")})`);
  partes.push(`  Fonte: ${s.fonte}`);
  return partes.join("\n");
}

function produtosDisponiveis(series: CotacaoAtual[]) {
  const nomes = [...new Set(series.map((s) => PRODUTOS[s.produto] ?? s.produto))].slice(0, 12);
  return nomes.length ? `Envie o nome do produto para ver as praças: ${nomes.join(", ")}.` : "";
}

async function textoCotacao(termo: string | null, linhaDedicada = false) {
  const site = urlDoSite();
  const series = await catalogoCotacoes();
  if (!series.length) return `As cotações estão indisponíveis agora. Veja em ${site}/mercado`;
  let escolhidas: CotacaoAtual[] = [];
  if (termo) {
    const t = semAcento(termo);
    const produto = Object.entries(PRODUTOS).find(([slug, nome]) => semAcento(nome) === t || slug === t.replace(/\s+/g, "-"))?.[0];
    const palavras = t.split(" ").filter((w) => w.length > 2 && !["do", "da", "de", "em"].includes(w));
    escolhidas = series.filter((s) => {
      if (produto) return s.produto === produto;
      const alvo = semAcento(`${PRODUTOS[s.produto] ?? ""} ${s.nome} ${s.descricao ?? ""} ${s.praca ?? ""} ${s.uf ?? ""}`);
      return palavras.length > 0 && palavras.every((w) => alvo.includes(w));
    });
    // praça digitada que não existe: fica com o produto citado no começo do termo
    if (!escolhidas.length && !produto) {
      const doTermo = Object.entries(PRODUTOS).find(([, nome]) => t.startsWith(semAcento(nome)))?.[0];
      if (doTermo) escolhidas = series.filter((s) => s.produto === doTermo);
    }
    // indicadores nacionais primeiro, depois as praças
    escolhidas.sort((a, b) => Number(!!a.praca) - Number(!!b.praca) || a.ordem - b.ordem);
    escolhidas = escolhidas.slice(0, 6);
  }
  const achou = escolhidas.length > 0;
  if (!achou && termo && !linhaDedicada) return `Não encontrei cotação para "${termo}". Veja todas em ${site}/mercado\n${RODAPE}`;
  if (!achou) escolhidas = series.filter((s) => s.destaque).slice(0, 8);
  const linhas = await Promise.all(escolhidas.map((s) => linhaCotacao(s, achou)));
  return [
    !achou && termo ? `Não encontrei cotação para "${termo}". Estes são os destaques de hoje:` : `Cotações ARINI${achou ? ": " + termo : ""}`,
    ...linhas,
    "",
    linhaDedicada ? produtosDisponiveis(series) : "",
    `Gráficos, histórico e outras praças: ${site}/mercado`,
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");
}

/** Safra de grãos pela CONAB (camada "CONAB safras" do Dados Fazenda, pedido de 17/11). */
async function textoSafra(termo: string | null) {
  const site = urlDoSite();
  const lista = await safrasConab();
  if (!lista.length) return `As safras da CONAB estão indisponíveis agora. Veja em ${site}/mercado#safras`;
  const achadas = termo ? buscarSafra(lista, termo).slice(0, 4) : [];
  const escolhidas = achadas.length ? achadas : lista.slice(0, 6);
  const linhas = escolhidas.map((s) => {
    const partes = [`• ${nomeProduto(s.produto)}: ${formatarToneladas(s.producaoMilT)} em ${formatarHectares(s.areaMilHa)}`];
    const extra: string[] = [];
    if (s.produtividade) extra.push(`${Math.round(s.produtividade).toLocaleString("pt-BR")} kg/ha`);
    if (s.variacao != null && s.anterior) extra.push(`${s.variacao >= 0 ? "+" : ""}${s.variacao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% sobre ${s.anterior.safra}`);
    if (extra.length) partes.push(`  (${extra.join(" · ")})`);
    if (achadas.length && s.ufs.length) partes.push(`  Maiores produtores: ${s.ufs.slice(0, 5).map((u) => `${u.uf} ${formatarToneladas(u.producaoMilT)}`).join(", ")}`);
    return partes.join("\n");
  });
  const s0 = escolhidas[0];
  return [
    !achadas.length && termo ? `Não encontrei a safra de "${termo}". Estas são as maiores da safra ${s0.safra}:` : `Safra ${s0.safra} (CONAB${s0.levantamento ? ", " + s0.levantamento : ""})`,
    ...linhas,
    "",
    `Todas as culturas: ${site}/mercado#safras`,
  ].join("\n");
}

/** Rota até o ponto no Google Maps (abre o app no celular). */
export function linkComoChegar(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
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

async function imovelPorCodigo(cod: string): Promise<ImovelCar | null> {
  const { data, error } = await supabaseAdmin().rpc("fn_car_imovel", { p_cod: cod });
  if (error) throw Error("Falha ao consultar o CAR.");
  const p = (data as { properties?: ImovelCar } | null)?.properties;
  return p ? { ...p, cod } : null;
}

/**
 * Item 13.1 das "novas implementações" (17/11): quem pede pelo WhatsApp recebe
 * direto o PDF que o plano libera, sem pedir à empresa. Relatório completo para
 * planos com relatório territorial; simples para os demais.
 */
function respostaImovel(imovel: ImovelCar | null, conta: Conta | null, origem: "ponto" | "codigo", ponto?: { lat: number; lng: number }): RespostaAtendimento {
  const site = urlDoSite();
  // Áudio do Carlos (25/11, 12h14): "como chegar na fazenda" junto com o ponto enviado
  const rota = ponto ? `Como chegar (rota no Google Maps): ${linkComoChegar(ponto.lat, ponto.lng)}` : null;
  if (!imovel) {
    return { texto: [
      origem === "ponto" ? "Não encontrei imóvel rural do CAR neste ponto." : "Não encontrei este código na base do CAR.",
      rota,
      `Abra o mapa da ARINI para conferir a área ou informar um imóvel ausente: ${site}/mapa`,
      RODAPE,
    ].filter((l): l is string => l !== null).join("\n") };
  }
  const area = imovel.area_ha == null ? null : `${formatarValor(Number(imovel.area_ha), 2)} ha`;
  const a = conta?.acesso;
  const completo = !!a?.recursos.has("relatorio_territorial");
  const linhas = [
    origem === "ponto" ? "Imóvel do CAR neste ponto:" : "Imóvel do CAR:",
    `• Código: ${imovel.cod}`,
    imovel.municipio ? `• Município: ${imovel.municipio}` : null,
    area ? `• Área declarada: ${area}` : null,
    imovel.condicao ? `• Situação: ${imovel.condicao}` : null,
    "",
    completo
      ? `Segue o relatório territorial completo do seu plano (${a?.planNome ?? "ARINI"}), com as fontes oficiais.`
      : "Segue o relatório simples da área.",
    `Ficha, mapa e relatório personalizado: ${site}/consulta/car/${imovel.cod}`,
    rota,
  ].filter((l): l is string => l !== null);
  // Áudio do Carlos (24/11, 8h05): arquivos KMZ/KML e o Tour 3D conforme o plano do contratante
  const exporta = !!a?.recursos.has("ferramenta_exportar");
  const tour = !!a?.recursos.has("consulta_area");
  if (tour) linhas.push(`Tour 3D da área (entre com a sua conta ARINI): ${site}/consulta/car/${imovel.cod}?tour=1`);
  if (exporta) linhas.push("Em seguida vão o perímetro em KMZ (Google Earth) e em KML.");
  else if (conta && (completo || tour)) linhas.push(`Os arquivos KMZ/KML da área não estão no seu plano (${a?.planNome ?? "Gratuito"}). Veja os planos: ${site}/planos`);
  if (!completo) {
    if (a?.recursos.has("consulta_area")) linhas.push("Seu plano inclui a consulta desta área nas fontes oficiais (IBAMA, ICMBio, INPE, ANM, SIGEF...), dentro da cota do mês.");
    else if (conta) linhas.push(`O relatório completo não está no seu plano (${a?.planNome ?? "Gratuito"}). Veja os planos: ${site}/planos`);
    else linhas.push(`Para receber o relatório do seu plano por aqui, confirme este WhatsApp na sua conta: ${site}/conta`);
  }
  const modelo = completo ? "completo" : "simples";
  const arquivo = (formato: "kmz" | "kml") => ({
    link: `${site}/api/consulta/car/${encodeURIComponent(imovel.cod)}/arquivo?formato=${formato}${parametrosLinkWhatsapp(imovel.cod, formato)}`,
    nome: `ARINI-${imovel.cod}.${formato}`,
    legenda: `Perímetro do CAR em ${formato.toUpperCase()} · ${imovel.cod}`,
    mimetype: formato === "kmz" ? "application/vnd.google-earth.kmz" : "application/vnd.google-earth.kml+xml",
  });
  return {
    texto: linhas.join("\n"),
    anexos: exporta ? [arquivo("kmz"), arquivo("kml")] : [],
    documento: {
      // assinado: o provedor do WhatsApp baixa o PDF sem a sessão do cliente
      link: `${site}/api/consulta/car/${encodeURIComponent(imovel.cod)}/relatorio?modelo=${modelo}${parametrosLinkWhatsapp(imovel.cod, modelo)}`,
      nome: `ARINI-${imovel.cod}-${modelo}.pdf`,
      legenda: `Relatório territorial ${modelo} · ${imovel.cod}`,
    },
  };
}

/** Resposta ao pedido. Nunca lança: uma falha vira um aviso para tentar de novo. */
export async function respostaAtendimento(pedido: PedidoAtendimento, numero: string, linhaCotacoes = false): Promise<RespostaAtendimento> {
  try {
    if (pedido.tipo === "safra") return { texto: await textoSafra(pedido.termo) };
    if (linhaCotacoes) return { texto: await textoCotacao(pedido.tipo === "cotacao" ? pedido.termo : null, true) };
    if (pedido.tipo === "cotacao") return { texto: await textoCotacao(pedido.termo) };
    const conta = await contaDoNumero(numero).catch(() => null);
    if (pedido.tipo === "menu") return { texto: textoMenu(conta) };
    if (pedido.tipo === "car") return respostaImovel(await imovelPorCodigo(pedido.cod), conta, "codigo");
    return respostaImovel(await carNoPonto(pedido.lat, pedido.lng), conta, "ponto", { lat: pedido.lat, lng: pedido.lng });
  } catch {
    return { texto: `Não consegui responder agora. Tente de novo em alguns minutos ou use o site: ${urlDoSite()}\n${RODAPE}` };
  }
}
