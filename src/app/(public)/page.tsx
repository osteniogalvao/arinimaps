import Link from "next/link";
import Image from "next/image";
import { unstable_cache } from "next/cache";
import {
  ArrowRight, BadgeDollarSign, Database, Eye, Grid3x3, House, MapPin, MapPinned, Ruler, Search, TrendingUp,
} from "lucide-react";
import CartaoRotativo, { type Quadro } from "@/components/landing/CartaoRotativo";
import SiteHeader from "@/components/SiteHeader";
import VitrineConsultas, { type Consulta } from "@/components/home/VitrineConsultas";
import HeroCarrossel, { type SlideHero } from "@/components/landing/HeroCarrossel";
import ComoUsar from "@/components/landing/ComoUsar";
import Municipios, { type MunicipioCartao } from "@/components/landing/Municipios";
import ComoFunciona from "@/components/landing/ComoFunciona";
import FontesMarquee from "@/components/landing/FontesMarquee";
import MosaicoSatelite from "@/components/landing/MosaicoSatelite";
import RodapeSite, { PreRodape } from "@/components/landing/RodapeSite";
import { BTN_ACAO, MaisLink, TituloSecao } from "@/components/landing/Titulo";
import MarcaArini from "@/components/marca/MarcaArini";
import { ItemNumerado, PilulaPonto } from "@/components/ui/Pagina";
import {
  ClipReveal, Counter, Parallax, Reveal, RolagemSuave, SpotlightTracker, Stagger,
} from "@/components/landing/movimento";
import { CENTRO_REGIAO } from "@/lib/map/config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerConfiguracoes, numero, texto } from "@/lib/settings";
import { formatBRL, formatArea } from "@/lib/format";

/**
 * Página inicial = site institucional: apresenta a ferramenta e a empresa e
 * leva para a área de consultas (/mapa, /imoveis, /relatorios), que é onde a
 * sidebar do AppShell existe. Aqui não há sidebar.
 *
 * Visual do Manual de Identidade Visual v1.0: carrossel de tela cheia com
 * linhas de mapa, faixas off-white e Verde Profundo alternadas, títulos
 * grandes em caixa alta, rótulos de seção numerados ("03 · A FERRAMENTA") e
 * entradas ao rolar. Faixas escuras usam `.lp-escuro` (ver globals.css) e
 * ficam legíveis nos dois temas.
 */
export const dynamic = "force-dynamic";

// fonte de display só dos títulos da landing (o resto do sistema segue em Geist)

function mediaUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

const temBanco = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Cache dos dados da home (TTFB medido em ~760 ms sem cache, 09/11/2026).
 * Listas de imóveis: 5 min; números e municípios (contagens pesadas em
 * urban_lots): 15 min. A função cacheada LANÇA em caso de erro, para que uma
 * falha passageira do banco não fique guardada como "zero" por 15 minutos;
 * quem chama apanha o erro e devolve o vazio. As configurações (textos do
 * hero, contato) não entram no cache: edição no admin aparece na hora.
 */
const CACHE_LISTAS = 300;
const CACHE_NUMEROS = 900;

const destaquesCache = unstable_cache(async () => {
  const { data, error } = await supabaseAdmin()
    .from("properties")
    .select("codigo, titulo, tipo, valor, modalidade, municipality:municipalities!properties_municipality_id_fkey(nome), geo:property_geometries(area_m2), media:property_media(storage_path, capa)")
    .in("status", ["publicado", "em_negociacao"])
    .order("published_at", { ascending: false })
    .limit(6);
  if (error) throw new Error(error.message);
  return data ?? [];
}, ["home-destaques"], { revalidate: CACHE_LISTAS, tags: ["home", "imoveis"] });

async function destaques() {
  if (!temBanco()) return [];
  try {
    return await destaquesCache();
  } catch (e) {
    console.error("destaques da home falharam:", e);
    return [];
  }
}

