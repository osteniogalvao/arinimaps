// Cotações do agro para a faixa do topo e a página /mercado (migration 0056).
//
// Busca em fontes PÚBLICAS e GRATUITAS e grava com upsert em cotacoes_series e
// cotacoes_valores. Agendado algumas vezes ao dia em worker/index.mjs (pela fila
// `jobs`, como as outras rotinas). Cada fonte roda no seu try: se uma cair, as
// outras seguem, a série ganha `ultimo_erro` e o último valor continua no banco.
//
// Fontes (testadas em 09/11/2026):
//  · CEPEA/ESALQ — página do indicador (tabela dos últimos ~15 pregões, com
//    variação do dia) e, na carga inicial, a série histórica em .xls
//    (indicador/series/<produto>.aspx?id=N). Licença CC BY-NC 4.0: citar "CEPEA".
//    Se o CEPEA falhar, o mesmo indicador é lido no Notícias Agrícolas.
//  · Notícias Agrícolas — praças regionais: boi gordo da Scot Consultoria
//    (inclui "MG Triângulo") e milho/soja de sindicatos e cooperativas
//    (10 fechamentos por página).
//  · AwesomeAPI — dólar comercial (último e diário de 1 ano).
//  · Yahoo Finance (gráfico público, sem chave) — Ibovespa (^BVSP).
//
// Uso fora do worker: scripts/coleta-cotacoes.mjs [--seco] [--historico].
import { lerXls } from "./lerXls.mjs";

const UA = "AriniImoveisBrasil/1.0 (+https://arinibrasil.com.br; cotacoes)";
const TEMPO_MS = 25_000;
const NA = "https://www.noticiasagricolas.com.br";
const CEPEA = "https://www.cepea.org.br/br/indicador";

// ---------------------------------------------------------------- séries fixas
// `cepea`: página, número da tabela na página e id da série histórica (.xls)
const SERIES_CEPEA = [
  {
    slug: "cepea-boi-gordo", produto: "boi-gordo", nome: "Boi gordo", unidade: "R$/@",
    descricao: "Indicador do Boi Gordo CEPEA/ESALQ (B3), à vista, estado de SP",
    praca: "Estado de SP (indicador)", uf: "SP", destaque: true, ordem: 10,
    cepea: { pagina: "boi-gordo", tabela: 1, serie: 2, titulo: "INDICADOR DO BOI GORDO" }, na: "/cotacoes/boi-gordo/boi-gordo-indicador-esalq-bmf",
  },
  {
    slug: "cepea-milho", produto: "milho", nome: "Milho", unidade: "R$/sc 60 kg",
    descricao: "Indicador do Milho ESALQ/B3, à vista, região de Campinas (SP)",
    praca: "Campinas", uf: "SP", destaque: true, ordem: 20,
    cepea: { pagina: "milho", tabela: 1, serie: 77, titulo: "INDICADOR DO MILHO" }, na: "/cotacoes/milho/indicador-cepea-esalq-milho",
  },
  {
    slug: "cepea-soja-paranagua", produto: "soja", nome: "Soja", unidade: "R$/sc 60 kg",
    descricao: "Indicador da Soja CEPEA/ESALQ, à vista, porto de Paranaguá (PR)",
    praca: "Paranaguá (porto)", uf: "PR", destaque: true, ordem: 30,
    cepea: { pagina: "soja", tabela: 1, serie: 92, titulo: "SOJA CEPEA/ESALQ - PARANAGU" }, na: "/cotacoes/soja/soja-indicador-cepea-esalq-porto-paranagua",
  },
  {
    slug: "cepea-soja-parana", produto: "soja", nome: "Soja PR", unidade: "R$/sc 60 kg",
    descricao: "Indicador da Soja CEPEA/ESALQ, média do Paraná",
    praca: "Paraná (média)", uf: "PR", destaque: false, ordem: 31,
    cepea: { pagina: "soja", tabela: 2, serie: 12, titulo: "SOJA CEPEA/ESALQ - PARANÁ" }, na: "/cotacoes/soja/indicador-cepea-esalq-soja-parana",
  },
  {
    slug: "cepea-frango-congelado", produto: "frango", nome: "Frango", unidade: "R$/kg",
    descricao: "Frango congelado CEPEA/ESALQ, atacado, estado de SP",
    praca: "Estado de SP (atacado)", uf: "SP", destaque: true, ordem: 40,
    cepea: { pagina: "frango", tabela: 1, serie: 181, titulo: "FRANGO CONGELADO" }, na: "/cotacoes/frango/precos-do-frango-congelado-cepea-esalq",
  },
  {
    slug: "cepea-frango-resfriado", produto: "frango", nome: "Frango resfriado", unidade: "R$/kg",
    descricao: "Frango resfriado CEPEA/ESALQ, atacado, estado de SP",
    praca: "Estado de SP (atacado)", uf: "SP", destaque: false, ordem: 41,
    cepea: { pagina: "frango", tabela: 2, serie: 130, titulo: "FRANGO RESFRIADO" }, na: "/cotacoes/frango/precos-do-frango-resfriado-cepea-esalq",
  },
].map((s) => ({ ...s, casas: 2, fonte: "CEPEA/ESALQ", url_fonte: `${CEPEA}/${s.cepea.pagina}.aspx` }));

