import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, BadgeCheck, Building2, Check, CreditCard, Gavel, House, Landmark, Ruler, ScanSearch, Search, Tractor, UserPlus,
} from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { BTN_ACAO } from "@/components/landing/Titulo";
import { CabecalhoPagina, Conteudo, Vazio } from "@/components/ui/Pagina";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { acessoAtual } from "@/lib/planos-servidor";
import { lerConfiguracoes, texto } from "@/lib/settings";
import EscolherPlano from "./EscolherPlano";
import { PLANOS_CATALOGO, type PersonaCatalogoId, type PrecoVigente } from "@/lib/planos-catalogo";
import {
  COTAS, GRUPO_RECURSO_LABEL, NICHO_LABEL, PERIODICIDADE_LABEL, PERSONAS_PLANOS, RECURSOS,
  personaPorId, planosDaPersona, type PersonaPlano, type Plano, type Recurso,
} from "@/lib/planos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Planos",
  description: "Planos do Arini Imóveis Brasil por perfil de uso: consulta básica, consulta profissional, anunciante, parceiro e organização.",
};

const GRUPOS = Object.keys(GRUPO_RECURSO_LABEL) as Recurso["grupo"][];
const CATALOGOS: Record<string, PersonaCatalogoId | undefined> = {
  vender: "proprietario", corretor: "corretor_imobiliaria", produtor: "produtor_rural", tecnico: "profissional_tecnico",
};

const ICONE_PERSONA: Record<PersonaPlano["icone"], typeof Search> = {
  busca: Search, casa: House, lupa: ScanSearch, trator: Tractor, predio: Building2, martelo: Gavel, regua: Ruler, governo: Landmark,
};

/** Cadastro já no perfil da persona (o /entrar lê ?cadastro=1&papel=…&nicho=…). */
function linkCadastro(persona: PersonaPlano | null) {
  if (!persona?.papel) return "/entrar?cadastro=1";
  const qs = new URLSearchParams({ cadastro: "1", papel: persona.papel, nicho: persona.nichos[0] });
  return `/entrar?${qs}`;
}

/** Texto do preço: zero com periodicidade paga = ainda sem tabela (fala com a Arini). */
function precoDe(p: Plano) {
  if (p.periodicidade === "gratis") return { valor: "Gratuito", nota: "" };
  if (!Number(p.preco_mensal)) return { valor: "Sob consulta", nota: "fale com a Arini" };
  return { valor: Number(p.preco_mensal).toLocaleString("pt-BR", { style:"currency", currency:"BRL" }), nota: PERIODICIDADE_LABEL[p.periodicidade] ?? p.periodicidade };
}

/**
 * Página pública dos planos. O que cada plano libera vem do banco (a Diretoria
 * edita em /admin/planos); o nome e o grupo de cada recurso vêm do registro.
 */
