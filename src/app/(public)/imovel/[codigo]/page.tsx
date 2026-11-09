import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft, ArrowRight, Bath, BedDouble, Building, CalendarDays, Car, Check, ChevronRight, Cross, DoorOpen,
  ExternalLink, FileText, Fuel, Gavel, GraduationCap, Hospital, Landmark, MapPin, Navigation, Rotate3d,
  Route, Ruler, ShieldCheck, ShoppingCart, Sprout,
} from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { Conteudo, Etiqueta, PilulaPonto, Secao } from "@/components/ui/Pagina";
import MarcaArini from "@/components/marca/MarcaArini";
import IndicadoresMunicipio from "@/components/rural/IndicadoresMunicipio";
import { currentUser } from "@/lib/supabase/server";
import MiniMapa from "@/components/map/MiniMapa";
import InteresseForm from "@/components/InteresseForm";
import BotaoCompartilhar from "@/components/BotaoCompartilhar";
import BotaoExportarSig from "@/components/compartilhar/BotaoExportarSig";
import { OG_IMAGEM_PADRAO, OG_NOME_SITE } from "@/lib/compartilhar";
import BotaoFavorito from "@/components/imovel/BotaoFavorito";
import { codigosFavoritos } from "@/lib/imovel/favoritos";
import GaleriaImovel, { type Slide } from "@/components/GaleriaImovel";
import TourImersivo from "@/components/imovel/TourImersivo";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatBRL, formatArea, STATUS_LABEL } from "@/lib/format";
import { registrarEventoImovel, ORIGEM_DADO_LABEL } from "@/lib/imovel/eventos";
import { ator, temRecurso } from "@/lib/authz";
import CartaoAvaliacaoPublico from "@/components/avaliacao/CartaoAvaliacaoPublico";
import { CATEGORIA_POI_LABEL, formatDistancia, formatPerimetro, nomePoi, poisOrdenados } from "@/lib/geo/distancia";

type Media = { tipo: string; path: string; capa: boolean };

function mediaUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