const SERIE_DOLAR = {
  slug: "dolar-comercial", produto: "dolar", nome: "Dólar", unidade: "R$/US$", casas: 4,
  descricao: "Dólar comercial (compra), cotação de mercado", praca: null, uf: null,
  fonte: "AwesomeAPI", url_fonte: "https://economia.awesomeapi.com.br/json/last/USD-BRL", destaque: true, ordem: 90,
};
const SERIE_IBOV = {
  slug: "ibovespa", produto: "ibovespa", nome: "Ibovespa", unidade: "pontos", casas: 0,
  descricao: "Índice Bovespa (B3), fechamento diário", praca: null, uf: null,
  fonte: "B3 via Yahoo Finance", url_fonte: "https://finance.yahoo.com/quote/%5EBVSP/", destaque: true, ordem: 95,
};

// regionais do Notícias Agrícolas: as séries nascem das linhas da tabela
const REGIONAIS = [
  {
    chave: "scot-boi-gordo", caminho: "/cotacoes/boi-gordo/boi-gordo-scot-consultoria", produto: "boi-gordo",
    nome: "Boi gordo", unidade: "R$/@", fonte: "Scot Consultoria (via Notícias Agrícolas)", ordem: 100,
    descricao: "Boi gordo à vista, Scot Consultoria", tipo: "scot",
  },
  {
    chave: "na-milho", caminho: "/cotacoes/milho/milho-mercado-fisico-sindicatos-e-cooperativas", produto: "milho",
    nome: "Milho", unidade: "R$/sc 60 kg", fonte: "Notícias Agrícolas (sindicatos e cooperativas)", ordem: 120,
    descricao: "Milho, mercado físico", tipo: "praca",
  },
  {
    chave: "na-soja", caminho: "/cotacoes/soja/soja-mercado-fisico-sindicatos-e-cooperativas", produto: "soja",
    nome: "Soja", unidade: "R$/sc 60 kg", fonte: "Notícias Agrícolas (sindicatos e cooperativas)", ordem: 130,
    descricao: "Soja, mercado físico", tipo: "praca",
  },
];
// na faixa do topo, a praça da região da Arini (Pontal do Triângulo Mineiro)
const DESTAQUES_REGIONAIS = new Set(["scot-boi-gordo-mg-triangulo"]);

const UFS = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const ESTADOS = { acre: "AC", alagoas: "AL", roraima: "RR", amapa: "AP", sergipe: "SE" };
// a Scot às vezes publica só a sigla (média do estado)
const NOME_UF = { SC: "Santa Catarina", ES: "Espírito Santo", RJ: "Rio de Janeiro" };
// portos sem "/UF" no nome
const PORTOS = { "porto paranagua": "PR", "porto rio grande": "RS", "porto santos": "SP" };
// contrato futuro dentro do nome ("Dez/26", "Fev/Mar/2027"): não é preço disponível, fica fora
const CONTRATO = /\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/(\d{2}|\d{4}|[a-z]{3})/i;

