import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processamentoLigado } from "@/lib/sentinel/copernicus";
import { alcanceDaFonte } from "@/lib/rural/raios";
import { imoveisDaVitrine } from "@/lib/imovel/vitrine";
import { formatArea, formatBRL, STATUS_LABEL } from "@/lib/format";

/**
 * As ÚNICAS coisas que o assistente consegue fazer no sistema (Segurança 18:
 * "a IA consulta os dados com a permissão de quem perguntou").
 *
 * Regras que valem para todas:
 *  · só leitura, por funções escritas aqui — nada de SQL livre;
 *  · só o que um visitante já vê no site: vitrine pública (mesma consulta de
 *    /imoveis), ficha pública (fn_property_public), dados públicos do CAR e
 *    resultados de consulta já gravados (nunca dispara consulta nova, que é
 *    paga/limitada), e artigos PUBLICADOS da base de conhecimento;
 *  · sem dado pessoal: nada de dono, parceiro, telefone, documento, lead;
 *  · a única escrita é `registrar_lacuna`: grava a pergunta sem resposta (já
 *    sem CPF/telefone/e-mail) numa fila de curadoria humana que o assistente
 *    nunca lê de volta — só vira conhecimento depois que alguém publica artigo;
 *  · tudo que volta é DADO, entregue como JSON — o prompt de sistema manda o
 *    modelo ignorar qualquer instrução que apareça dentro desses dados.
 */

export type Fonte = { tipo: "imovel" | "car" | "conhecimento"; rotulo: string; href?: string };
export type ResultadoFerramenta = { conteudo: string; fontes: Fonte[]; ok: boolean };

export const FERRAMENTA_ROTULO: Record<string, string> = {
  buscar_imoveis: "Buscando imóveis publicados",
  detalhes_imovel: "Lendo a ficha do imóvel",
  consultar_area_car: "Consultando a área do CAR",
  buscar_conhecimento: "Consultando a base de conhecimento",
  buscar_consultas_anteriores: "Procurando consultas territoriais já feitas",
  inteligencia_mercado: "Lendo os números de mercado da região",
  registrar_lacuna: "Anotando a pergunta para a equipe",
};