export default async function Planos({ searchParams }: PageProps<"/planos">) {
  const sp = await searchParams;
  const persona = personaPorId(typeof sp.perfil === "string" ? sp.perfil : "vender") ?? PERSONAS_PLANOS[0];
  const catalogo = persona && CATALOGOS[persona.id];
  const [{ data: planosRaw }, user, { acesso }, cfg] = await Promise.all([
    supabaseAdmin().from("plans").select("*").eq("ativo", true).order("ordem").order("id"),
    currentUser(),
    acessoAtual(),
    lerConfiguracoes(),
  ]);
  const todos = (planosRaw ?? []) as (Plano & PrecoVigente)[];
  const precos = todos.filter((p) => PLANOS_CATALOGO.some((c) => c.id === p.id && c.personaId === catalogo))
    .map(({id, preco_mensal, preco_anual_centavos, primeiro_mes_centavos}) => ({id, preco_mensal, preco_anual_centavos, primeiro_mes_centavos}));
  const daPersona = persona ? planosDaPersona(persona, todos) : [];
  const planos = persona ? daPersona : todos;

  const usuario = user
    ? { nome: user.nome || "Conta", papel: user.role === "admin_central" ? "Administrador" : "Usuário" }
    : null;

  return (
    <Moldura usuario={usuario} site>
      <CabecalhoPagina
        variante="faixa"
        eyebrow="Planos e acesso"
        titulo="Planos para o seu perfil"
        subtitulo="Escolha como você usa a ARINI para comparar pacotes, limites e complementos."
        compacta
      >
        {acesso.planNome && (
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-linha-forte bg-superficie px-5 py-3 text-[15px] text-texto">
            <BadgeCheck className="size-5 text-verde" />
            Seu plano atual: <strong>{acesso.planNome}</strong>
            {acesso.nicho && <span className="text-texto-2"> · perfil {NICHO_LABEL[acesso.nicho] ?? acesso.nicho}</span>}
            {acesso.vencido && <span className="text-alerta"> · vencido — vale o acesso básico</span>}
          </p>
        )}
      </CabecalhoPagina>

      {/* personas clicáveis: cada uma abre só os pacotes daquele perfil */}
      <Conteudo className="pt-12 md:pt-16">
        <section id="perfis" aria-labelledby="titulo-perfis" className="scroll-mt-24">
          <h2 id="titulo-perfis" className="lp-display mt-2 text-3xl text-texto md:text-4xl">Qual é o seu perfil?</h2>
          <p className="mt-2 max-w-2xl text-texto-2">Escolha o que mais combina com você e veja os planos pensados para esse objetivo.</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PERSONAS_PLANOS.map((pp) => {
              const Icone = ICONE_PERSONA[pp.icone];
              const ativa = persona?.id === pp.id;
              return (
                <li key={pp.id}>
                  <Link href={`/planos?perfil=${pp.id}#planos`}
                    aria-current={ativa ? "true" : undefined}
                    className={"cartao group flex h-full items-start gap-3.5 p-5 transition hover:-translate-y-0.5 hover:border-verde/50 " +
                      (ativa ? "!border-verde ring-2 ring-verde/30" : "")}>
                    <span className={"grid size-11 shrink-0 place-items-center rounded-full transition " +
                      (ativa ? "bg-verde text-fundo" : "bg-verde/12 text-verde group-hover:bg-verde/20")}>
                      <Icone className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-texto">{pp.nome}</span>
                      <span className="mt-1 block text-sm leading-relaxed text-texto-2">{pp.chamada}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </Conteudo>

      <Conteudo className="space-y-10 py-12 md:py-16">
        <div id="planos" className="flex scroll-mt-24 flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="lp-display mt-2 text-3xl text-texto md:text-4xl">
              {persona ? persona.nome : "Planos de acesso ao sistema"}
            </h2>
          </div>
          <div className="flex flex-wrap gap-3">
            {persona && <Link href="/planos#perfis" className="lp-btn lp-btn-contorno">Escolher outro perfil</Link>}
            {user && <Link href="/planos/solicitacoes" className="lp-btn lp-btn-contorno">Meus pedidos</Link>}
            {!user && (
              <Link href={linkCadastro(persona)} className="lp-btn lp-btn-ouro">
                <UserPlus /> Cadastre-se{persona?.papel ? " neste perfil" : ""}
              </Link>
            )}
          </div>
        </div>
        {catalogo && !precos.length ? <Vazio titulo="As opções deste perfil estão indisponíveis no momento." /> : persona && catalogo ? (
          <EscolherPlano key={persona.id} precos={precos} personaId={catalogo} perfil={persona.id} cadastro={linkCadastro(persona)}
            autenticado={!!user} whatsapp={texto(cfg, "whatsapp_central")} parametros={sp} />
        ) : !planos.length ? (
          <Vazio icone={CreditCard} titulo="A Central prepara as opções deste perfil."
            acao={<Link href={`/suporte?assunto=${encodeURIComponent(persona.nome)}`} className="lp-btn lp-btn-verde">Consultar a Central</Link>} />
        ) : (
          <div className="grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-3">
            {planos.map((p) => {
              const atual = !acesso.equipe && acesso.planId === p.id && !acesso.vencido;
              const preco = precoDe(p);
              const recursos = new Set(p.recursos);
              const cotas = COTAS.filter((c) => p.cotas?.[c.id] != null);
              return (
                <article key={p.id}
                  className={"cartao relative flex flex-col gap-6 p-6 md:p-7 " + (p.destaque ? "!border-[#D9BD6F] ring-1 ring-[#D9BD6F]/60" : "")}>
                  {(p.destaque || atual) && (
                    <div className="absolute -top-3 left-6 flex gap-2">
                      {p.destaque && <span className="rounded-full bg-[#D9BD6F] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#124431]">Mais completo</span>}
                      {atual && <span className="rounded-full bg-verde px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fundo">Seu plano</span>}
                    </div>
                  )}
                  <div className="space-y-2 pt-1">
                    <h2 className="lp-display text-2xl text-texto">{p.nome}</h2>
                    <p className="text-[15px] leading-relaxed text-texto-2">{p.descricao}</p>
                  </div>
                  <div className="border-y border-linha py-5">
                    <p className={"lp-display text-4xl " + (p.destaque ? "text-ouro" : "text-texto")}>{preco.valor}</p>
                    {preco.nota && <p className="mt-1.5 text-sm text-texto-2">{preco.nota}</p>}
                    {p.escopo === "organizacao" && <p className="mt-1 text-sm text-texto-2">Por organização.</p>}
                  </div>

                  <div className="flex-1 space-y-5">
                    {GRUPOS.map((g) => {
                      const itens = RECURSOS.filter((r) => r.grupo === g && recursos.has(r.id));
                      if (!itens.length) return null;
                      return (
                        <div key={g}>
                          <p className="lp-eyebrow mb-3 !text-[0.68rem]">{GRUPO_RECURSO_LABEL[g]}</p>
                          <ul className="space-y-2 text-[15px]">
                            {itens.map((r) => (
                              <li key={r.id} className="flex items-start gap-2.5">
                                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-verde/15 text-verde">
                                  <Check className="size-3.5" strokeWidth={3} />
                                </span>
                                <span className="text-texto">
                                  {r.nome}
                                  {r.reservado && <span className="ml-1.5 text-xs text-texto-2">(em breve)</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                    {cotas.length > 0 && (
                      <div>
                        <p className="lp-eyebrow mb-3 !text-[0.68rem]">Limites</p>
                        <ul className="divide-y divide-linha rounded-xl border border-linha text-[15px]">
                          {cotas.map((c) => (
                            <li key={c.id} className="flex justify-between gap-3 px-4 py-2.5 text-texto-2">
                              <span>{c.nome}</span>
                              <span className="font-semibold tabular-nums text-texto">{p.cotas[c.id]}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {atual ? (
                    <span className="lp-btn lp-btn-contorno w-full cursor-default opacity-70">Plano atual</span>
                  ) : !user && p.periodicidade === "gratis" && p.escopo === "conta" ? (
                    <Link href={linkCadastro(persona)} className="w-full lp-btn lp-btn-verde">
                      Criar conta grátis <ArrowRight />
                    </Link>
                  ) : (
                    <Link href={`/suporte?assunto=${encodeURIComponent(`plano:${p.id}`)}`}
                      className={"w-full " + (p.destaque ? "lp-btn lp-btn-ouro" : BTN_ACAO)}>
                      Falar com a Arini <ArrowRight />
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        )}

      </Conteudo>
    </Moldura>
  );
}