// ---------------------------------------------------------------- utilidades
async function baixar(url, tipo = "texto") {
  const r = await fetch(url, {
    headers: { "user-agent": UA, accept: tipo === "json" ? "application/json" : "*/*" },
    signal: AbortSignal.timeout(TEMPO_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  if (tipo === "json") return r.json();
  if (tipo === "binario") return Buffer.from(await r.arrayBuffer());
  return r.text();
}

/** "1.234,56" | "+0,47" | "-1,58%" → número; vazio, "-" ou "s/ cotação" → null */
export function numeroBr(t) {
  const s = String(t ?? "").replace(/&nbsp;/g, "").replace(/[%\s]/g, "").replace(/^\+/, "");
  if (!/^-?[\d.]*\d(,\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
/** "06/11/2026" → "2026-11-06" */
const dataIso = (br) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br).trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
/** data (AAAA-MM-DD) no fuso de Brasília de um instante em segundos */
const dataBrasilia = (seg) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(seg * 1000));
const fimDeSemana = (iso) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
const semTags = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const decodifica = (t) => t.replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"');
export const slugificar = (t) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const linhas = (tabela) =>
  [...tabela.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decodifica(semTags(c[1]))));
const desde = (dias) => new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- CEPEA
async function cepeaPagina(s) {
  const html = await baixar(s.url_fonte);
  const m = new RegExp(`<table id="imagenet-indicador${s.cepea.tabela}"[\\s\\S]*?</table>`).exec(html);
  if (!m) throw new Error(`tabela ${s.cepea.tabela} não encontrada em ${s.url_fonte}`);
  const pontos = linhas(m[0])
    .map(([d, v, varDia]) => ({ data: dataIso(d), valor: numeroBr(v), variacao: numeroBr(varDia) }))
    .filter((p) => p.data && p.valor);
  if (!pontos.length) throw new Error("tabela do CEPEA sem valores");
  return pontos;
}

// O CEPEA gera o .xls com nome pelo segundo da requisição (CEPEA_AAAAMMDDhhmmss.xls):
// dois pedidos no mesmo segundo podem voltar com a planilha trocada (visto em
// 09/11/2026: o milho veio com os valores da soja). Por isso os downloads vão
// um de cada vez, com pausa, e cada planilha é conferida pelo título.
let filaXls = Promise.resolve();
const naFilaXls = (fn) => {
  const p = filaXls.then(fn);
  filaXls = p.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 2500)));
  return p;
};

/** série histórica (.xls) — usada na carga inicial (1 ano) */
async function cepeaHistorico(s, dias) {
  const url = `${CEPEA}/series/${s.cepea.pagina}.aspx?id=${s.cepea.serie}`;
  // o CEPEA às vezes devolve uma página no lugar do .xls: mais duas tentativas, com pausa
  let planilha;
  for (let tentativa = 1; ; tentativa++) {
    try {
      [planilha] = await naFilaXls(async () => lerXls(await baixar(url, "binario")));
      const titulo = String(planilha?.[0]?.[0] ?? "");
      if (!titulo.toUpperCase().includes(s.cepea.titulo)) throw new Error(`planilha trocada: "${titulo}"`);
      break;
    } catch (e) {
      if (tentativa >= 3) throw e;
      await new Promise((r) => setTimeout(r, 3000 * tentativa));
    }
  }
  const corte = desde(dias);
  const pontos = (planilha ?? [])
    .map((l) => ({ data: dataIso(l?.[0]), valor: typeof l?.[1] === "number" ? l[1] : null, variacao: null }))
    .filter((p) => p.data && p.valor && p.data >= corte);
  if (!pontos.length) throw new Error("série histórica do CEPEA vazia");
  return pontos;
}

// ---------------------------------------------------------------- Notícias Agrícolas
/** blocos "Fechamento: dd/mm/aaaa" + tabela da página de uma cotação */
async function naBlocos(caminho) {
  const html = await baixar(NA + caminho);
  const blocos = [...html.matchAll(/Fechamento:\s*(\d{2}\/\d{2}\/\d{4})[\s\S]*?(<table[\s\S]*?<\/table>)/g)]
    .map((m) => ({ data: dataIso(m[1]), linhas: linhas(m[2]).filter((l) => l.length) }));
  if (!blocos.length) throw new Error(`nenhuma tabela em ${caminho}`);
  return blocos;
}

