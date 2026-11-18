import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight, Check, FileText, Heart, Landmark, Lock, MapPin, MessageCircle, Navigation, Rotate3d, ShieldCheck,
} from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { Conteudo, PilulaPonto, Secao } from "@/components/ui/Pagina";
import MarcaArini from "@/components/marca/MarcaArini";
import GaleriaImovel, { type Slide } from "@/components/GaleriaImovel";
import RegistrarVisitaVitrine from "@/components/imovel/RegistrarVisitaVitrine";
import { formatBRL } from "@/lib/format";

/**
 * Ficha do imóvel para quem está SEM conta (pedido de 18/11/2026).
 *
 * Objetivo: o visitante se encantar com o imóvel à venda e criar a conta,
 * "como o Mercado Pago". Até o limite de fichas por navegador (configuração
 * `fichas_visitante`, padrão 2) ele vê a vitrine completa — fotos, vídeos,
 * valor, ficha técnica, diferenciais e a descrição inteira. O que leva à
 * compra (localização exata, tour 3D, documentação conferida, contato,
 * financiamento) fica atrás da parede "crie sua conta grátis". Passado o
 * limite, só a capa desfocada e a parede.
 */

export type DadosVitrine = {
  codigo: string; titulo: string; tipo: "urbano" | "rural"; descricao: string; valor: number | null;
  municipio: { nome: string; uf: string } | null;
  slides: Slide[]; capa: string | null;
  ficha: { rotulo: string; valor: string; icone: LucideIcon }[];
  benfeitorias: string[];
  condicoes: string | null; aceitaPermuta: boolean; aceitaFinanciamento: boolean;
  leilao: boolean; temDivisa: boolean;
};

function linksConta(codigo: string) {
  const volta = encodeURIComponent(`/imovel/${codigo}`);
  return { criar: `/entrar?cadastro=1&papel=comprador&volta=${volta}`, entrar: `/entrar?volta=${volta}` };
}

/** O que a conta gratuita destrava nesta ficha. */
function itensTrancados(d: DadosVitrine): { icone: LucideIcon; titulo: string; texto: string }[] {
  return [
    d.temDivisa && { icone: MapPin, titulo: "Localização exata e divisa", texto: "O imóvel desenhado no mapa, com área e perímetro medidos." },
    d.temDivisa && { icone: Rotate3d, titulo: "Tour 3D da propriedade", texto: "Sobrevoe o terreno em 3D, com relevo e camadas do entorno." },
    { icone: Navigation, titulo: "Arredores e distâncias", texto: "Cidade, escolas, saúde, rodovias e comércio mais próximos." },
    { icone: ShieldCheck, titulo: "Documentação conferida", texto: "Divisa validada e matrícula conferida pela equipe da Arini." },
    !d.leilao || d.aceitaFinanciamento ? { icone: Landmark, titulo: d.aceitaFinanciamento ? "Simulação de financiamento" : "Estimativa de parcelas", texto: "Quanto fica a parcela, com os bancos parceiros." } : null,
    d.tipo === "rural" && { icone: FileText, titulo: "Relatório territorial", texto: "Clima, solo, ambiental e crédito rural da área." },
    { icone: MessageCircle, titulo: "Fale com a Arini e agende a visita", texto: "Atendimento direto pelo WhatsApp, sem intermediário desconhecido." },
    { icone: Heart, titulo: "Favoritos e alertas", texto: "Salve este imóvel e receba os parecidos que entrarem." },
  ].filter(Boolean) as { icone: LucideIcon; titulo: string; texto: string }[];
}

