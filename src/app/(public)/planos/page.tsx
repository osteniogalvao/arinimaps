import Link from "next/link";
import { chamadaPiloto, situacaoPiloto } from "@/lib/divulgacao";
import type { Metadata } from "next";
import {
  ArrowRight, BadgeCheck, Check, CreditCard, UserPlus,
} from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { BTN_ACAO } from "@/components/landing/Titulo";
import { Conteudo, Vazio } from "@/components/ui/Pagina";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { acessoAtual } from "@/lib/planos-servidor";
import { lerConfiguracoes, texto } from "@/lib/settings";
import EscolherPlano from "./EscolherPlano";
import CabecalhoPlanos, { apresentacaoDoPerfil } from "./CabecalhoPlanos";
import FluxoDoPerfil from "./FluxoDoPerfil";
import OfertasDoPerfil from "./OfertasDoPerfil";
import ModulosDoPerfil from "./ModulosDoPerfil";
import RolarParaPlanos from "./RolarParaPlanos";
import { PERFIS_COM_VITRINE, type OfertaPerfil } from "@/lib/ofertas-perfis";
import { PLANOS_CATALOGO, CATALOGO_POR_ENTRADA, type PrecoVigente } from "@/lib/planos-catalogo";
import {
  COTAS, GRUPO_RECURSO_LABEL, NICHO_LABEL, PERIODICIDADE_LABEL, PERSONAS_PLANOS, RECURSOS,
  personaPorId, planosDaPersona, type PersonaPlano, type Plano, type Recurso,
} from "@/lib/planos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Planos",
  description: "Conheça os perfis de uso da ARINI, os recursos de cada plano e os complementos disponíveis para sua conta ou organização.",
};

const GRUPOS = Object.keys(GRUPO_RECURSO_LABEL) as Recurso["grupo"][];


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
  const apresentacao = apresentacaoDoPerfil(persona);
  const catalogo = persona && CATALOGO_POR_ENTRADA[persona.id];
  const temVitrine = PERFIS_COM_VITRINE.includes(persona.id);
  const [{ data: planosRaw }, user, { acesso }, cfg, vitrine] = await Promise.all([
    supabaseAdmin().from("plans").select("*").eq("ativo", true).order("ordem").order("id"),
    currentUser(),
    acessoAtual(),
    lerConfiguracoes(),
    temVitrine ? supabaseAdmin().from("ofertas_perfis").select("*").eq("perfil", persona.id).eq("ativo", true).order("ordem") : { data: [] },
  ]);
  const acessoLeilao = persona.id==="leiloeiro" && user ? (await supabaseAdmin().rpc("leilao_acesso",{p_ator:user.id})).data : null;
  const piloto = persona.id==="divulgador" ? await situacaoPiloto(user?.id) : null;
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
      <div className="vitrine-pagina">
      <CabecalhoPlanos persona={persona} />
      <RolarParaPlanos key={persona.id} />
      <Conteudo className="vitrine-conteudo space-y-8 py-8 md:py-12">
        {user && acesso.planNome && <p className="flex items-center gap-2 text-sm"><BadgeCheck className="size-5 text-verde" /> Seu plano atual · {acesso.planNome}
          {acesso.nicho && <span> · {NICHO_LABEL[acesso.nicho] ?? acesso.nicho}</span>}{acesso.vencido && " · vencido"}</p>}
        <div id="planos" className="flex scroll-mt-24 flex-wrap items-end justify-between gap-4">
          <div className="vitrine-escolha">
            <h2>{apresentacao.escolha}</h2>
            {apresentacao.resumo && <p>{apresentacao.resumo}</p>}
          </div>
          <div className="flex flex-wrap gap-3">
            {persona && <Link href="#perfis" className="lp-btn lp-btn-contorno">Escolher outro perfil</Link>}
            {user && <Link href="/planos/solicitacoes" className="lp-btn lp-btn-contorno">Meus pedidos</Link>}
            {!user && !temVitrine && !piloto && (
              <Link href={linkCadastro(persona)} className="lp-btn lp-btn-ouro">
                <UserPlus /> Cadastre-se{persona?.papel ? " neste perfil" : ""}
              </Link>
            )}
          </div>
        </div>
        {acessoLeilao && <Link href="/painel/leiloes" className="mb-5 inline-block font-semibold text-verde underline">Abrir meu CRM de leilões</Link>}
        {["instituicao","empresa","tecnico"].includes(persona.id) && <Link href="/balcao" className="mb-5 inline-block font-semibold text-verde underline">Balcão municipal · protocolar e acompanhar um pedido</Link>}
        {persona.id==="comprar" && <Link href="/conta/filtros" className="mb-5 inline-block font-semibold text-verde underline">
          Criar filtro de interesse · até {Number(cfg.filtros_comprador_gratis)} grátis ou {Number(cfg.filtros_comprador_pacote)} com o pacote da Ari</Link>}
        {piloto ? <Link className="lp-btn lp-btn-verde" href="/divulgador">{chamadaPiloto(piloto)} <ArrowRight /></Link> : temVitrine ? <OfertasDoPerfil key={persona.id} ofertas={((vitrine.data ?? []) as OfertaPerfil[]).map((o) => o.id !== "comprar_creditos" ? o : {
          ...o, limites: [String(cfg.ari_pacote_comprados) + " créditos comprados", String(cfg.ari_pacote_cortesia) + " créditos de cortesia",
            "Validade de " + String(cfg.ari_validade_meses) + " meses"], detalhes: ["Pacote sem mensalidade", "Saldo liberado após a confirmação do pagamento."],
        })} autenticado={!!user} /> : catalogo && !precos.length ? <Vazio titulo="As opções deste perfil estão indisponíveis no momento." /> : persona && catalogo ? (
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
        <FluxoDoPerfil perfil={persona.id} />
        <ModulosDoPerfil perfil={persona.id} />
      </Conteudo>
      </div>
    </Moldura>
  );
}