// eager_input_streaming: as entradas chegam enquanto são geradas; como o
// servidor deixa de validá-las, cada executor abaixo valida e normaliza a sua.
export const FERRAMENTAS: Anthropic.Beta.BetaTool[] = [
  {
    name: "buscar_imoveis",
    description:
      "Busca imóveis PUBLICADOS na vitrine pública da ARINI (mesma busca da página /imoveis). Use para pedidos como " +
      "\"lotes de R$ 40 mil em Iturama\" ou \"fazendas acima de 100 ha em União de Minas\". Lote, casa, terreno na cidade = tipo urbano; " +
      "fazenda, sítio, chácara, área rural = tipo rural. Para valor aproximado (\"de R$ 40 mil\"), use uma faixa de cerca de ±20%. " +
      "Devolve no máximo 15 imóveis com código, título, município, valor, área e o link da ficha.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["rural", "urbano"], description: "rural ou urbano" },
        modalidade: { type: "string", enum: ["venda", "leilao"], description: "venda comum ou leilão" },
        municipio: { type: "string", description: "nome do município, ex.: Iturama" },
        texto: { type: "string", description: "palavras do título ou código do anúncio" },
        preco_min: { type: "number", description: "valor mínimo em reais" },
        preco_max: { type: "number", description: "valor máximo em reais" },
        area_min_ha: { type: "number", description: "área mínima em hectares (rural)" },
        area_max_ha: { type: "number", description: "área máxima em hectares (rural)" },
        area_min_m2: { type: "number", description: "área mínima em m² (urbano)" },
        area_max_m2: { type: "number", description: "área máxima em m² (urbano)" },
        ordem: { type: "string", enum: ["recentes", "menor_preco", "maior_preco", "maior_area"] },
        incluir_vendidos: { type: "boolean", description: "incluir imóveis já vendidos (padrão: não)" },
        limite: { type: "integer", minimum: 1, maximum: 15 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "detalhes_imovel",
    description:
      "Lê a ficha PÚBLICA de um imóvel pelo código (ex.: AIB-000002): descrição, valor, área medida e declarada, " +
      "características, condições de venda, dados de leilão e pontos de interesse próximos. Não traz dados do proprietário.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { codigo: { type: "string", description: "código do anúncio, ex.: AIB-000002" } },
      required: ["codigo"],
      additionalProperties: false,
    },
  },
  {
    name: "consultar_area_car",
    description:
      "Informações de uma área do CAR (Cadastro Ambiental Rural) pelo código do imóvel no SICAR (ex.: MG-3134400-F0B5DB13...): " +
      "área declarada, município, situação do cadastro, se está anunciada, e os resultados JÁ GRAVADOS do cruzamento com fontes " +
      "oficiais (mineração, terras indígenas, desmatamento, água etc.). Não faz consulta nova. Lembre que o CAR não comprova propriedade.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { codigo_car: { type: "string", description: "código do imóvel no CAR, formato UF-IBGE-HASH" } },
      required: ["codigo_car"],
      additionalProperties: false,
    },
  },
  {
    name: "buscar_conhecimento",
    description:
      "Pesquisa a base de conhecimento oficial da Arini (artigos com fonte e data): como funciona a publicação, comissão, planos, " +
      "CAR, consulta de área, solicitações cartográficas, privacidade/LGPD, leilões, pré-avaliação etc. Use SEMPRE antes de responder " +
      "dúvidas sobre regras, processos ou o funcionamento do sistema.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { consulta: { type: "string", description: "palavras-chave ou a pergunta em português" } },
      required: ["consulta"],
      additionalProperties: false,
    },
  },
  {
    name: "buscar_consultas_anteriores",
    description:
      "Procura consultas territoriais JÁ FEITAS no sistema (áreas do CAR, lotes urbanos e imóveis anunciados) e devolve o resumo " +
      "de cada uma: município, código do CAR, o que cada fonte oficial encontrou (embargos, SIGEF, terras indígenas, mineração, " +
      "queimadas, desmatamento, água, energia etc.) e a DATA de cada dado. Use para \"já consultaram alguma área com embargo em " +
      "Iturama?\", \"o que se sabe da área MG-3134400-...\" ou \"tem queimada perto de ...\". Informe ao menos um filtro. " +
      "Não faz consulta nova e não diz quem consultou.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        municipio: { type: "string", description: "nome do município, ex.: Iturama" },
        uf: { type: "string", description: "sigla do estado, ex.: MG" },
        codigo_car: { type: "string", description: "código do CAR (inteiro ou o começo, mín. 10 caracteres)" },
        termo: { type: "string", description: "o que procurar nos resultados, ex.: embargo, mineração, terra indígena, queimada" },
        limite: { type: "integer", minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "inteligencia_mercado",
    description:
      "Números AGREGADOS de mercado de um município: quantos anúncios publicados, preço mediano por hectare (rural) ou por m² " +
      "(urbano), faixa típica (25% a 75% dos anúncios) e, quando houver, vendas registradas — com a data do cálculo. Use para " +
      "\"quanto vale o hectare em Iturama?\" ou \"qual o preço do m² de lote em Carneirinho?\". É referência a partir de valores " +
      "anunciados, não avaliação do imóvel de ninguém.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        municipio: { type: "string", description: "nome do município, ex.: Iturama" },
        uf: { type: "string", description: "sigla do estado, ex.: MG" },
        tipo: { type: "string", enum: ["rural", "urbano"], description: "rural (R$/ha) ou urbano (R$/m²); sem tipo, traz os dois" },
      },
      required: ["municipio"],
      additionalProperties: false,
    },
  },
  {
    name: "registrar_lacuna",
    description:
      "Registra uma pergunta que você NÃO conseguiu responder com as outras ferramentas (sem resultado ou sem a informação), " +
      "para a equipe da Arini responder na base de conhecimento. Chame no máximo uma vez por resposta, depois de tentar as " +
      "ferramentas certas. Escreva a pergunta de forma curta e genérica, sem nome, CPF, telefone, e-mail ou outro dado pessoal. " +
      "Não use para assuntos fora do escopo, recusas ou pedidos de dado pessoal.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        pergunta: { type: "string", description: "a dúvida, curta e genérica, ex.: \"Qual o prazo para receber a comissão?\"" },
        motivo: { type: "string", description: "por que não deu para responder, ex.: nenhum artigo sobre o assunto" },
      },
      required: ["pergunta"],
      additionalProperties: false,
    },
  },
];