/** indicador republicado (reserva do CEPEA): Data | valor | variação */
async function naIndicador(caminho) {
  const blocos = await naBlocos(caminho);
  const pontos = blocos.flatMap((b) =>
    b.linhas.map(([d, v, vr]) => ({ data: dataIso(d) ?? b.data, valor: numeroBr(v), variacao: numeroBr(vr) })))
    .filter((p) => p.data && p.valor);
  if (!pontos.length) throw new Error("indicador sem valores no Notícias Agrícolas");
  return pontos;
}

/** "MG Triângulo" → { uf, praca } (Scot) */
function pracaScot(nome) {
  const limpo = nome.replace(/\*|\(kg\)/g, "").trim();
  const m = /^([A-Z]{2})\b\s*(.*)$/.exec(limpo);
  if (m && UFS.has(m[1])) return { uf: m[1], praca: m[2] || NOME_UF[m[1]] || m[1] };
  const uf = ESTADOS[slugificar(limpo)] ?? null;
  return { uf, praca: limpo };
}
/** "Não-Me-Toque/RS (Cotrijal)" → { praca, uf, origem } */
function pracaCooperativa(nome) {
  const m = /^(.+?)\/([A-Z]{2})\b\s*(.*)$/.exec(nome.trim());
  if (m && UFS.has(m[2])) return { praca: m[1].trim(), uf: m[2], origem: m[3].replace(/^\(|\)$/g, "").trim() || null };
  // "Porto Paranaguá (Disponível) (Insoy Commodities)": o último parêntese é quem informa
  const p = /^(.+\))\s*\(([^()]+)\)\s*$/.exec(nome.trim());
  const praca = (p ? p[1] : nome).trim();
  const porto = Object.entries(PORTOS).find(([k]) => slugificar(praca).replace(/-/g, " ").startsWith(k));
  return { praca, uf: porto?.[1] ?? null, origem: p ? p[2].trim() : null };
}

async function regional(cfg) {
  const blocos = await naBlocos(cfg.caminho);
  const series = new Map();
  for (const b of blocos) {
    for (const l of b.linhas) {
      if (l.length < 2) continue;
      const nome = l[0];
      const valor = numeroBr(l[1]);
      if (!nome || !valor || CONTRATO.test(nome)) continue;
      let meta;
      if (cfg.tipo === "scot") {
        const { uf, praca } = pracaScot(nome);
        meta = {
          praca, uf, unidade: /\(kg\)/.test(nome) ? "R$/kg" : cfg.unidade,
          descricao: `${cfg.descricao}, ${nome.replace(/\*/g, "").trim()}`, variacao: null,
        };
      } else {
        const { praca, uf, origem } = pracaCooperativa(nome);
        meta = { praca, uf, unidade: cfg.unidade, descricao: `${cfg.descricao}${origem ? `, ${origem}` : ""}`, variacao: numeroBr(l[2]) };
      }
      const slug = `${cfg.chave}-${slugificar(`${meta.uf ?? ""} ${meta.praca}`)}`;
      if (!series.has(slug)) {
        series.set(slug, {
          serie: {
            slug, produto: cfg.produto, nome: cfg.nome, descricao: meta.descricao, praca: meta.praca, uf: meta.uf,
            unidade: meta.unidade, casas: 2, fonte: cfg.fonte, url_fonte: NA + cfg.caminho,
            destaque: DESTAQUES_REGIONAIS.has(slug), ordem: cfg.ordem,
          },
          pontos: [],
        });
      }
      const alvo = series.get(slug).pontos;
      if (!alvo.some((p) => p.data === b.data)) alvo.push({ data: b.data, valor, variacao: meta.variacao });
    }
  }
  if (!series.size) throw new Error(`nenhuma praça lida em ${cfg.caminho}`);
  return [...series.values()];
}