/** Imóveis de menor preço com foto: passam no 1º cartão de "Do anúncio à decisão". */
const oportunidadesCache = unstable_cache(async () => {
  const { data, error } = await supabaseAdmin()
    .from("properties")
    .select("codigo, titulo, valor, municipality:municipalities!properties_municipality_id_fkey(nome), media:property_media(storage_path, capa, tipo)")
    .in("status", ["publicado", "em_negociacao"])
    .not("valor", "is", null)
    .order("valor", { ascending: true })
    .limit(12);
  if (error) throw new Error(error.message);
  return data ?? [];
}, ["home-oportunidades"], { revalidate: CACHE_LISTAS, tags: ["home", "imoveis"] });

async function oportunidades(): Promise<Quadro[]> {
  if (!temBanco()) return [];
  try {
    const data = await oportunidadesCache();
    const quadros: Quadro[] = [];
    for (const p of data ?? []) {
      const fotos = ((p.media ?? []) as { storage_path: string; capa: boolean; tipo?: string | null }[])
        .filter((m) => !m.tipo || m.tipo === "foto");
      const capa = fotos.find((m) => m.capa) ?? fotos[0];
      if (!capa) continue;
      const mun = (p.municipality as unknown as { nome: string } | null)?.nome;
      quadros.push({
        tipo: "foto", externa: true, src: mediaUrl(capa.storage_path), alt: p.titulo, href: `/imovel/${p.codigo}`,
        legenda: `${formatBRL(p.valor)}${mun ? ` · ${mun}` : ""}`,
      });
      if (quadros.length >= 6) break;
    }
    return quadros;
  } catch (e) {
    console.error("oportunidades da home falharam:", e);
    return [];
  }
}

/** Números reais do sistema para a faixa de credibilidade. Nunca derruba a página. */
async function numeros() {
  const vazio = { municipios: 0, plantas: 0, fontes: 0, imoveis: 0, lotes: 0, visitasMes: 0, visitasAnterior: 0, vendidosMi: 0 };
  if (!temBanco()) return vazio;
  try {
    return await numerosCache();
  } catch {
    return vazio;
  }
}

const numerosCache = unstable_cache(async () => {
  const admin = supabaseAdmin();
  const dia = 86_400_000;
  const ha30 = new Date(Date.now() - 30 * dia).toISOString();
  const ha60 = new Date(Date.now() - 60 * dia).toISOString();
  const [mun, plantas, fontes, imoveis, lotes, visitas, anteriores, vendas] = await Promise.all([
    admin.from("municipalities").select("id", { count: "exact", head: true }).eq("ativo", true),
    admin.from("cartography_layers").select("id", { count: "exact", head: true }).eq("status", "pronto"),
    admin.from("fontes_externas").select("id", { count: "exact", head: true }).eq("ativa", true),
    admin.from("properties").select("id", { count: "exact", head: true }).in("status", ["publicado", "em_negociacao", "vendido"]),
    admin.from("urban_lots").select("id", { count: "exact", head: true }),
    // visualizações das páginas de imóvel nos últimos 30 dias e nos 30 anteriores
    admin.from("property_events").select("id", { count: "exact", head: true }).eq("tipo", "visualizacao").gte("created_at", ha30),
    admin.from("property_events").select("id", { count: "exact", head: true }).eq("tipo", "visualizacao").gte("created_at", ha60).lt("created_at", ha30),
    admin.from("sales").select("valor_final"),
  ]);
  // a contagem principal falhou: não guarda zeros no cache
  if (mun.error) throw new Error(mun.error.message);
  const somaVendas = (vendas.data ?? []).reduce((s, v) => s + (Number((v as { valor_final: number | null }).valor_final) || 0), 0);
  return {
    municipios: mun.count ?? 0,
    plantas: plantas.count ?? 0,
    fontes: fontes.count ?? 0,
    imoveis: imoveis.count ?? 0,
    lotes: lotes.count ?? 0,
    visitasMes: visitas.count ?? 0,
    visitasAnterior: anteriores.count ?? 0,
    vendidosMi: somaVendas / 1_000_000,
  };
}, ["home-numeros"], { revalidate: CACHE_NUMEROS, tags: ["home"] });

/**
 * Municípios ativos com a sede urbana (satélite e link do mapa), imóveis
 * publicados e lotes mapeados. A sede vem da 0064 (IBGE BC250 "Cidade");
 * antes dela a coluna guardava o centroide do polígono.
 */