// ------------------------------------------------------------------ validação
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const txt = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const json = (v: unknown) => JSON.stringify(v);
const dataBR = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;
const siglaUf = (v: unknown) => { const t = txt(v, 2)?.toUpperCase(); return t && /^[A-Z]{2}$/.test(t) ? t : undefined; };
/** "Iturama/MG", "Iturama - MG" ou "Iturama, MG" → nome e UF separados. */
function municipioUf(e: Record<string, unknown>) {
  const bruto = txt(e.municipio, 80);
  const m = bruto?.match(/^(.+?)\s*(?:\/|-|,)\s*([A-Za-z]{2})$/);
  return { municipio: m ? m[1].trim() : bruto, uf: siglaUf(e.uf) ?? (m ? m[2].toUpperCase() : undefined) };
}

/**
 * Tira dado pessoal de texto livre antes de gravar (LGPD): e-mail, CNPJ, CPF
 * e telefone viram marcadores. A ordem importa: CNPJ antes do CPF (o CPF
 * casaria com um pedaço do CNPJ). Código do CAR (UF-7 dígitos-hash), áreas e
 * valores comuns passam intactos.
 */
export function semDadosPessoais(texto: string) {
  return texto
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[e-mail]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[CNPJ]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF]")
    .replace(/(?:\+?55[\s-]?)?(?:\(\d{2}\)|\b\d{2})[\s-]?9?\d{4}[\s-]?\d{4}\b/g, "[telefone]")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------------ executores
async function buscarImoveis(e: Record<string, unknown>): Promise<ResultadoFerramenta> {
  const tipo = e.tipo === "rural" || e.tipo === "urbano" ? e.tipo : undefined;
  const modalidade = e.modalidade === "leilao" || e.modalidade === "venda" ? e.modalidade : undefined;
  const municipio = txt(e.municipio, 80);
  const texto = txt(e.texto, 80);
  const [pMin, pMax] = [num(e.preco_min), num(e.preco_max)];
  const [haMin, haMax, m2Min, m2Max] = [num(e.area_min_ha), num(e.area_max_ha), num(e.area_min_m2), num(e.area_max_m2)];
  const limite = Math.min(15, Math.max(1, Math.round(num(e.limite) ?? 8)));
  const ordem = txt(e.ordem, 20) ?? "recentes";

  const { data, error } = await imoveisDaVitrine();
  if (error) return { ok: false, fontes: [], conteudo: json({ erro: "A busca de imóveis não respondeu agora." }) };

  type Linha = NonNullable<typeof data>[number];
  const munDe = (p: Linha) => p.municipality as unknown as { nome: string; uf: string } | null;
  const areaDe = (p: Linha) => Number((p.geo as unknown as { area_m2: number | null } | null)?.area_m2 ?? 0);

  let lista = (data ?? []).filter((p) => {
    if (p.status === "vendido" && e.incluir_vendidos !== true) return false;
    if (tipo && p.tipo !== tipo) return false;
    if (modalidade && (p.modalidade ?? "venda") !== modalidade) return false;
    if (municipio && !norm(munDe(p)?.nome ?? "").includes(norm(municipio))) return false;
    if (texto && !norm(`${p.titulo} ${p.codigo}`).includes(norm(texto))) return false;
    const valor = p.valor == null ? null : Number(p.valor);
    if (pMin != null && (valor == null || valor < pMin)) return false;
    if (pMax != null && (valor == null || valor > pMax)) return false;
    const a = areaDe(p);
    if (haMin != null && a / 10_000 < haMin) return false;
    if (haMax != null && (!a || a / 10_000 > haMax)) return false;
    if (m2Min != null && a < m2Min) return false;
    if (m2Max != null && (!a || a > m2Max)) return false;
    return true;
  });
  lista = lista.sort((a, b) => {
    if (ordem === "menor_preco") return Number(a.valor ?? Infinity) - Number(b.valor ?? Infinity);
    if (ordem === "maior_preco") return Number(b.valor ?? 0) - Number(a.valor ?? 0);
    if (ordem === "maior_area") return areaDe(b) - areaDe(a);
    return String(b.published_at ?? "").localeCompare(String(a.published_at ?? ""));
  });

  const imoveis = lista.slice(0, limite).map((p) => {
    const m = munDe(p);
    return {
      codigo: p.codigo, titulo: p.titulo, tipo: p.tipo, modalidade: p.modalidade ?? "venda",
      situacao: STATUS_LABEL[p.status] ?? p.status,
      municipio: m ? `${m.nome}/${m.uf}` : null,
      valor: p.valor == null ? null : Number(p.valor), valor_formatado: formatBRL(p.valor == null ? null : Number(p.valor)),
      area_formatada: formatArea(areaDe(p) || null, p.tipo as "urbano" | "rural"),
      link: `/imovel/${p.codigo}`,
    };
  });
  return {
    ok: true,
    fontes: imoveis.map((i) => ({ tipo: "imovel" as const, rotulo: `${i.codigo} — ${i.titulo}`, href: i.link })),
    conteudo: json({
      total_encontrado: lista.length, mostrando: imoveis.length, imoveis,
      observacao: "Somente anúncios aprovados e publicados na vitrine pública. Valores são os anunciados.",
    }),
  };
}