// ---------------------------------------------------------------- dólar e Ibovespa
async function dolar(historico) {
  if (historico) {
    const lista = await baixar("https://economia.awesomeapi.com.br/json/daily/USD-BRL/365", "json");
    const porDia = new Map();
    for (const c of lista) {
      const data = dataBrasilia(Number(c.timestamp));
      if (fimDeSemana(data)) continue;
      const atual = porDia.get(data);
      if (!atual || Number(c.timestamp) > atual.ts) {
        porDia.set(data, { ts: Number(c.timestamp), data, valor: Number(c.bid), variacao: Number(c.pctChange) });
      }
    }
    return [...porDia.values()].filter((p) => p.valor > 0).map(({ data, valor, variacao }) => ({ data, valor, variacao }));
  }
  const { USDBRL: c } = await baixar("https://economia.awesomeapi.com.br/json/last/USD-BRL", "json");
  const data = dataBrasilia(Number(c.timestamp));
  if (!(Number(c.bid) > 0)) throw new Error("AwesomeAPI sem cotação");
  return fimDeSemana(data) ? [] : [{ data, valor: Number(c.bid), variacao: Number(c.pctChange) }];
}

async function ibovespa(historico) {
  const j = await baixar(
    `https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP?range=${historico ? "1y" : "1mo"}&interval=1d`, "json");
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error("Yahoo Finance sem dados do Ibovespa");
  const fech = r.indicators?.quote?.[0]?.close ?? [];
  const pontos = r.timestamp
    .map((t, i) => ({ data: dataBrasilia(t), valor: fech[i] == null ? null : Math.round(fech[i] * 100) / 100, variacao: null }))
    .filter((p) => p.valor);
  // o pregão de hoje ainda aberto: preço corrente no lugar do último candle
  const agora = r.meta?.regularMarketPrice;
  const hoje = r.meta?.regularMarketTime ? dataBrasilia(r.meta.regularMarketTime) : null;
  if (agora && hoje) {
    const ult = pontos.find((p) => p.data === hoje);
    if (ult) ult.valor = Math.round(agora * 100) / 100;
    else pontos.push({ data: hoje, valor: Math.round(agora * 100) / 100, variacao: null });
  }
  return pontos;
}

// ---------------------------------------------------------------- coleta
/**
 * Busca tudo e devolve [{ serie, pontos, erro }]. Nunca lança: cada fonte falha
 * sozinha. `historico`: carga inicial de ~1 ano (CEPEA .xls, AwesomeAPI diário,
 * Yahoo 1y); as regionais do Notícias Agrícolas só têm os últimos fechamentos.
 */
export async function coletar({ historico = false, dias = 380, log = console.log } = {}) {
  const tarefas = [
    ...SERIES_CEPEA.map((s) => async () => {
      const { na } = s;
      const serie = { ...s };
      delete serie.cepea;
      delete serie.na;
      try {
        const pontos = await cepeaPagina(s);
        if (historico) {
          try {
            const hist = await cepeaHistorico(s, dias);
            const ref = pontos.find((p) => p.data === hist[hist.length - 1].data);
            if (ref && Math.abs(ref.valor / hist[hist.length - 1].valor - 1) > 0.005) {
              throw new Error(`série histórica não bate com a página (${hist[hist.length - 1].valor} × ${ref.valor})`);
            }
            const vistas = new Set(pontos.map((p) => p.data));
            pontos.push(...hist.filter((p) => !vistas.has(p.data)));
          } catch (e) {
            log(`[cotacoes] histórico ${s.slug} falhou: ${e.message}`);
          }
        }
        return [{ serie, pontos }];
      } catch (e) {
        // reserva: o mesmo indicador republicado pelo Notícias Agrícolas
        log(`[cotacoes] CEPEA ${s.slug} falhou (${e.message}); tentando o Notícias Agrícolas`);
        try {
          return [{ serie, pontos: await naIndicador(na), aviso: "lido na reserva (Notícias Agrícolas)" }];
        } catch (e2) {
          return [{ serie, pontos: [], erro: `${e.message} · reserva: ${e2.message}` }];
        }
      }
    }),
    ...REGIONAIS.map((cfg) => async () => {
      try {
        return await regional(cfg);
      } catch (e) {
        return [{ serie: null, chave: cfg.chave, pontos: [], erro: e.message }];
      }
    }),
    async () => {
      try { return [{ serie: SERIE_DOLAR, pontos: await dolar(historico) }]; }
      catch (e) { return [{ serie: SERIE_DOLAR, pontos: [], erro: e.message }]; }
    },
    async () => {
      try { return [{ serie: SERIE_IBOV, pontos: await ibovespa(historico) }]; }
      catch (e) { return [{ serie: SERIE_IBOV, pontos: [], erro: e.message }]; }
    },
  ];
  // poucas de cada vez: são sites públicos, sem pressa
  const resultado = [];
  for (let i = 0; i < tarefas.length; i += 3) {
    const lote = await Promise.all(tarefas.slice(i, i + 3).map((t) => t()));
    resultado.push(...lote.flat());
  }
  for (const r of resultado) r.pontos.sort((a, b) => a.data.localeCompare(b.data));
  return resultado;
}