function Parede({ d, titulo, texto }: { d: DadosVitrine; titulo: string; texto: string }) {
  const { criar, entrar } = linksConta(d.codigo);
  return (
    <section id="criar-conta" aria-label="Crie sua conta grátis" className="cartao relative overflow-hidden !border-[#D9BD6F]/60 p-6 md:p-8">
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full border border-[#D9BD6F] text-ouro"><Lock className="size-5" /></span>
        <p className="lp-eyebrow">Conta gratuita</p>
      </div>
      <h2 className="lp-display mt-4 text-3xl text-texto md:text-4xl">{titulo}</h2>
      <p className="mt-3 max-w-[60ch] text-[17px] leading-relaxed text-texto-2">{texto}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={criar} className="lp-btn lp-btn-ouro !px-6 !py-3.5">Criar conta grátis <ArrowRight /></Link>
        <Link href={entrar} className="lp-btn lp-btn-contorno !px-5 !py-3.5">Já tenho conta</Link>
      </div>
      <p className="mt-4 text-xs text-texto-2">Sem cartão e sem mensalidade. Leva menos de um minuto.</p>
    </section>
  );
}

export default function FichaVisitante({ d, liberado, registrar, vistos, limite }: {
  d: DadosVitrine;
  /** dentro do limite de fichas sem conta? */
  liberado: boolean;
  /** primeira abertura desta ficha neste navegador: conta no limite */
  registrar: boolean;
  vistos: number; limite: number;
}) {
  const onde = d.municipio ? `${d.municipio.nome} / ${d.municipio.uf}` : "Região piloto";
  const trancados = itensTrancados(d);
  const { criar } = linksConta(d.codigo);

  return (
    <Moldura usuario={null}>
      {registrar && <RegistrarVisitaVitrine codigo={d.codigo} />}
      {/* topo: o mesmo da ficha completa, para o visitante sentir que já está no imóvel */}
      <header className="lp-escuro lp-malha-escura relative overflow-hidden">
        <MarcaArini variante="radar" titulo="" className="pointer-events-none absolute right-5 top-5 hidden w-9 md:right-8 md:top-7 md:block" />
        <Conteudo className="relative pt-8 pb-10 md:pt-10 md:pb-14">
          <Link href="/imoveis" className="text-sm font-semibold text-texto-2 transition hover:text-verde">← Imóveis à venda</Link>
          <p className="lp-eyebrow mt-8 flex w-fit">{d.tipo === "rural" ? "Imóvel rural" : "Imóvel urbano"} · {d.codigo}</p>
          <div className="mt-4 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0 max-w-3xl">
              <h1 className="lp-display text-balance text-4xl text-texto sm:text-5xl md:text-[4rem]">{d.titulo}</h1>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
                <PilulaPonto>{d.leilao ? "Leilão" : "Disponível"}</PilulaPonto>
                <span className="flex items-center gap-1.5 text-[15px] text-texto-2"><MapPin className="size-4 text-verde" />{onde}</span>
              </div>
            </div>
            <div className="shrink-0 border-t border-[#D9BD6F]/70 pt-4 md:min-w-[17rem] md:text-right">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-texto-2">{d.leilao ? "Lance inicial" : "Valor de venda"}</p>
              <p className="lp-display mt-2 text-[2.9rem] leading-none text-[var(--ouro-claro)] md:text-[3.6rem]">{formatBRL(d.valor)}</p>
            </div>
          </div>
        </Conteudo>
      </header>

      {!liberado ? (
        /* passou do limite de fichas sem conta: capa desfocada e a parede */
        <Conteudo className="space-y-8 py-10 md:py-14">
          {d.capa && (
            <div className="relative h-64 overflow-hidden rounded-[20px] border border-linha md:h-96" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.capa} alt="" className="size-full scale-110 object-cover blur-xl" />
              <div className="absolute inset-0 grid place-items-center bg-[#0A2219]/40">
                <span className="grid size-16 place-items-center rounded-full bg-[#0A2219]/80 text-[var(--ouro-claro)]"><Lock className="size-7" /></span>
              </div>
            </div>
          )}
          <Parede d={d}
            titulo="Continue vendo este imóvel com a sua conta grátis"
            texto={`Você já abriu ${vistos} ${vistos === 1 ? "imóvel" : "imóveis"} sem conta, o limite para visitantes. Crie a conta gratuita para ver as fotos, a ficha completa, a localização exata e o tour 3D de todos os imóveis à venda.`} />
        </Conteudo>
      ) : (
        <Conteudo className="py-10 md:py-14">
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-12 md:space-y-14">
              {d.slides.length > 0 && <GaleriaImovel slides={d.slides} titulo={d.titulo} />}

              {d.ficha.length > 0 && (
                <div className="cartao !p-0 overflow-hidden">
                  <p className="border-b border-linha px-5 py-3.5 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-texto-2 md:px-6">Ficha técnica</p>
                  <dl className="grid sm:grid-cols-2 sm:[&>div:nth-child(odd)]:border-r sm:[&>div]:border-linha">
                    {d.ficha.map((f) => {
                      const Icone = f.icone;
                      return (
                        <div key={f.rotulo} className="flex items-center justify-between gap-4 border-b border-linha px-5 py-3.5 last:border-b-0 md:px-6">
                          <dt className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-texto-2"><Icone className="size-4 text-verde" /> {f.rotulo}</dt>
                          <dd className="lp-display break-words text-right text-2xl leading-none text-texto">{f.valor}</dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              )}

              {d.benfeitorias.length > 0 && (
                <Secao eyebrow="01 · Benfeitorias" titulo="Diferenciais">
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {d.benfeitorias.map((b) => (
                      <li key={b} className="flex items-center gap-3 border-t border-linha-forte py-3.5 text-base">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-[#D9BD6F] text-ouro"><Check className="size-3.5" strokeWidth={3} /></span>
                        <span className="capitalize text-texto">{b}</span>
                      </li>
                    ))}
                  </ul>
                </Secao>
              )}

              <Secao eyebrow="02 · Descrição" titulo="Sobre o imóvel">
                <div className="max-w-[68ch] whitespace-pre-line text-[17px] leading-relaxed text-texto-3">{d.descricao || "Descrição não informada."}</div>
                {(d.aceitaPermuta || d.aceitaFinanciamento) && (
                  <ul className="flex flex-wrap gap-2 pt-2 text-sm font-semibold text-verde">
                    {d.aceitaPermuta && <li className="flex items-center gap-1.5"><Check className="size-4" /> Aceita permuta</li>}
                    {d.aceitaFinanciamento && <li className="flex items-center gap-1.5"><Check className="size-4" /> Aceita financiamento</li>}
                  </ul>
                )}
              </Secao>

              {/* o que a conta destrava: os blocos aparecem, trancados, para dar vontade */}
              <Secao eyebrow="03 · Com a sua conta grátis" titulo="Tudo o que falta para decidir">
                <div className="relative overflow-hidden rounded-[20px] border border-linha">
                  {d.capa && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.capa} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-25 blur-2xl" />
                  )}
                  <ul className="relative grid gap-px bg-linha/60 sm:grid-cols-2">
                    {trancados.map((t) => {
                      const Icone = t.icone;
                      return (
                        <li key={t.titulo} className="flex gap-3.5 bg-superficie/85 p-5 backdrop-blur-sm">
                          <span className="grid size-10 shrink-0 place-items-center rounded-full border border-linha-forte text-verde"><Icone className="size-[1.1rem]" /></span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-semibold text-texto">{t.titulo} <Lock className="size-3.5 text-ouro" /></span>
                            <span className="mt-1 block text-sm leading-relaxed text-texto-2">{t.texto}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </Secao>

              <Parede d={d}
                titulo={`Gostou ${d.tipo === "rural" ? "desta área" : "deste imóvel"}? Crie sua conta e veja tudo`}
                texto="Com a conta gratuita você vê a localização exata, o tour 3D, a documentação conferida pela Arini e fala direto com a nossa equipe para agendar a visita." />
            </div>

            {/* lateral: o chamado para a conta fica sempre à vista */}
            <aside className="space-y-4 lg:sticky lg:top-6">
              <div className="cartao space-y-4 p-6">
                <p className="lp-eyebrow">Próximo passo</p>
                <p className="lp-display text-2xl text-texto">Quer visitar ou saber a localização?</p>
                <p className="text-sm leading-relaxed text-texto-2">Crie sua conta grátis para falar com a Arini, ver o imóvel no mapa e fazer o tour 3D.</p>
                <Link href={criar} className="lp-btn lp-btn-ouro w-full !py-3.5">Criar conta grátis <ArrowRight /></Link>
                <Link href={linksConta(d.codigo).entrar} className="lp-btn lp-btn-contorno w-full !py-3">Já tenho conta</Link>
              </div>
              <p className="text-center text-xs text-texto-2">
                Você pode abrir {limite} {limite === 1 ? "imóvel" : "imóveis"} sem conta neste aparelho{vistos ? ` (${Math.min(vistos, limite)} já aberto${Math.min(vistos, limite) === 1 ? "" : "s"})` : ""}.
              </p>
            </aside>
          </div>
        </Conteudo>
      )}
    </Moldura>
  );
}