const CARACTERISTICAS_PUBLICAS = ["quartos", "suites", "banheiros", "vagas", "zoneamento", "solo", "benfeitorias", "unidade_area"];

async function detalhesImovel(e: Record<string, unknown>): Promise<ResultadoFerramenta> {
  const codigo = txt(e.codigo, 40)?.toUpperCase();
  if (!codigo || !/^[A-Z0-9-]{4,40}$/.test(codigo)) return { ok: false, fontes: [], conteudo: json({ erro: "Código inválido." }) };
  const admin = supabaseAdmin();
  const { data } = await admin.rpc("fn_property_public", { p_codigo: codigo });
  const p = data as {
    id: string; codigo: string; tipo: "urbano" | "rural"; status: string; titulo: string; descricao: string;
    valor: number | null; area_declarada: number | null; caracteristicas: Record<string, unknown> | null;
    condicoes_venda: string | null; aceita_permuta: boolean; aceita_financiamento: boolean;
    municipio: { nome: string; uf: string } | null; area_m2: number | null; perimeter_m: number | null; published_at: string | null;
  } | null;
  if (!p) return { ok: false, fontes: [], conteudo: json({ erro: `Nenhum anúncio publicado com o código ${codigo}.` }) };

  const [{ data: extra }, { data: pois }] = await Promise.all([
    admin.from("properties").select("modalidade, leilao, car_codigo").eq("id", p.id).maybeSingle(),
    admin.from("property_pois").select("distancia_m, poi:pois(nome, categoria)").eq("property_id", p.id).order("distancia_m").limit(8),
  ]);
  const carac = Object.fromEntries(Object.entries(p.caracteristicas ?? {}).filter(([k]) => CARACTERISTICAS_PUBLICAS.includes(k)));
  const leilao = extra?.modalidade === "leilao" ? (extra.leilao as Record<string, unknown> | null) : null;
  const link = `/imovel/${p.codigo}`;
  return {
    ok: true,
    fontes: [{ tipo: "imovel", rotulo: `${p.codigo} — ${p.titulo}`, href: link }],
    conteudo: json({
      codigo: p.codigo, titulo: p.titulo, tipo: p.tipo, situacao: STATUS_LABEL[p.status] ?? p.status,
      modalidade: extra?.modalidade ?? "venda",
      municipio: p.municipio ? `${p.municipio.nome}/${p.municipio.uf}` : null,
      valor: p.valor, valor_formatado: formatBRL(p.valor),
      area_medida: formatArea(p.area_m2, p.tipo),
      area_declarada: p.area_declarada ? `${Number(p.area_declarada).toLocaleString("pt-BR")} ${p.tipo === "rural" ? "ha" : "m²"}` : null,
      perimetro_km: p.perimeter_m ? Math.round(p.perimeter_m / 100) / 10 : null,
      descricao: (p.descricao ?? "").slice(0, 1500),
      caracteristicas: carac,
      condicoes_venda: p.condicoes_venda, aceita_permuta: p.aceita_permuta, aceita_financiamento: p.aceita_financiamento,
      leilao: leilao ? {
        praca1_data: leilao.praca1_data ?? null, praca1_lance: leilao.praca1_lance ?? null,
        praca2_data: leilao.praca2_data ?? null, praca2_lance: leilao.praca2_lance ?? null, site: leilao.site ?? null,
      } : null,
      tem_car_vinculado: !!extra?.car_codigo,
      pontos_de_interesse: (pois ?? []).map((x) => {
        const poi = x.poi as unknown as { nome: string | null; categoria: string } | null;
        return { nome: poi?.nome ?? poi?.categoria ?? "—", categoria: poi?.categoria, distancia_km: Math.round(Number(x.distancia_m) / 100) / 10 };
      }),
      publicado_em: p.published_at,
      link,
      observacao: "Dados da ficha pública. Distâncias em linha reta. Negociação sempre pela Arini.",
    }),
  };
}