type Leilao = {
  praca1_data?: string | null; praca1_lance?: number | null; praca2_data?: string | null; praca2_lance?: number | null;
  processo?: string | null; comitente?: string | null; site?: string | null; condicoes?: string | null;
};
const quandoPraca = (d?: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" }) : null;

// cache() do React: generateMetadata e a página pedem o mesmo imóvel no mesmo
// request; sem isso a RPC rodava duas vezes (desempenho, 09/11/2026)
const getImovel = cache(async (codigo: string) => {
  const { data } = await supabaseAdmin().rpc("fn_property_public", { p_codigo: codigo });
  return data as {
    codigo: string; tipo: "urbano" | "rural"; status: string; titulo: string;
    descricao: string; valor: number | null; area_declarada: number | null;
    caracteristicas: Record<string, unknown>; condicoes_venda: string | null;
    aceita_permuta: boolean; aceita_financiamento: boolean;
    municipio: { nome: string; uf: string } | null;
    geometry: GeoJSON.Geometry | null; area_m2: number | null; perimeter_m: number | null;
    media: Media[];
  } | null;
});

export async function generateMetadata(
  { params }: PageProps<"/imovel/[codigo]">
): Promise<Metadata> {
  const { codigo } = await params;
  const imovel = await getImovel(codigo);
  if (!imovel) return { title: "Imóvel não encontrado" };
  // prévia do WhatsApp: a capa precisa ser foto (vídeo não aparece); sem foto, a imagem padrão do site
  const capa = imovel.media.find((m) => m.capa && m.tipo === "foto") ?? imovel.media.find((m) => m.tipo === "foto");
  const onde = imovel.municipio ? `${imovel.municipio.nome}/${imovel.municipio.uf}` : null;
  const resumo = [formatBRL(imovel.valor), imovel.area_m2 ? formatArea(imovel.area_m2, imovel.tipo) : null, onde]
    .filter(Boolean).join(" · ");
  return {
    title: `${imovel.titulo} — ${imovel.codigo}`,
    description: (imovel.descricao || resumo).slice(0, 160),
    alternates: { canonical: `/imovel/${imovel.codigo}` },
    openGraph: {
      type: "website", siteName: OG_NOME_SITE, locale: "pt_BR",
      url: `/imovel/${imovel.codigo}`,
      title: imovel.titulo,
      description: `${resumo} — ${OG_NOME_SITE}`,
      images: [{ url: capa ? mediaUrl(capa.path) : OG_IMAGEM_PADRAO, alt: imovel.titulo }],
    },
    twitter: { card: "summary_large_image" },
  };
}

/** Ficha técnica: mostra só o que o anúncio realmente informou. */
function fichaTecnica(
  c: Record<string, unknown>,
  areaM2: number | null,
  tipo: "urbano" | "rural"
): { rotulo: string; valor: string; icone: LucideIcon }[] {
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  const itens: { rotulo: string; valor: string; icone: LucideIcon }[] = [];
  const add = (chave: string, rotulo: string, icone: LucideIcon) => {
    const v = c[chave];
    if (v != null && v !== "" && num(v) > 0) itens.push({ rotulo, valor: String(num(v)), icone });
  };
  add("quartos", "Quartos", BedDouble);
  add("suites", "Suítes", DoorOpen);
  add("banheiros", "Banheiros", Bath);
  add("vagas", "Vagas", Car);
  if (areaM2) itens.push({ rotulo: "Área", valor: formatArea(areaM2, tipo), icone: Ruler });
  if (typeof c.zoneamento === "string") itens.push({ rotulo: "Zoneamento", valor: c.zoneamento, icone: Building });
  if (typeof c.solo === "string") itens.push({ rotulo: "Solo", valor: c.solo, icone: Sprout });
  return itens;
}

/** Ícone por categoria de ponto de interesse (os rótulos vêm de lib/geo/distancia). */
const POI_ICONE: Record<string, LucideIcon> = {
  combustivel: Fuel, farmacia: Cross, supermercado: ShoppingCart, hospital: Hospital,
  escola: GraduationCap, centro: Landmark, acesso_rodovia: Route,
};

export default async function PaginaImovel({ params }: PageProps<"/imovel/[codigo]">) {
  const { codigo } = await params;
  // código do nome antigo (ARINI-MAP-000002) → o mesmo imóvel no padrão novo
  const antigo = codigo.match(/^ARINI-MAP-(\d{6})$/i);
  if (antigo) redirect(`/imovel/AIB-${antigo[1]}`);
  const admin = supabaseAdmin();
  // tudo o que só depende do código sai junto (antes era uma fila de idas ao banco)
  const [imovel, { data: propId }, { data: matriculaConferida }, user] = await Promise.all([
    getImovel(codigo),
    admin.from("properties").select("id, modalidade, leilao, owner_id, partner_id, car_codigo").eq("codigo", codigo).maybeSingle(),
    // só a DATA da conferência: o número da matrícula não vai para o site público
    admin.from("property_matriculas")
      .select("conferida_em, imovel:properties!inner(codigo)").eq("imovel.codigo", codigo).not("conferida_em", "is", null).maybeSingle(),
    currentUser(),
  ]);
  if (!imovel) notFound();
  const leilao = propId?.modalidade === "leilao" ? (propId.leilao ?? {}) as Leilao : null;
  const [{ data: tourData }, { data: video }, { data: unidades }, { data: whats }, { data: divisa }, { data: origemCadastro }, favoritos, a] = await Promise.all([
    admin.rpc("fn_property_tour", { p_codigo: codigo }),
    admin.from("presentations").select("output_path")
      .eq("tipo", "video").eq("status", "pronto").not("output_path", "is", null)
      // order+limit: antes da 0063 podia haver vídeo duplicado (maybeSingle quebrava)
      .eq("property_id", propId?.id ?? "").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("properties")
      .select("codigo, titulo, valor, status")
      .eq("parent_property_id", propId?.id ?? "")
      .in("status", ["publicado", "em_negociacao", "vendido"])
      .order("titulo"),
    admin.from("settings").select("valor").eq("chave", "whatsapp_central").maybeSingle(),
    // rastreabilidade (§1.3/§1.5): versão atual da divisa e origem do cadastro
    admin.from("property_geometry_versions").select("versao, situacao, validada_em")
      .eq("property_id", propId?.id ?? "").neq("situacao", "substituida")
      .order("versao", { ascending: false }).limit(1).maybeSingle(),
    admin.from("property_data_sources").select("origem")
      .eq("property_id", propId?.id ?? "").eq("campo", "cadastro")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    codigosFavoritos(user?.id),
    user ? ator() : Promise.resolve(null),
  ]);

  const pois = poisOrdenados((tourData as { pois?: { nome: string | null; categoria: string; distancia_m: number }[] } | null)?.pois ?? [])
    .slice(0, 10);
  const centroid = (tourData as { centroid?: { lng: number; lat: number } } | null)?.centroid;
  const whatsapp = (typeof whats?.valor === "string" ? whats.valor : null)
    ?? process.env.NEXT_PUBLIC_WHATSAPP_ARINI
    ?? null;

  const fotos = imovel.media.filter((m) => m.tipo === "foto");
  const benfeitorias = (imovel.caracteristicas?.benfeitorias as string[] | undefined) ?? [];
  const ficha = fichaTecnica(imovel.caracteristicas ?? {}, imovel.area_m2, imovel.tipo);
  const vendido = imovel.status === "vendido";

  // slides: fotos → vídeo (se pronto) → tour 3D (se houver geometria)
  const slides: Slide[] = [
    ...fotos.map((f) => ({ tipo: "foto" as const, url: mediaUrl(f.path) })),
    // vídeos enviados pelo anunciante, depois o vídeo automático do sobrevoo
    ...imovel.media.filter((m) => m.tipo === "video").map((v) => ({ tipo: "video" as const, url: mediaUrl(v.path) })),
    ...(video?.output_path ? [{ tipo: "video" as const, url: mediaUrl(video.output_path) }] : []),
    ...(imovel.geometry
      ? [{ tipo: "tour" as const, href: `/imovel/${imovel.codigo}/tour`, poster: fotos[0] ? mediaUrl(fotos[0].path) : null }]
      : []),
  ];

  const favorito = favoritos.includes(imovel.codigo);
  const usuario = user
    ? { nome: user.nome || "Conta", papel: user.role === "admin_central" ? "Administrador" : "Usuário" }
    : null;

  // §1.1: abertura da ficha vira evento (nunca derruba a página)
  if (propId?.id) void registrarEventoImovel({ propertyId: propId.id, tipo: "ficha", userId: user?.id, detalhe: { codigo } });

  // histórico completo: dono, parceiro responsável ou quem tem o recurso no plano
  const podeVerHistorico = !!a && !!propId && (
    a.ehArini || temRecurso(a, "historico_imovel") ||
    (!!a.ownerId && propId.owner_id === a.ownerId) || (!!a.partnerId && propId.partner_id === a.partnerId)
  );

  return (
    <Moldura usuario={usuario}>
      {/* ---------- topo em faixa escura: trilha, selos, título e preço ---------- */}
      <header className="lp-escuro lp-malha-escura relative overflow-hidden">
        <MarcaArini variante="radar" titulo=""
          className="pointer-events-none absolute right-5 top-5 hidden w-9 md:right-8 md:top-7 md:block" />
        <Conteudo className="relative pt-8 pb-10 md:pt-10 md:pb-14">
          <nav aria-label="Trilha" className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-texto-2 md:pr-16">
            <Link href="/" className="transition hover:text-verde">Home</Link>
            <ChevronRight className="size-3.5 shrink-0 opacity-60" />
            <Link href="/imoveis" className="transition hover:text-verde">Imóveis</Link>
            <ChevronRight className="size-3.5 shrink-0 opacity-60" />
            <span className="min-w-0 truncate font-semibold text-texto">{imovel.titulo}</span>
          </nav>

          <Link href="/mapa" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-texto-2 transition hover:text-verde">
            <ArrowLeft className="size-4" /> Voltar para o mapa
          </Link>

          <p className="lp-eyebrow mt-8 flex w-fit">{imovel.tipo === "rural" ? "Imóvel rural" : "Imóvel urbano"} · {imovel.codigo}</p>

          <div className="mt-4 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0 max-w-3xl">
              <h1 className="lp-display text-balance text-4xl text-texto sm:text-5xl md:text-[4rem]">
                {imovel.titulo}
              </h1>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
                <PilulaPonto className={vendido ? "opacity-70" : ""}>
                  {vendido ? "Vendido" : leilao ? "Leilão" : "Disponível"}
                </PilulaPonto>
                <span className="flex items-center gap-1.5 text-[15px] text-texto-2">
                  <MapPin className="size-4 text-verde" />
                  {imovel.municipio ? `${imovel.municipio.nome} / ${imovel.municipio.uf}` : "Região piloto"}
                </span>
              </div>
            </div>
            {/* número de destaque: fio dourado e preço na fonte de título */}
            <div className="shrink-0 border-t border-[#D9BD6F]/70 pt-4 md:min-w-[17rem] md:text-right">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-texto-2">{leilao ? "Lance inicial" : "Valor de venda"}</p>
              <p className={`lp-display mt-2 text-[2.9rem] leading-none text-[var(--ouro-claro)] md:text-[3.6rem] ${vendido ? "line-through opacity-60" : ""}`}>{formatBRL(imovel.valor)}</p>
            </div>
          </div>
        </Conteudo>
      </header>

      <Conteudo className="py-10 md:py-14">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* ---------- coluna principal ---------- */}
          <div className="min-w-0 space-y-12 md:space-y-14">
            {(slides.length > 0 || ficha.length > 0) && (
              <div className="space-y-6">
                {slides.length > 0 && <GaleriaImovel slides={slides} titulo={imovel.titulo} />}

                {ficha.length > 0 && (
                  <div className="cartao !p-0 overflow-hidden">
                    <p className="border-b border-linha px-5 py-3.5 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-texto-2 md:px-6">Ficha técnica</p>
                    <dl className="grid sm:grid-cols-2 sm:[&>div:nth-child(odd)]:border-r sm:[&>div]:border-linha">
                      {ficha.map((f) => {
                        const Icone = f.icone;
                        return (
                          <div key={f.rotulo} className="flex items-center justify-between gap-4 border-b border-linha px-5 py-3.5 last:border-b-0 md:px-6">
                            <dt className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-texto-2">
                              <Icone className="size-4 text-verde" /> {f.rotulo}
                            </dt>
                            <dd className="lp-display break-words text-right text-2xl leading-none text-texto">{f.valor}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                )}
              </div>
            )}

            {benfeitorias.length > 0 && (
              <Secao eyebrow="01 · Benfeitorias" titulo="Diferenciais">
                <ul className="grid gap-3 sm:grid-cols-2">
                  {benfeitorias.map((b) => (
                    <li key={b} className="flex items-center gap-3 border-t border-linha-forte py-3.5 text-base">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-[#D9BD6F] text-ouro">
                        <Check className="size-3.5" strokeWidth={3} />
                      </span>
                      <span className="capitalize text-texto">{b}</span>
                    </li>
                  ))}
                </ul>
              </Secao>
            )}

            <Secao eyebrow="02 · Descrição" titulo="Sobre o imóvel">
              <div className="max-w-[68ch] whitespace-pre-line text-[17px] leading-relaxed text-texto-3">
                {imovel.descricao || "Descrição não informada."}
              </div>
            </Secao>

            {/* item 9: tour 360 / vídeo imersivo — iframe só depois do clique */}
            {typeof imovel.caracteristicas?.tour_virtual_url === "string" && (
              <Secao eyebrow="Tour virtual" titulo="Visite por dentro">
                <TourImersivo url={imovel.caracteristicas.tour_virtual_url} titulo={imovel.titulo}
                  poster={fotos[0] ? mediaUrl(fotos[0].path) : null} />
              </Secao>
            )}

            {imovel.geometry && (
              <Secao eyebrow="03 · Divisa no mapa" titulo="Localização e área">
                <MiniMapa geometry={imovel.geometry} status={imovel.status}
                  className="h-80 w-full overflow-hidden rounded-[20px] border border-linha md:h-[26rem]" />
                <dl className="cartao divide-y divide-linha !p-0 text-[15px]">
                  <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">Área medida no mapa</dt>
                    <dd className="lp-display text-2xl text-verde">{formatArea(imovel.area_m2, imovel.tipo)}</dd>
                  </div>
                  {imovel.perimeter_m ? (
                    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                      <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">Perímetro</dt>
                      <dd className="font-semibold text-texto">{formatPerimetro(imovel.perimeter_m)}</dd>
                    </div>
                  ) : null}
                  {imovel.area_declarada ? (
                    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                      <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">Área declarada pelo anunciante</dt>
                      <dd className="font-semibold text-texto">{imovel.area_declarada.toLocaleString("pt-BR")} {imovel.tipo === "rural" ? "ha" : "m²"}</dd>
                    </div>
                  ) : null}
                </dl>
              </Secao>
            )}

            {/* 5.3/5.4: só com a função ligada pela Diretoria e o recurso no plano */}
            <CartaoAvaliacaoPublico propertyId={propId?.id} tipo={imovel.tipo} status={imovel.status} />

            {!!unidades?.length && (
              <Secao eyebrow="04 · Empreendimento" titulo="Unidades deste empreendimento">
                <div className="cartao divide-y divide-linha overflow-hidden !p-0">
                  {unidades.map((u) => (
                    <Link key={u.codigo} href={`/imovel/${u.codigo}`}
                      className="group flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 transition hover:bg-superficie-2">
                      <span className="min-w-0 flex-1 font-semibold text-texto transition group-hover:text-verde">{u.titulo}</span>
                      <span className="lp-display text-lg tabular-nums text-verde">{formatBRL(u.valor)}</span>
                      <Etiqueta tom={u.status === "vendido" ? "neutro" : "verde"}>{STATUS_LABEL[u.status]}</Etiqueta>
                    </Link>
                  ))}
                </div>
                <Link href={`/imovel/${imovel.codigo}/espelho`}
                  className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-verde underline-offset-4 hover:underline">
                  Ver lotes disponíveis no espelho
                </Link>
              </Secao>
            )}

            {centroid && <IndicadoresMunicipio ponto={centroid} />}

            {pois.length > 0 && (
              <Secao eyebrow="05 · Arredores" titulo="Pontos de interesse próximos"
                subtitulo="Distâncias em linha reta, do centro do imóvel. Fonte: OpenStreetMap, atualizada periodicamente.">
                <div className="cartao grid gap-x-8 !p-2 sm:grid-cols-2 md:!p-3">
                  {pois.map((p, i) => {
                    const Icone = POI_ICONE[p.categoria] ?? MapPin;
                    return (
                      <div key={i} className="flex items-center gap-3.5 border-b border-linha px-3 py-3.5 last:border-b-0">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-linha-forte text-verde">
                          <Icone className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-texto">
                            {nomePoi(p.nome) ?? CATEGORIA_POI_LABEL[p.categoria] ?? p.categoria}
                          </span>
                          {p.nome && <span className="block text-xs text-texto-2">{CATEGORIA_POI_LABEL[p.categoria] ?? p.categoria}</span>}
                        </span>
                        <span className="lp-display shrink-0 text-lg tabular-nums text-texto">{formatDistancia(p.distancia_m)}</span>
                      </div>
                    );
                  })}
                </div>
              </Secao>
            )}

            {leilao && (
              <section className="cartao space-y-5 !border-[#D9BD6F]/60 p-6 md:p-7">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-full border border-[#D9BD6F] text-ouro">
                    <Gavel className="size-5" />
                  </span>
                  <div><p className="lp-eyebrow text-xs">06 · Leilão</p><h2 className="lp-display mt-2 text-3xl text-texto">Praças e condições</h2></div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[1, 2].map((n) => {
                    const data = quandoPraca(n === 1 ? leilao.praca1_data : leilao.praca2_data);
                    const lance = n === 1 ? leilao.praca1_lance : leilao.praca2_lance;
                    if (!data && lance == null) return null;
                    return (
                      <div key={n} className="item-numerado">
                        <p className="numero !tracking-[0.2em] uppercase">{n}ª praça</p>
                        <p className="mt-1.5 flex items-center gap-2 font-semibold text-texto">
                          <CalendarDays className="size-4 shrink-0 text-ouro" /> {data ?? "Data a definir"}
                        </p>
                        {lance != null && <p className="mt-1 text-[15px] font-semibold text-ouro">Lance mínimo {formatBRL(Number(lance))}</p>}
                      </div>
                    );
                  })}
                </div>
                <dl className="space-y-1.5 text-[15px]">
                  {leilao.comitente && <div className="flex gap-2"><dt className="text-texto-2">Comitente:</dt><dd className="text-texto">{leilao.comitente}</dd></div>}
                  {leilao.processo && <div className="flex gap-2"><dt className="text-texto-2">Processo:</dt><dd className="text-texto">{leilao.processo}</dd></div>}
                </dl>
                {leilao.condicoes && <p className="whitespace-pre-line text-[15px] leading-relaxed text-texto-2">{leilao.condicoes}</p>}
                {leilao.site && (
                  <a href={leilao.site} target="_blank" rel="noreferrer" className="lp-btn lp-btn-contorno !px-5 !py-3 text-[0.95rem]">
                    Ir para a página do leilão <ExternalLink />
                  </a>
                )}
                <p className="text-sm text-texto-2">
                  Os lances são dados na página do leiloeiro, nas condições do edital. Leia o edital antes de participar.
                </p>
              </section>
            )}

            {imovel.condicoes_venda && (
              <Secao eyebrow="07 · Negociação" titulo="Condições de venda">
                <p className="text-[17px] leading-relaxed text-texto-3">{imovel.condicoes_venda}</p>
                {(imovel.aceita_permuta || imovel.aceita_financiamento) && (
                  <div className="flex flex-wrap gap-2">
                    {imovel.aceita_permuta && <Etiqueta tom="verde"><Check className="size-3.5" /> Aceita permuta</Etiqueta>}
                    {imovel.aceita_financiamento && <Etiqueta tom="verde"><Check className="size-3.5" /> Aceita financiamento</Etiqueta>}
                  </div>
                )}
              </Secao>
            )}
          </div>

          {/* ---------- coluna lateral ---------- */}
          <aside className="space-y-4 lg:sticky lg:top-6">
            {vendido ? (
              <div className="cartao p-6 text-center">
                <p className="text-base text-texto-2">Este imóvel já foi vendido pela Arini.</p>
                <Link href="/mapa" className="lp-btn lp-btn-ouro mt-5 w-full">Ver outros imóveis <ArrowRight /></Link>
              </div>
            ) : (
              <InteresseForm codigo={imovel.codigo} titulo={imovel.titulo} whatsapp={whatsapp} />
            )}

            {imovel.geometry && (
              <Link href={`/imovel/${imovel.codigo}/tour`} className="lp-btn btn-verde w-full !py-3.5">
                <Rotate3d /> Ver tour 3D da propriedade
              </Link>
            )}
            {imovel.tipo === "rural" && (
              <Link href={`/imovel/${imovel.codigo}/relatorio`} className="lp-btn lp-btn-contorno w-full !py-3">
                <FileText /> Relatório territorial
              </Link>
            )}
            {["publicado", "em_negociacao", "vendido"].includes(imovel.status) && (
              <BotaoFavorito codigo={imovel.codigo} inicial={favorito} variante="ficha" />
            )}
            <BotaoCompartilhar codigo={imovel.codigo} titulo={imovel.titulo}
              resumo={[formatBRL(imovel.valor), imovel.municipio ? `${imovel.municipio.nome}/${imovel.municipio.uf}` : null].filter(Boolean).join(" · ")} />
            {/* item 8: exportar para SIG — só quando a ficha já mostra a divisa (mesma regra do mapa acima) */}
            {imovel.geometry && (
              <BotaoExportarSig nomeBase={imovel.codigo}
                divisa={{
                  geometry: imovel.geometry, rotulo: `Divisa ${imovel.codigo}`,
                  atributos: {
                    codigo: imovel.codigo, titulo: imovel.titulo,
                    area_ha: imovel.area_m2 ? Math.round(imovel.area_m2 / 100) / 100 : null,
                    perim_m: imovel.perimeter_m ? Math.round(imovel.perimeter_m) : null,
                    municipio: imovel.municipio ? `${imovel.municipio.nome}/${imovel.municipio.uf}` : null,
                    fonte: "Arini Imóveis Brasil",
                  },
                }}
                carCodigo={(propId?.car_codigo as string | null) ?? null} />
            )}
            {centroid && (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${centroid.lat},${centroid.lng}`}
                target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 rounded-full border-[1.5px] border-linha-forte py-3 text-sm font-bold text-texto transition hover:border-verde hover:text-verde">
                <Navigation className="size-4" /> Como chegar até o imóvel
              </a>
            )}
            {(divisa || origemCadastro || matriculaConferida) && (
              <div className="cartao space-y-2 p-5 text-sm">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-texto-2">
                  <ShieldCheck className="size-4 text-verde" /> Rastreabilidade
                </p>
                {divisa && (
                  <p className={divisa.situacao === "validada" ? "flex items-start gap-1.5 font-semibold text-verde" : "text-texto-2"}>
                    {divisa.situacao === "validada"
                      ? <><Check className="mt-0.5 size-4 shrink-0" strokeWidth={3} />{`Divisa validada pela Arini${divisa.validada_em ? ` em ${new Date(divisa.validada_em).toLocaleDateString("pt-BR")}` : ""}`}</>
                      : "Divisa informada pelo anunciante (em análise)"}
                  </p>
                )}
                {matriculaConferida && (
                  <p className="flex items-start gap-1.5 font-semibold text-verde">
                    <Check className="mt-0.5 size-4 shrink-0" strokeWidth={3} />Matrícula conferida pela Arini
                  </p>
                )}
                {divisa && <p className="text-texto-2">Versão {divisa.versao} da divisa</p>}
                {origemCadastro && (
                  <p className="text-texto-2">Origem do cadastro: {ORIGEM_DADO_LABEL[origemCadastro.origem] ?? origemCadastro.origem}</p>
                )}
                {podeVerHistorico && propId && (
                  <Link href={`/painel/imoveis/${propId.id}`} className="inline-flex items-center gap-1 pt-1 text-sm font-semibold text-verde hover:underline">
                    Ver histórico completo <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            )}
            <p className="text-center text-xs text-texto-2">
              Intermediação: Arini Negócios Imobiliários
            </p>
          </aside>
        </div>
      </Conteudo>

      {/* faixa de conversão: Verde Profundo com linhas de mapa e o radar do manual */}
      {!vendido && (
        <section className="lp-escuro fundo-curvas-escuro relative overflow-hidden" aria-label="Falar com a Arini">
          <MarcaArini variante="radar" titulo=""
            className="pointer-events-none absolute right-5 top-5 w-9 md:right-8 md:top-7" />
          <Conteudo className="relative flex flex-col gap-8 py-14 md:flex-row md:items-end md:justify-between md:py-20">
            <div className="max-w-2xl">
              <p className="lp-eyebrow">Próximo passo</p>
              <h2 className="lp-display mt-4 text-4xl text-texto md:text-[3.25rem]">
                Gostou do <span className="text-ouro">{imovel.tipo === "rural" ? "território" : "imóvel"}?</span> Vamos conversar.
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-texto-2">
                A equipe da Arini mostra a divisa conferida, os documentos e agenda a visita.
              </p>
            </div>
            <a href="#interesse" className="lp-btn lp-btn-verde shrink-0 self-start md:self-end">
              Falar com a Arini <ArrowRight />
            </a>
          </Conteudo>
        </section>
      )}
    </Moldura>
  );
}