// ---------------------------------------------------------------- gravação
async function gravar(db, resultado, log = console.log) {
  let series = 0, valores = 0, falhas = 0;
  const ids = [];
  for (const r of resultado) {
    if (r.erro) {
      falhas++;
      log(`[cotacoes] ${r.serie?.slug ?? r.chave}: ${r.erro}`);
      // o último valor fica; só registra a falha na série (se ela já existe)
      if (r.serie) await db.query(`update cotacoes_series set ultimo_erro = $2 where slug = $1`, [r.serie.slug, r.erro.slice(0, 500)]);
      continue;
    }
    const s = r.serie;
    const { rows: [{ id }] } = await db.query(`
      insert into cotacoes_series (slug, produto, nome, descricao, praca, uf, unidade, casas, fonte, url_fonte, destaque, ordem, atualizado_em, ultimo_erro)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), $13)
      on conflict (slug) do update set
        produto = excluded.produto, nome = excluded.nome, descricao = excluded.descricao, praca = excluded.praca,
        uf = excluded.uf, unidade = excluded.unidade, casas = excluded.casas, fonte = excluded.fonte,
        url_fonte = excluded.url_fonte, destaque = excluded.destaque, ordem = excluded.ordem,
        atualizado_em = now(), ultimo_erro = excluded.ultimo_erro
      returning id`,
      [s.slug, s.produto, s.nome, s.descricao, s.praca, s.uf, s.unidade, s.casas, s.fonte, s.url_fonte, s.destaque, s.ordem, r.aviso ?? null]);
    series++;
    ids.push(id);
    if (!r.pontos.length) continue;
    const { rowCount } = await db.query(`
      insert into cotacoes_valores (serie_id, data, valor, variacao, coletado_em)
      select $1, d, v, x, now() from unnest($2::date[], $3::numeric[], $4::numeric[]) as t(d, v, x)
      on conflict (serie_id, data) do update set
        valor = excluded.valor, variacao = coalesce(excluded.variacao, cotacoes_valores.variacao), coletado_em = now()
      where cotacoes_valores.valor is distinct from excluded.valor
         or (excluded.variacao is not null and cotacoes_valores.variacao is distinct from excluded.variacao)`,
      [id, r.pontos.map((p) => p.data), r.pontos.map((p) => p.valor), r.pontos.map((p) => p.variacao ?? null)]);
    valores += rowCount ?? 0;
  }
  // variação que a fonte não informa: calculada sobre o pregão anterior
  if (ids.length) {
    await db.query(`
      update cotacoes_valores v set variacao = round((v.valor / p.anterior - 1) * 100, 4)
      from (
        select serie_id, data, lag(valor) over (partition by serie_id order by data) as anterior
        from cotacoes_valores where serie_id = any($1::uuid[])
      ) p
      where v.serie_id = p.serie_id and v.data = p.data and v.variacao is null and p.anterior > 0`, [ids]);
  }
  return { series, valores, falhas };
}

/** handler do worker: payload { historico?: boolean } */
export async function coletarCotacoes(payload, db) {
  // tabela vazia (primeira execução depois da migration) = carga inicial de 1 ano
  const { rows: [{ n }] } = await db.query(`select count(*)::int as n from cotacoes_valores`);
  const historico = !!payload?.historico || n === 0;
  const resultado = await coletar({ historico });
  const r = await gravar(db, resultado);
  console.log(`[cotacoes] ${r.series} série(s), ${r.valores} valor(es) novos ou alterados, ${r.falhas} falha(s)${historico ? " · carga de 1 ano" : ""}`);
}

export { gravar as gravarCotacoes };