const municipiosCache = unstable_cache(async (): Promise<MunicipioCartao[]> => {
  const admin = supabaseAdmin();
  const [{ data: muns, error }, { data: props }] = await Promise.all([
    admin.from("municipalities").select("id, nome, uf, sede").eq("ativo", true).order("nome"),
    admin.from("properties").select("municipality_id").in("status", ["publicado", "em_negociacao"]),
  ]);
  if (error) throw new Error(error.message);
  if (!muns?.length) return [];
  const lotes = await Promise.all(
    muns.map((m) =>
      admin.from("urban_lots").select("id", { count: "exact", head: true }).eq("municipality_id", m.id)
        .then((r) => r.count ?? 0, () => 0),
    ),
  );
  const porMun = new Map<string, number>();
  for (const p of props ?? []) {
    if (p.municipality_id) porMun.set(p.municipality_id, (porMun.get(p.municipality_id) ?? 0) + 1);
  }
  return muns.map((m, k) => {
    // PostgREST devolve a geometria como GeoJSON
    const c = (m.sede as { coordinates?: [number, number] } | null)?.coordinates;
    const [lng, lat] = Array.isArray(c) && c.length >= 2 ? c : CENTRO_REGIAO;
    return { id: m.id, nome: m.nome, uf: m.uf, lng, lat, imoveis: porMun.get(m.id) ?? 0, lotes: lotes[k] };
  });
}, ["home-municipios"], { revalidate: CACHE_NUMEROS, tags: ["home"] });

async function municipiosAtendidos(): Promise<MunicipioCartao[]> {
  if (!temBanco()) return [];
  try {
    return await municipiosCache();
  } catch (e) {
    console.error("municípios da home falharam:", e);
    return [];
  }
}

const CONSULTAS: Consulta[] = [
  { rotulo: "Mapa interativo", desc: "Satélite, plantas das cidades e todos os imóveis publicados.", href: "/mapa", icone: "mapa", destaque: true },
  { rotulo: "Consultar CAR", desc: "Cadastro Ambiental Rural sobre a divisa.", href: "/mapa?camada=car", icone: "car" },
  { rotulo: "Embargos ambientais", desc: "Áreas embargadas pelo IBAMA.", href: "/mapa?camada=ibama_embargos", icone: "embargo" },
  { rotulo: "Focos de queimadas", desc: "Histórico do INPE por ano.", href: "/mapa?camada=inpe_queimadas", icone: "fogo" },
  { rotulo: "Processos minerários", desc: "Requerimentos e concessões da ANM.", href: "/mapa?camada=anm", icone: "mineracao" },
  { rotulo: "Buscar imóveis", desc: "Filtros por tipo, município e preço.", href: "/imoveis", icone: "busca" },
  { rotulo: "Relatórios territoriais", desc: "Todos os rurais com as incidências consultadas.", href: "/relatorios", icone: "relatorio" },
];