const STATUS_CAR: Record<string, string> = { AT: "Ativo", PE: "Pendente", SU: "Suspenso", CA: "Cancelado" };
const TIPO_CAR: Record<string, string> = { IRU: "Imóvel rural", AST: "Assentamento", PCT: "Povos e comunidades tradicionais" };

async function consultarAreaCar(e: Record<string, unknown>): Promise<ResultadoFerramenta> {
  const cod = txt(e.codigo_car, 80)?.toUpperCase().replace(/\s+/g, "").replace(/\./g, "");
  if (!cod || !/^[A-Z]{2}-\d{7}-[0-9A-F]{32}$/.test(cod)) {
    return { ok: false, fontes: [], conteudo: json({ erro: "Código do CAR inválido. O formato é UF-código IBGE-identificador, ex.: MG-3134400-F0B5DB13248140BBAE3B90AD7E6F4A53." }) };
  }
  const admin = supabaseAdmin();
  const [{ data: car }, { data: consultas }, { data: fontes }, { data: anuncio }] = await Promise.all([
    admin.rpc("fn_car_imovel", { p_cod: cod }),
    admin.from("consultas_area").select("fonte_id, quantidade, incide, erro, consultado_em, resultado").eq("chave", `car:${cod}`).eq("raio_m",2000),
    admin.from("fontes_externas").select("id, nome, orgao, ativa, tipo"),
    admin.from("properties").select("codigo, titulo").eq("car_codigo", cod).in("status", ["publicado", "em_negociacao"]).limit(1).maybeSingle(),
  ]);
  const props = (car as { properties?: Record<string, unknown> } | null)?.properties;
  if (!props) return { ok: false, fontes: [], conteudo: json({ erro: `A área ${cod} não está na cópia do CAR importada pela Arini (região piloto).` }) };

  const nomes = new Map((fontes ?? []).map((f) => [f.id, `${f.nome} (${f.orgao})`]));
  const link = `/consulta/car/${encodeURIComponent(cod)}`;
  const permitidas = new Set((fontes ?? []).filter(f=>f.ativa && ["wfs","arcgis","importada","api"].includes(f.tipo) && (f.id!=="sentinel" || processamentoLigado())).map(f=>f.id));
  const cruzamento = (consultas ?? []).filter(c=>permitidas.has(c.fonte_id)).map((c) => ({
    fonte: nomes.get(c.fonte_id) ?? c.fonte_id,
    abrangencia: alcanceDaFonte(c.fonte_id, 2000),
    resultado: c.erro ? "fonte indisponível na consulta (não significa ausência de restrição)" : c.incide ? "há registros" : "nada encontrado",
    quantidade: c.quantidade,
    itens: ((c.resultado as { itens?: { titulo?: string; detalhe?: string }[] } | null)?.itens ?? []).slice(0, 4)
      .map((i) => [i.titulo, i.detalhe].filter(Boolean).join(" — ")),
    consultado_em: c.consultado_em,
  }));
  const fontesOut: Fonte[] = [{ tipo: "car", rotulo: `CAR ${cod.slice(0, 18)}…`, href: link }];
  if (anuncio) fontesOut.push({ tipo: "imovel", rotulo: `${anuncio.codigo} — ${anuncio.titulo}`, href: `/imovel/${anuncio.codigo}` });
  return {
    ok: true, fontes: fontesOut,
    conteudo: json({
      codigo_car: cod,
      area_declarada_ha: props.area_ha,
      municipio: props.municipio,
      tipo: TIPO_CAR[String(props.tipo)] ?? props.tipo,
      situacao_cadastro: STATUS_CAR[String(props.status)] ?? props.status,
      analise_orgao: props.condicao,
      atualizado_sicar: props.atualizado_sicar,
      copiado_pela_arini_em: props.importado_em,
      anuncio: anuncio ? { codigo: anuncio.codigo, titulo: anuncio.titulo, link: `/imovel/${anuncio.codigo}` } : null,
      cruzamento_fontes_oficiais: cruzamento.length ? cruzamento : "Nenhuma consulta feita ainda para esta área. Quem tem o recurso no plano pode consultar na página da área.",
      fontes_nao_consultadas_automaticamente: (fontes ?? []).filter((f) => !f.ativa).map((f) => f.nome),
      link,
      avisos: [
        "O CAR é autodeclarado: não comprova propriedade nem substitui a matrícula.",
        "Resultado \"nada encontrado\" não equivale a certidão negativa.",
      ],
    }),
  };
}