const mil = (v: number) => v.toLocaleString("pt-BR");
/** 1.9 → "1,9%" */
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export default async function Home() {
  const [imoveis, cfg, n, municipios, baratos] = await Promise.all([
    destaques(), lerConfiguracoes(), numeros(), municipiosAtendidos(), oportunidades(),
  ]);
  // 2º cartão: cartografia urbana e rural do próprio sistema, nos municípios atendidos
  const sedes = municipios.length ? municipios : [{ nome: "Iturama", lng: CENTRO_REGIAO[0], lat: CENTRO_REGIAO[1] }];
  const cartografia: Quadro[] = sedes.slice(0, 4).flatMap((m) => [
    { tipo: "mapa" as const, lng: m.lng, lat: m.lat, z: 15, camada: "satelite" as const, legenda: `${m.nome} · cartografia urbana` },
    { tipo: "mapa" as const, lng: m.lng, lat: m.lat, z: 12, camada: "relevo" as const, legenda: `${m.nome} · relevo e área rural` },
  ]);
  // 3º cartão: credibilidade e confiança (provisório até as fotos da Arini chegarem)
  const confianca: Quadro[] = [
    { tipo: "foto", src: "/img/casa-urbana.jpg", alt: "Imóvel urbano", legenda: "Anúncios conferidos pela Arini" },
    { tipo: "foto", src: "/img/hero-fazenda.jpg", alt: "Propriedade rural", legenda: "Documentação analisada" },
    { tipo: "foto", src: "/img/aerea-campo.jpg", alt: "Lavoura vista do alto", legenda: "Acompanhamento até a negociação" },
  ];
  const vitrine1: Quadro[] = baratos.length
    ? baratos
    : [{ tipo: "foto", src: "/img/fazenda-gado.jpg", alt: "Propriedade rural", legenda: "Oportunidades da região" }];
  const marca = texto(cfg, "nome_sistema", "Arini Imóveis Brasil");
  const siteArini = texto(cfg, "sobre_site");
  const comissao = pct(numero(cfg, "comissao_percentual_padrao", 1.9));
  const paragrafosSobre = texto(cfg, "sobre_texto").split("\n").map((p) => p.trim()).filter(Boolean);
  const contato = {
    whatsapp: texto(cfg, "whatsapp_central") || undefined,
    email: texto(cfg, "email_contato") || undefined,
    telefone: texto(cfg, "telefone_contato") || undefined,
    site: siteArini || undefined,
  };

  const heroTitulo = texto(cfg, "hero_titulo", "Seu próximo negócio imobiliário,");
  const heroDestaque = texto(cfg, "hero_destaque", "começa no mapa.");

  const slides: SlideHero[] = [
    {
      id: "rural", aba: "Imóveis rurais",
      eyebrow: texto(cfg, "hero_eyebrow", "Pontal do Triângulo Mineiro"),
      titulo: heroTitulo, destaque: heroDestaque,
      subtitulo: texto(cfg, "hero_subtitulo",
        "Encontre imóveis urbanos e rurais e explore suas localizações no mapa, com os limites reais das propriedades sobre imagens de satélite, áreas medidas, tours 3D e pontos de interesse ao redor. Viva a experiência ARINI."),
      cta: { rotulo: "Imóveis rurais", href: "/imoveis?tipo=rural" },
      cta2: { rotulo: "Abrir mapa", href: "/mapa" },
      midia: { tipo: "mapa", cena: 0, poster: "/img/hero-fazenda.jpg" },
    },
    {
      id: "urbano", aba: "Imóveis urbanos",
      eyebrow: "Iturama, lote a lote",
      titulo: "Cada lote da cidade", destaque: "na planta oficial",
      subtitulo: n.lotes > 0
        ? `Quadras, lotes e ruas georreferenciados sobre o satélite, com a medida de cada lado. ${mil(n.lotes)} lotes já estão no mapa.`
        : "Quadras, lotes e ruas georreferenciados sobre o satélite, com a medida de cada lado.",
      cta: { rotulo: "Ver imóveis urbanos", href: "/imoveis?tipo=urbano" },
      cta2: { rotulo: "Abrir o mapa", href: "/mapa" },
      midia: { tipo: "mapa", cena: 1, poster: "/img/casa-urbana.jpg" },
    },
    {
      id: "destaque", aba: "Imóveis em destaque",
      eyebrow: "Oportunidades",
      titulo: "Imóveis em destaque,", destaque: "com a divisa conferida",
      subtitulo: "As melhores oportunidades da região reunidas num só lugar, com a área medida no satélite e as consultas territoriais prontas antes da negociação.",
      cta: { rotulo: "Ver imóveis em destaque", href: "/imoveis?ordem=menor" },
      midia: { tipo: "foto", src: "/img/fazenda-gado.jpg" },
    },
    {
      id: "consulta", aba: "Inteligência territorial",
      eyebrow: "Informações oficiais",
      titulo: "Consulte a área", destaque: "antes de negociar",
      subtitulo: "CAR, embargos do IBAMA, queimadas do INPE, processos da ANM, terras indígenas e unidades de conservação cruzados com a divisa do imóvel.",
      cta: { rotulo: "Ver relatórios territoriais", href: "/relatorios" },
      cta2: { rotulo: "Consultar no mapa", href: "/mapa?camada=car" },
      midia: { tipo: "foto", src: "/img/aerea-campo.jpg" },
    },
    {
      id: "anuncie", aba: "Anuncie seu imóvel",
      eyebrow: "Para proprietários e corretores",
      titulo: "Coloque seu imóvel", destaque: "no mapa",
      subtitulo: "Divisa no satélite, tour 3D e vídeo automáticos, e interessados qualificados pela central da Arini.",
      cta: { rotulo: "Anunciar imóvel", href: "/painel/novo" },
      cta2: { rotulo: "Ver planos", href: "/planos" },
      midia: { tipo: "foto", src: "/img/aerea-interior.jpg" },
    },
  ];

  // faixa verde (revisão de 29/10): carrossel com os números reais do sistema;
  // número zerado não aparece
  const crescimento = n.visitasAnterior > 0 ? Math.round(((n.visitasMes - n.visitasAnterior) / n.visitasAnterior) * 100) : 0;
  const faixa = [
    { icone: House, valor: n.imoveis, texto: mil(n.imoveis), rotulo: "imóveis publicados" },
    { icone: MapPinned, valor: n.municipios, texto: mil(n.municipios), rotulo: "municípios no mapa" },
    { icone: Grid3x3, valor: n.lotes, texto: mil(n.lotes), rotulo: "lotes urbanos mapeados" },
    { icone: Database, valor: n.fontes, texto: mil(n.fontes), rotulo: "fontes oficiais" },
    { icone: Eye, valor: n.visitasMes, texto: mil(n.visitasMes), rotulo: "visualizações no mês" },
    { icone: BadgeDollarSign, valor: n.vendidosMi, texto: `R$ ${n.vendidosMi.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`, rotulo: "em imóveis vendidos" },
    { icone: TrendingUp, valor: crescimento, texto: `+${crescimento}%`, rotulo: "de crescimento nas visualizações" },
  ].filter((f) => f.valor > 0);

  const porQue = [
    n.fontes > 0 && { valor: String(n.fontes), rotulo: "fontes oficiais" },
    n.plantas > 0
      ? { valor: String(n.plantas), rotulo: "plantas urbanas oficiais" }
      : n.lotes > 0 && { valor: mil(n.lotes), rotulo: "lotes urbanos mapeados" },
    { valor: "100%", rotulo: "dos anúncios gerenciados" },
    { valor: comissao, rotulo: "de comissão" },
  ].filter(Boolean) as { valor: string; rotulo: string }[];

  return (
    <div className={`flex min-h-screen flex-col bg-fundo text-texto`}>
      <RolagemSuave />
      <SpotlightTracker />
      <SiteHeader sobreHero />

      <main className="flex-1">
        <HeroCarrossel slides={slides} h1={`${marca}: ${heroTitulo} ${heroDestaque}`} />

        {/* ---------- faixa de números ---------- */}
        {faixa.length > 0 && (
          <section aria-label="A Arini em números" className="lp-escuro border-t border-white/10 bg-[#124431]">
            <div className="lp-marquee-grupo relative flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]">
              <div className="lp-marquee flex w-max shrink-0" style={{ ["--lp-marquee-dur" as string]: `${Math.max(30, faixa.length * 7)}s` }}>
                {[0, 1].map((volta) => (
                  <ul key={volta} className="flex shrink-0" aria-hidden={volta === 1 || undefined}>
                    {[...faixa, ...faixa].map((f, k) => (
                      <li key={`${f.rotulo}-${k}`} className="flex shrink-0 items-center gap-4 border-l border-white/15 px-8 py-6 md:px-10 md:py-8">
                        <f.icone className="size-8 shrink-0 text-ouro" strokeWidth={1.5} />
                        <div className="min-w-0">
                          <span className="lp-display block whitespace-nowrap text-3xl leading-none text-white md:text-[2.4rem]">{f.texto}</span>
                          <p className="mt-2 whitespace-nowrap text-base leading-snug text-white/80">{f.rotulo}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ---------- posicionamento: do anúncio à decisão ---------- */}
        <section id="posicionamento" className="lp-clara relative scroll-mt-24 overflow-hidden py-20 md:py-28">
          <div className="fundo-curvas pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
          <MarcaArini variante="radar" titulo="" className="pointer-events-none absolute right-5 top-6 hidden w-9 md:right-8 md:block" />
          <div className="lp-container relative">
            <TituloSecao
              centro
              eyebrow="02 · Posicionamento"
              titulo="Do anúncio à decisão."
              destaque={1}
              subtitulo="Mais do que anunciar imóveis, a ARINI conecta território, inteligência e negócios em uma única plataforma."
            />
            <Reveal delay={0.2} className="mt-6 flex flex-wrap justify-center gap-2.5">
              <PilulaPonto>Inteligência</PilulaPonto>
              <PilulaPonto>Segurança</PilulaPonto>
              <PilulaPonto>Transparência</PilulaPonto>
            </Reveal>
            <Stagger className="mt-12 grid gap-5 md:grid-cols-3" gap={0.12} itemClassName="h-full">
              {[
                { t: "Conheça o imóvel", d: "Explore propriedades urbanas e rurais, conheça sua localização e descubra suas características.", quadros: vitrine1 },
                { t: "Amplie sua visão", d: "Acesse informações territoriais que ajudam a compreender melhor o imóvel e seu entorno.", quadros: cartografia },
                { t: "Avance com confiança", d: "Conecte-se a oportunidades e tenha o suporte da ARINI para avançar na experiência imobiliária.", quadros: confianca },
              ].map((p, k) => (
                <div key={p.t} className="cartao lp-lift flex h-full flex-col overflow-hidden">
                  <CartaoRotativo quadros={p.quadros} atraso={k * 1400} />
                  <div className="flex-1 p-6 md:p-7">
                    <ItemNumerado numero={k + 1} titulo={p.t} className="!border-t-0 !pt-0">{p.d}</ItemNumerado>
                  </div>
                </div>
              ))}
            </Stagger>
          </div>
        </section>

        {/* ---------- a ferramenta: como você usa ---------- */}
        <section id="ferramenta" className="lp-branca scroll-mt-24 py-20 md:py-28">
          <div className="lp-container">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <TituloSecao
                eyebrow="03 · A ferramenta"
                titulo="Como você usa a Arini"
                destaque={1}
                subtitulo="A ARINI reúne em um só lugar o que hoje exige dezenas de sites e consultas: divisas de imóveis, cartografia oficial e informações de órgãos públicos. Explore propriedades, consulte informações territoriais e descubra oportunidades em um ambiente que conecta mapas, imóveis e inteligência."
              />
              <MaisLink href="/mapa">Abrir o mapa</MaisLink>
            </div>
            <div className="mt-12"><ComoUsar /></div>
          </div>
        </section>

        {/* ---------- municípios atendidos ---------- */}
        {municipios.length > 0 && (
          <section id="municipios" className="lp-clara scroll-mt-24 py-20 md:py-28">
            <div className="lp-container">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <TituloSecao
                  eyebrow="04 · Cobertura"
                  titulo="Municípios atendidos"
                  subtitulo="Inteligência geográfica conectando nacionalmente, territórios e oportunidades imobiliárias."
                />
                <MaisLink href="/imoveis">Todos os imóveis</MaisLink>
              </div>
              <div className="mt-12"><Municipios municipios={municipios} /></div>
            </div>
          </section>
        )}

        {/* ---------- consultas (mapa ao vivo + atalhos) ---------- */}
        <VitrineConsultas consultas={CONSULTAS} />

        {/* ---------- por que a Arini ---------- */}
        <section className="lp-branca overflow-hidden py-20 md:py-28">
          <div className="lp-container grid gap-16 lg:grid-cols-2 lg:items-center">
            <div>
              <TituloSecao
                eyebrow="06 · Diferenciais"
                titulo="Por que a Arini"
                subtitulo="Mais segurança, informação e oportunidades para negociar imóveis. Conectamos cartografia, fontes oficiais e mercado imobiliário em uma experiência integrada, do primeiro contato à negociação."
              />
              <Stagger className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10" gap={0.12}>
                {porQue.map((s) => (
                  <div key={s.rotulo} className="item-numerado">
                    <Counter value={s.valor} className="lp-display block text-4xl text-verde xl:text-5xl" />
                    <p className="mt-2 text-base leading-snug text-texto-2 md:text-[17px]">{s.rotulo}</p>
                  </div>
                ))}
              </Stagger>
              <Reveal delay={0.2}>
                <Link href="/mapa" className={`${BTN_ACAO} mt-12`}>Conhecer a ferramenta <ArrowRight /></Link>
              </Reveal>
            </div>
            <div className="relative">
              <ClipReveal from="right" className="relative overflow-hidden rounded-2xl">
                <Parallax className="aspect-[5/5.4]" strength={50}>
                  <Image src="/img/fazenda-gado.jpg" alt="Propriedade rural na região de Iturama" fill sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover" />
                </Parallax>
              </ClipReveal>
              {n.municipios > 0 && (
                <Reveal delay={0.4} className="absolute -bottom-8 -left-2 md:-left-10">
                  <div className="rounded-2xl bg-superficie p-6 shadow-md ring-1 ring-linha">
                    <Counter value={String(n.municipios)} className="lp-display block text-5xl text-texto" />
                    <p className="mt-1 text-base font-semibold text-texto-2">municípios no mapa</p>
                  </div>
                </Reveal>
              )}
            </div>
          </div>
        </section>

        {/* ---------- últimos publicados ---------- */}
        <section id="imoveis" className="lp-clara scroll-mt-24 py-20 md:py-28">
          <div className="lp-container">
            <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
              <TituloSecao eyebrow="07 · Vitrine" titulo="Últimos publicados" destaque={1} />
              <MaisLink href="/imoveis">Ver todos os imóveis</MaisLink>
            </div>
            {/* lupa: busca simples com filtro de cidade, cai na busca de imóveis */}
            <form action="/imoveis" method="get" role="search" aria-label="Buscar imóveis"
              className="-mt-4 mb-10 flex flex-col gap-2 rounded-2xl bg-superficie p-2 ring-1 ring-linha sm:flex-row sm:items-center">
              <label className="flex min-w-0 flex-1 items-center gap-2 px-3">
                <Search className="size-5 shrink-0 text-verde" aria-hidden="true" />
                <span className="sr-only">O que você procura</span>
                <input name="q" type="search" placeholder="Buscar por título ou código"
                  className="h-11 w-full min-w-0 bg-transparent text-base text-texto outline-none placeholder:text-texto-3" />
              </label>
              <label className="sm:border-l sm:border-linha sm:pl-2">
                <span className="sr-only">Cidade</span>
                <select name="municipio" defaultValue=""
                  className="h-11 w-full rounded-xl bg-transparent px-3 text-base text-texto outline-none sm:w-56">
                  <option value="">Todas as cidades</option>
                  {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </label>
              <button type="submit" className="lp-btn lp-btn-verde px-6 py-3">Buscar</button>
            </form>
            {imoveis.length > 0 ? (
              <Stagger className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" gap={0.1} itemClassName="h-full">
                {imoveis.map((p) => {
                  const capa = (p.media as { storage_path: string; capa: boolean }[] | null)?.find((m) => m.capa)
                    ?? (p.media as { storage_path: string }[] | null)?.[0];
                  const geo = p.geo as unknown as { area_m2: number | null } | null;
                  const mun = p.municipality as unknown as { nome: string } | null;
                  const leilao = (p as { modalidade?: string | null }).modalidade === "leilao";
                  return (
                    <Link
                      key={p.codigo}
                      href={`/imovel/${p.codigo}`}
                      className="lp-lift group flex h-full flex-col overflow-hidden rounded-2xl bg-superficie ring-1 ring-linha hover:ring-verde/60"
                    >
                      <div className="relative aspect-[16/10] overflow-hidden bg-superficie-2">
                        {/* foto enviada pelo anunciante (Storage do Supabase): <img> com proporção fixa, sem salto */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={capa ? mediaUrl(capa.storage_path) : p.tipo === "rural" ? "/img/aerea-campo.jpg" : "/img/casa-urbana.jpg"}
                          alt={p.titulo}
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.07]"
                        />
                        <span className="absolute left-4 top-4 rounded-full bg-[#124431] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#F2F2EC]">
                          {p.tipo === "rural" ? "Rural" : "Urbano"}
                        </span>
                        {leilao && (
                          <span className="absolute right-4 top-4 rounded-full bg-[#D9BD6F] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#124431]">
                            Leilão
                          </span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col p-6">
                        <h3 className="lp-display text-xl leading-snug text-texto transition group-hover:text-verde">{p.titulo}</h3>
                        {mun?.nome && (
                          <p className="mt-2 flex items-center gap-1.5 text-base text-texto-2">
                            <MapPin className="size-4 text-verde" /> {mun.nome}
                          </p>
                        )}
                        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
                          <span className="lp-display text-2xl text-verde">{formatBRL(p.valor)}</span>
                          <span className="flex items-center gap-1.5 text-[15px] text-texto-2">
                            <Ruler className="size-4" /> {formatArea(geo?.area_m2 ?? null, p.tipo as "urbano" | "rural")}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </Stagger>
            ) : (
              <p className="rounded-2xl border border-dashed border-linha p-10 text-center text-lg text-texto-2">
                Os imóveis aprovados pela Arini aparecem aqui. Enquanto isso,{" "}
                <Link href="/mapa" className="font-semibold text-verde hover:underline">explore o mapa</Link>.
              </p>
            )}
          </div>
        </section>

        {/* ---------- como funciona ---------- */}
        <section id="como-funciona" className="lp-escuro lp-malha-escura relative isolate scroll-mt-24 overflow-hidden py-20 md:py-28">
          <MarcaArini variante="radar" titulo="" className="pointer-events-none absolute right-5 top-6 hidden w-9 md:right-8 md:block" />
          <div className="lp-container">
            <TituloSecao
              claro
              eyebrow="08 · Da exploração à negociação"
              titulo="Como funciona"
              subtitulo="Junção de dados públicos e informações territoriais integrados à experiência ARINI."
            />
            <div className="mt-16"><ComoFunciona /></div>
          </div>
        </section>

        {/* ---------- fontes oficiais ---------- */}
        <section aria-labelledby="titulo-fontes" className="lp-clara border-b border-linha py-12 md:py-14">
          <div className="lp-container mb-8 flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="titulo-fontes" className="lp-display text-2xl text-texto md:text-3xl">Informações oficiais</h2>
            <p className="text-base text-texto-2">Fonte fora do ar aparece como indisponível, nunca como &ldquo;nada encontrado&rdquo;.</p>
          </div>
          <FontesMarquee />
        </section>

        {/* ---------- sobre a Arini ---------- */}
        <section id="sobre" className="lp-branca scroll-mt-24 overflow-hidden py-20 md:py-28">
          <div className="lp-container grid gap-14 lg:grid-cols-[1fr_1.05fr] lg:items-center">
            <div className="relative order-2 lg:order-1">
              <ClipReveal from="left" className="relative aspect-[4/3.4] overflow-hidden rounded-2xl ring-1 ring-linha">
                <MosaicoSatelite lng={-50.196} lat={-19.728} z={14} alt="Iturama vista do satélite" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                <div className="lp-escuro absolute bottom-0 p-7">
                  <p className="lp-display text-2xl text-white">Arini Negócios Imobiliários</p>
                  <p className="mt-1 text-base text-white/80">Iturama · Pontal do Triângulo Mineiro</p>
                </div>
              </ClipReveal>
            </div>
            <div className="order-1 lg:order-2">
              <TituloSecao eyebrow="09 · A Arini" titulo={texto(cfg, "sobre_titulo", "Conheça a Arini")} />
              <Reveal delay={0.15}>
                <div className="mt-6 space-y-4 text-lg leading-relaxed text-texto-2">
                  {paragrafosSobre.map((p, i) => <p key={i}>{p}</p>)}
                </div>
                <div className="mt-9 flex flex-wrap gap-3">
                  <Link href="/suporte" className={BTN_ACAO}>Falar com a Arini <ArrowRight /></Link>
                  {siteArini && (
                    <a href={siteArini} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-contorno">
                      Site da imobiliária
                    </a>
                  )}
                </div>
              </Reveal>
            </div>
          </div>
        </section>
      </main>

      <PreRodape contato={contato} />
      <RodapeSite marca={marca} contato={contato} />
    </div>
  );
}