async function buscarConhecimento(e: Record<string, unknown>): Promise<ResultadoFerramenta> {
  const consulta = txt(e.consulta, 300);
  if (!consulta) return { ok: false, fontes: [], conteudo: json({ erro: "Informe o que buscar." }) };
  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc("fn_kb_buscar", { p_q: consulta, p_limite: 4 });
  if (error) return { ok: false, fontes: [], conteudo: json({ erro: "A base de conhecimento não respondeu agora." }) };
  const achados = (data ?? []) as { id: string; slug: string; titulo: string; trecho: string; fonte: string; data_referencia: string; versao: number }[];
  if (!achados.length) return { ok: true, fontes: [], conteudo: json({ artigos: [], observacao: "Nenhum artigo publicado sobre isso. Não invente: diga que não há informação oficial, registre a dúvida com registrar_lacuna e sugira falar com a Arini." }) };
  const { data: completos } = await admin.from("kb_artigos").select("id, conteudo").in("id", achados.slice(0, 3).map((a) => a.id));
  const conteudo = new Map((completos ?? []).map((c) => [c.id, String(c.conteudo)]));
  return {
    ok: true,
    fontes: achados.map((a) => ({ tipo: "conhecimento" as const, rotulo: `${a.titulo} (v${a.versao}, ${new Date(a.data_referencia).toLocaleDateString("pt-BR", { timeZone: "UTC" })})` })),
    conteudo: json({
      artigos: achados.map((a) => ({
        titulo: a.titulo, fonte: a.fonte, data_referencia: a.data_referencia, versao: a.versao,
        texto: conteudo.get(a.id)?.slice(0, 3000) ?? a.trecho,
      })),
    }),
  };
}

// --- consultas territoriais já feitas (resumos em ia_consultas_resumo, migration 0040)
type Ocorrencia = {
  fonte_id: string; fonte: string; orgao: string | null; situacao: "ha_registros" | "nada_encontrado" | "indisponivel";
  quantidade: number; itens: string[]; raio_m: number; consultado_em: string;
};
type Resumo = {
  chave: string; origem: "car" | "lote" | "imovel"; rotulo: string; imovel_codigo: string | null; codigo_car: string | null;
  municipio: string | null; uf: string | null; link: string | null; ocorrencias: Ocorrencia[];
  dado_mais_antigo: string | null; dado_mais_recente: string | null; total: number;
};
const ORIGEM_RESUMO: Record<Resumo["origem"], string> = { car: "área do CAR", lote: "lote urbano", imovel: "imóvel anunciado" };

async function buscarConsultasAnteriores(e: Record<string, unknown>): Promise<ResultadoFerramenta> {
  const { municipio, uf } = municipioUf(e);
  const car = txt(e.codigo_car, 80)?.toUpperCase().replace(/[\s.]/g, "");
  const termo = txt(e.termo, 120);
  const limite = Math.min(10, Math.max(1, Math.round(num(e.limite) ?? 5)));
  if (!municipio && !car && !termo && !uf) {
    return { ok: false, fontes: [], conteudo: json({ erro: "Informe um município, um código do CAR ou o que procurar." }) };
  }
  const { data, error } = await supabaseAdmin().rpc("fn_ia_buscar_consultas", {
    p_municipio: municipio ?? null, p_uf: uf ?? null, p_car: car ?? null, p_termo: termo ?? null, p_limite: limite,
  });
  if (error) return { ok: false, fontes: [], conteudo: json({ erro: "As consultas anteriores não responderam agora." }) };
  const lista = (data ?? []) as Resumo[];
  if (!lista.length) {
    return {
      ok: true, fontes: [],
      conteudo: json({
        consultas: [],
        observacao: "Nenhuma consulta territorial já feita casa com esses filtros. Isso NÃO quer dizer que a área esteja livre de " +
          "restrições — só que ninguém consultou ainda. Quem tem o recurso no plano pode consultar pela página da área no mapa (/mapa).",
      }),
    };
  }
  const consultas = lista.map((r) => {
    const com = (s: Ocorrencia["situacao"]) => r.ocorrencias.filter((o) => o.situacao === s);
    const [de, ate] = [dataBR(r.dado_mais_antigo), dataBR(r.dado_mais_recente)];
    return {
      area: r.rotulo,
      tipo_de_area: ORIGEM_RESUMO[r.origem],
      municipio: r.municipio ? `${r.municipio}/${r.uf ?? ""}` : null,
      codigo_car: r.codigo_car,
      link: r.link,
      dados_consultados_em: de === ate ? ate : `entre ${de} e ${ate}`,
      com_registros: com("ha_registros").map((o) => ({
        fonte: o.orgao ? `${o.fonte} — ${o.orgao}` : o.fonte,
        quantidade: o.quantidade,
        abrangencia: o.raio_m ? `a área e ${(o.raio_m / 1000).toLocaleString("pt-BR")} km ao redor` : "só a área",
        itens: o.itens.slice(0, 4),
        dado_de: dataBR(o.consultado_em),
      })),
      nada_encontrado: com("nada_encontrado").map((o) => `${o.fonte} (consultado em ${dataBR(o.consultado_em)})`),
      fonte_indisponivel_na_consulta: com("indisponivel").map((o) => `${o.fonte} (${dataBR(o.consultado_em)})`),
    };
  });
  const fontes: Fonte[] = lista.map((r) => ({
    tipo: r.origem === "imovel" ? "imovel" : "car",
    rotulo: `${r.origem === "car" ? `CAR ${String(r.codigo_car).slice(0, 18)}…` : r.rotulo} (consulta de ${dataBR(r.dado_mais_recente)})`,
    href: r.link ?? undefined,
  }));
  return {
    ok: true, fontes,
    conteudo: json({
      total_encontrado: Number(lista[0]?.total ?? lista.length), mostrando: consultas.length, consultas,
      avisos: [
        "Diga SEMPRE a data de cada dado: é de quando a fonte foi consultada e pode ter mudado desde então.",
        "\"Nada encontrado\" não equivale a certidão negativa; fonte indisponível não significa ausência de restrição.",
        "O CAR é autodeclarado e não comprova propriedade.",
      ],
    }),
  };
}

// --- inteligência de mercado (ia_mercado_municipio, recalculada toda noite pelo worker)
type LinhaMercado = {
  tipo: "rural" | "urbano"; municipio: string; uf: string; unidade: "ha" | "m2";
  anuncios: number; anuncios_no_calculo: number; preco_mediano: number | null; preco_p25: number | null; preco_p75: number | null;
  vendas: number; venda_mediana: number | null; venda_p25: number | null; venda_p75: number | null;
  vendas_desde: string | null; vendas_ate: string | null; calculado_em: string;
};
/** O mesmo mínimo aplicado no banco (fn_recalcular_inteligencia_mercado): abaixo dele não há número gravado. */
const MINIMO_MERCADO = 3;

async function inteligenciaMercado(e: Record<string, unknown>): Promise<ResultadoFerramenta> {
  const { municipio, uf } = municipioUf(e);
  const tipo = e.tipo === "rural" || e.tipo === "urbano" ? e.tipo : null;
  if (!municipio || municipio.length < 3) return { ok: false, fontes: [], conteudo: json({ erro: "Informe o município." }) };
  const { data, error } = await supabaseAdmin().rpc("fn_ia_mercado", { p_municipio: municipio, p_uf: uf ?? null, p_tipo: tipo });
  if (error) return { ok: false, fontes: [], conteudo: json({ erro: "Os números de mercado não responderam agora." }) };
  const linhas = (data ?? []) as LinhaMercado[];
  if (!linhas.length) {
    return {
      ok: true, fontes: [],
      conteudo: json({
        grupos: [],
        observacao: `Não há anúncios publicados nem vendas registradas${tipo ? ` (${tipo})` : ""} em ${municipio} para calcular uma ` +
          "referência. Não estime de memória.",
      }),
    };
  }
  const reais = (v: number | null) => formatBRL(v == null ? null : Number(v));
  const grupos = linhas.map((l) => {
    const por = l.unidade === "ha" ? "por hectare" : "por m²";
    return {
      municipio: `${l.municipio}/${l.uf}`,
      tipo: l.tipo,
      anuncios_publicados: l.anuncios,
      preco_anunciado: l.preco_mediano == null
        ? `sem número: menos de ${MINIMO_MERCADO} anúncios com valor e área (há ${l.anuncios_no_calculo})`
        : {
            mediana: `${reais(l.preco_mediano)} ${por}`,
            faixa_tipica: `${reais(l.preco_p25)} a ${reais(l.preco_p75)} ${por}`,
            anuncios_no_calculo: l.anuncios_no_calculo,
          },
      vendas_registradas: l.vendas === 0 ? "nenhuma"
        : l.venda_mediana == null ? `sem número: menos de ${MINIMO_MERCADO} vendas registradas`
        : {
            quantidade: l.vendas,
            mediana: `${reais(l.venda_mediana)} ${por}`,
            faixa_tipica: `${reais(l.venda_p25)} a ${reais(l.venda_p75)} ${por}`,
            periodo: `${dataBR(l.vendas_desde)} a ${dataBR(l.vendas_ate)}`,
          },
      calculado_em: dataBR(l.calculado_em),
    };
  });
  const nomes = [...new Set(grupos.map((g) => g.municipio))].join(", ");
  return {
    ok: true,
    fontes: [{ tipo: "conhecimento", rotulo: `Inteligência de mercado — ${nomes} (calculada em ${dataBR(linhas[0].calculado_em)})` }],
    conteudo: json({
      grupos,
      avisos: [
        "Referência estatística a partir de valores ANUNCIADOS no Arini (preço pedido, não preço fechado) e de vendas registradas pela Arini. NÃO é avaliação de nenhum imóvel.",
        "Diga a data do cálculo. O preço de cada imóvel varia com localização, acesso, solo, água, benfeitorias e documentação.",
        "Para um imóvel específico, indique a pré-avaliação (quando disponível no plano) ou um avaliador profissional.",
      ],
    }),
  };
}

// --- perguntas sem resposta → fila de curadoria (ia_lacunas)
async function registrarLacuna(e: Record<string, unknown>): Promise<ResultadoFerramenta> {
  const pergunta = semDadosPessoais(txt(e.pergunta, 600) ?? "").slice(0, 300);
  const motivo = semDadosPessoais(txt(e.motivo, 600) ?? "").slice(0, 300);
  if (pergunta.length < 3) return { ok: false, fontes: [], conteudo: json({ erro: "Pergunta vazia." }) };
  const { data, error } = await supabaseAdmin().rpc("fn_ia_registrar_lacuna", { p_pergunta: pergunta, p_motivo: motivo || null });
  if (error || !(data as { ok?: boolean } | null)?.ok) {
    return { ok: false, fontes: [], conteudo: json({ erro: "Não deu para anotar agora; responda normalmente." }) };
  }
  return {
    ok: true, fontes: [],
    conteudo: json({
      registrado: true,
      observacao: "Anotado para a equipe da Arini. Diga ao usuário, em uma frase, que ainda não há informação oficial sobre isso e " +
        "que a dúvida foi encaminhada à equipe; se for urgente, sugira o suporte ou o WhatsApp da central.",
    }),
  };
}

const EXECUTORES: Record<string, (e: Record<string, unknown>) => Promise<ResultadoFerramenta>> = {
  buscar_imoveis: buscarImoveis,
  detalhes_imovel: detalhesImovel,
  consultar_area_car: consultarAreaCar,
  buscar_conhecimento: buscarConhecimento,
  buscar_consultas_anteriores: buscarConsultasAnteriores,
  inteligencia_mercado: inteligenciaMercado,
  registrar_lacuna: registrarLacuna,
};

/** Executa uma ferramenta. Nunca lança: falha vira resultado com ok=false. */
export async function executarFerramenta(nome: string, entrada: unknown, contexto?: { titular?: string; consultaTerritorial?: boolean }): Promise<ResultadoFerramenta> {
  if (["consultar_area_car","buscar_consultas_anteriores"].includes(nome) && !(contexto?.titular && contexto.consultaTerritorial)) return { ok:false, fontes:[], conteudo:json({erro:"O plano ativo da conta não permite consultar dados territoriais."}) };
  const fn = EXECUTORES[nome];
  if (!fn) return { ok: false, fontes: [], conteudo: json({ erro: `Ferramenta desconhecida: ${nome}` }) };
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
    return { ok: false, fontes: [], conteudo: json({ erro: "Entrada inválida (esperado um objeto JSON)." }) };
  }
  try {
    return await fn(entrada as Record<string, unknown>);
  } catch (err) {
    console.error(`ferramenta ${nome} falhou:`, err);
    return { ok: false, fontes: [], conteudo: json({ erro: "A consulta falhou agora. Diga ao usuário que tente de novo mais tarde." }) };
  }
}
