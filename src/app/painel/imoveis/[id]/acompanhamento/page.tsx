import Link from "next/link";
import {
  CalendarCheck2, CalendarClock, CalendarX2, Check, Compass, FolderLock, HandCoins, Megaphone, MessageCircle, Sparkles,
  ThumbsDown, ThumbsUp, UserRoundCheck, Users, type LucideIcon,
} from "lucide-react";
import { exigirAnunciante } from "@/lib/imovel/anunciante";
import { carregarAcompanhamento, lembretesDoImovel } from "@/lib/acompanhamento/servidor";
import { PROPOSTA_STATUS_LABEL, dataBR, dataHoraBR, linkWhatsApp } from "@/lib/acompanhamento/textos";
import { PROBABILIDADE_LABEL, VALOR_PERCEBIDO_LABEL, placarDasVisitas } from "@/lib/visitas";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Estatistica, Etiqueta } from "@/components/ui/Pagina";
import { formatBRL } from "@/lib/format";
import FerramentasImovel from "@/components/acompanhamento/FerramentasImovel";
import ChecklistDivulgar from "@/components/acompanhamento/ChecklistDivulgar";
import Lembretes from "./Lembretes";

const ICONE_VISITA: Record<string, LucideIcon> = {
  agendada: CalendarClock, realizada: CalendarCheck2, cancelada: CalendarX2, nao_compareceu: CalendarX2, remarcada: CalendarClock,
};
const TOM_PROPOSTA: Record<string, "verde" | "ouro" | "critico" | "neutro"> = {
  enviada: "ouro", aceita: "verde", contraproposta: "neutro", recusada: "critico",
};
const ETAPAS: [titulo: string, texto: string][] = [
  ["Cadastro recebido", "Dados e termo conferidos"], ["Análise do território", "Conferência da ARINI"],
  ["Publicado", "No ar na ARINI"], ["Em negociação", "Proposta em andamento"], ["Vendido", "Você é avisado na hora"],
];
const ETAPA_DO_STATUS: Record<string, number> = {
  rascunho: 0, pendente: 1, em_analise: 1, correcao: 1, aprovado: 2, publicado: 3, em_negociacao: 4, vendido: 5,
};
const COFRE: Record<"rural" | "urbano", string[]> = {
  rural: ["Matrícula do imóvel", "CAR (Cadastro Ambiental Rural)", "CCIR", "ITR", "Certidões"],
  urbano: ["Matrícula", "IPTU", "Certidões", "Quitação do condomínio", "Habite-se", "Planta aprovada", "Contrato de locação"],
};
const CHECKLIST: Record<"rural" | "urbano", string[]> = {
  rural: ["Roçar a frente e o acesso", "Marcar as divisas", "Arrumar cercas e porteiras", "Separar a matrícula, o CAR e o CCIR"],
  urbano: ["Roçar o terreno ou arrumar o jardim", "Marcar as divisas do lote", "Deixar os ambientes claros e arejados", "Separar a matrícula, o IPTU e o habite-se"],
};
const EM_BREVE_URBANO = ["Lote no mapa da cidade", "Simulador de desmembramento", "Alerta de procura", "Tour 3D", "Lembrete de reajuste de aluguel", "Termômetro do bairro", "Placa com QR code"];

const diasAte = (fim: Date) => Math.max(0, Math.ceil((+fim - Date.now()) / 86_400_000));

/**
 * Painel do anunciante (item 28 e modelos do Carlos de 25/11/2026): uma página de
 * rolagem contínua com a barra de atalhos no topo. A mesma base serve ao imóvel
 * rural e ao urbano; as ferramentas, o cofre e o "em breve" mudam com o tipo.
 * O comprador nunca é identificado: o proprietário vê "Interessado 1, 2...".
 */
export default async function Acompanhamento({ params }: PageProps<"/painel/imoveis/[id]/acompanhamento">) {
  const { id } = await params;
  const { ator, imovel } = await exigirAnunciante(id);
  const admin = supabaseAdmin();
  const [ac, lembretes, { data: dados }, { data: termo }] = await Promise.all([
    carregarAcompanhamento(id),
    lembretesDoImovel(id, ator.userId),
    admin.from("properties").select("valor, area_declarada").eq("id", id).maybeSingle(),
    admin.from("property_documents").select("exclusividade_assinada_em, exclusividade_meses")
      .eq("property_id", id).eq("tipo", "autorizacao").is("substituido_por", null).not("exclusividade_assinada_em", "is", null)
      .order("exclusividade_assinada_em", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const tipo = imovel.tipo === "urbano" ? "urbano" : "rural";

  const contato = (texto: string) => ac.intermediador.tipo !== "proprietario" ? linkWhatsApp(ac.intermediador.telefone, texto) : null;
  const ref = `o imóvel ${imovel.codigo} (${imovel.titulo})`;
  const whats = contato(`Olá! Sou o proprietário d${ref}. Gostaria de saber como está o atendimento dos interessados.`);
  const perguntas = [
    ["Quero saber mais sobre o interessado", `Olá! Sou o proprietário d${ref}. Quero saber mais sobre o interessado da última visita.`],
    ["Dá para remarcar uma visita?", `Olá! Sou o proprietário d${ref}. Dá para remarcar uma visita?`],
    ["O que posso melhorar no imóvel?", `Olá! Sou o proprietário d${ref}. Pelas visitas, o que posso melhorar no imóvel?`],
  ].flatMap(([rotulo, texto]) => { const href = contato(texto); return href ? [{ rotulo, href }] : []; });

  // termo de exclusividade conferido pela Central (0128)
  const vigencia = termo?.exclusividade_assinada_em && termo.exclusividade_meses ? (() => {
    const inicio = new Date(termo.exclusividade_assinada_em + "T12:00:00");
    const fim = new Date(inicio); fim.setMonth(fim.getMonth() + Number(termo.exclusividade_meses));
    return { inicio, fim, dias: diasAte(fim) };
  })() : null;
  const etapa = ETAPA_DO_STATUS[imovel.status] ?? 0;
  const propostaNova = ac.propostas.find((p) => p.lado !== "vendedor" && p.status === "enviada");
  const ultimo = ac.relatorios[0];
  const placar = placarDasVisitas(ac.relatorios);
  const atalhos: [string, string][] = [["inicio", "Início"], ...(propostaNova ? [["proposta", "Proposta"] as [string, string]] : []),
    ["visitas", "Visitas"], ["placar", "Placar"], ["corretor", "Corretor"], ["ferramentas", "Ferramentas"], ["cofre", "Cofre"], ["divulgar", "Divulgar"]];

  return (
    <div className="max-w-5xl space-y-8">
      <nav aria-label="Atalhos do painel" className="sticky top-16 z-20 -mx-1 overflow-x-auto rounded-2xl border border-linha bg-superficie/95 px-1 py-1 backdrop-blur [scrollbar-width:none]">
        <ul className="flex gap-1">{atalhos.map(([ancora, rotulo]) => <li key={ancora}>
          <a href={"#" + ancora} className="block whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold text-texto-2 hover:bg-verde/10 hover:text-verde">{rotulo}</a>
        </li>)}</ul>
      </nav>

      <section id="inicio" className="scroll-mt-32 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Etiqueta tom="verde">Imóvel {tipo}</Etiqueta>
          {vigencia && vigencia.dias > 0 && <Etiqueta tom="ouro">Exclusividade ativa</Etiqueta>}
          {dados?.valor != null && <span className="text-sm text-texto-2">Valor pedido <strong className="text-texto">{formatBRL(dados.valor)}</strong> · comissão 1,9%</span>}
        </div>
        <p className="max-w-3xl text-texto-2">Seu imóvel está sendo acompanhado pela ARINI. Aqui você vê o que aconteceu, o que vem pela frente e o que
          está guardado para você, sem precisar perguntar.</p>
        {vigencia && <div className="cartao grid gap-1 p-5 sm:grid-cols-3">
          <p><span className="lp-eyebrow block !text-[0.68rem]">Termo de exclusividade</span>Assinado em {dataBR(vigencia.inicio)}</p>
          <p><span className="lp-eyebrow block !text-[0.68rem]">Vigência até</span>{dataBR(vigencia.fim)}</p>
          <p><span className="lp-eyebrow block !text-[0.68rem]">Dias restantes</span>{vigencia.dias}</p>
        </div>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Estatistica icone={Users} valor={ac.oportunidadesAbertas} rotulo="Interessados em atendimento" />
          <Estatistica icone={CalendarClock} valor={ac.visitas.agendadas} rotulo="Visitas agendadas" urgente={ac.visitas.agendadas > 0} />
          <Estatistica icone={CalendarCheck2} valor={ac.visitas.realizadas} rotulo="Visitas realizadas" />
          <Estatistica icone={HandCoins} valor={ac.propostas.filter((p) => p.lado !== "vendedor").length} rotulo="Propostas recebidas" urgente={!!propostaNova} />
        </div>
        <div className="cartao p-5 md:p-6">
          <h2 className="lp-display text-xl text-texto">Andamento do seu imóvel</h2>
          <p className="text-sm text-texto-2">Você sempre sabe em que etapa está.</p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-5">{ETAPAS.map(([t, d], i) => {
            const feito = i < etapa || imovel.status === "vendido", atual = i === etapa && imovel.status !== "vendido";
            return <li key={t} className="flex gap-3 sm:flex-col">
              <span className={"grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold " + (feito ? "bg-verde text-fundo" : atual ? "bg-ouro text-[#124431]" : "border border-linha text-texto-2")}>
                {feito ? <Check className="size-4" /> : i + 1}</span>
              <span><span className={"block font-semibold " + (feito || atual ? "text-texto" : "text-texto-2")}>{t}</span>
                <span className="text-sm text-texto-2">{atual ? "Etapa atual" : d}</span></span>
            </li>;
          })}</ol>
        </div>
      </section>

      {propostaNova && <section id="proposta" className="scroll-mt-32 rounded-2xl border-2 border-ouro bg-ouro/10 p-5 md:p-6">
        <p className="lp-eyebrow !text-[0.7rem]">Proposta recebida</p>
        <h2 className="lp-display mt-1 text-2xl text-texto">Um interessado fez uma oferta</h2>
        <p className="mt-2 text-texto">Valor, forma de pagamento e prazo estão no resumo abaixo. Quem conduz a conversa com você é a ARINI: a equipe precisa
          falar com você para tratar esta proposta. O aviso também vai para o seu WhatsApp confirmado.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href="#propostas" className="btn-verde inline-flex items-center gap-2 px-5 py-2.5 text-sm"><HandCoins className="size-4" /> Ver proposta</a>
          {whats && <a href={contato(`Olá! Sou o proprietário d${ref}. Recebi o aviso de proposta e quero conversar.`) ?? whats} target="_blank" rel="noopener noreferrer"
            className="btn-contorno inline-flex items-center gap-2 px-5 py-2.5 text-sm"><MessageCircle className="size-4" /> Falar com minha equipe</a>}
        </div>
      </section>}

      <section id="visitas" className="scroll-mt-32 space-y-4">
        <h2 className="lp-display text-2xl text-texto">Visitas e atividade</h2>
        {ultimo && <article className="cartao space-y-4 p-5 md:p-6">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="lp-display text-xl text-texto">Como foi a última visita</h3>
            <p className="text-sm text-texto-2">{ultimo.interessado} · {dataHoraBR(ultimo.quando)}</p>
          </header>
          <div className="grid gap-4 md:grid-cols-2">
            <div><p className="flex items-center gap-1.5 text-sm font-bold text-verde"><ThumbsUp className="size-4" /> O que chamou atenção</p>
              <p className="mt-1 text-texto">{[...(ultimo.relatorio.atrai ?? []), ultimo.relatorio.pontos_positivos].filter(Boolean).join(" · ") || "Não registrado."}</p></div>
            <div><p className="flex items-center gap-1.5 text-sm font-bold text-alerta"><ThumbsDown className="size-4" /> O que não chamou atenção</p>
              <p className="mt-1 text-texto">{[...(ultimo.relatorio.pesa ?? []), ultimo.relatorio.objecoes].filter(Boolean).join(" · ") || "Não registrado."}</p></div>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-texto-2">Nível de interesse</dt><dd className="font-semibold text-texto">{ultimo.relatorio.interesse} de 5 · chance {PROBABILIDADE_LABEL[ultimo.relatorio.probabilidade]?.toLowerCase()}</dd></div>
            <div><dt className="text-texto-2">Como o valor pedido foi recebido</dt><dd className="font-semibold text-texto">{VALOR_PERCEBIDO_LABEL[ultimo.relatorio.valor_percebido]}</dd></div>
            <div><dt className="text-texto-2">Próximo passo</dt><dd className="font-semibold text-texto">{ultimo.relatorio.proximo_passo}</dd></div>
          </dl>
          {ultimo.relatorio.resumo_proprietario && <p className="rounded-xl bg-superficie-2 px-4 py-3 text-texto">{ultimo.relatorio.resumo_proprietario}</p>}
        </article>}
        {ac.linha.length === 0 ? (
          <p className="cartao p-6 text-base text-texto-2">
            Nenhuma visita ou proposta ainda. Quando uma visita for agendada, você recebe o aviso por e-mail e no WhatsApp confirmado, e ela aparece aqui.
          </p>
        ) : (
          <ol className="cartao divide-y divide-linha !p-0">
            {ac.linha.map((e) => {
              const Icone = e.tipo === "proposta" ? HandCoins : ICONE_VISITA[e.status] ?? CalendarClock;
              return (
                <li key={e.id} className="flex gap-4 px-5 py-4">
                  <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${e.status === "cancelada" || e.status === "nao_compareceu" ? "bg-superficie-2 text-texto-2" : "bg-verde/10 text-verde"}`}>
                    <Icone className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="font-semibold text-texto">{e.titulo}</p>
                      <p className="text-sm tabular-nums text-texto-2">{dataHoraBR(e.quando)}</p>
                    </div>
                    <p className="text-sm text-texto-2">{e.interessado}</p>
                    {e.tipo === "proposta" ? (
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-base text-texto">
                        {e.detalhe}
                        <Etiqueta tom={TOM_PROPOSTA[e.status] ?? "neutro"}>{PROPOSTA_STATUS_LABEL[e.status] ?? e.status}</Etiqueta>
                      </p>
                    ) : e.detalhe ? (
                      <p className="mt-2 rounded-xl bg-superficie-2 px-4 py-3 text-[0.95rem] leading-relaxed text-texto-3">
                        <span className="font-semibold text-texto">Relatório da visita: </span>{e.detalhe}
                      </p>
                    ) : e.status === "realizada" ? (
                      <p className="mt-1.5 text-sm text-texto-2">Relatório ainda não registrado pelo corretor.</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section id="placar" className="scroll-mt-32 cartao space-y-5 p-5 md:p-7">
        <div>
          <p className="lp-eyebrow !text-[0.7rem]">Placar das visitas</p>
          <h2 className="lp-display mt-1 text-2xl text-texto">O que as visitas estão dizendo</h2>
          <p className="mt-1 text-texto-2">Cada relatório entra no placar automaticamente. Quanto mais visitas, mais confiável o retrato do que ajuda e do que
            atrapalha a venda.</p>
        </div>
        {placar.total === 0 ? <p className="text-texto-2">O placar começa depois do primeiro relatório de visita.</p> : <>
          <p className="text-sm"><strong>Base de visitas: {placar.total} de 10.</strong>{" "}
            {placar.total < 10 ? "Leitura parcial. Com 10 visitas fica mais segura." : "Base suficiente para uma boa leitura."}</p>
          <div className="grid gap-6 md:grid-cols-2">
            {([["O que mais atrai", placar.atrai, "bg-verde"], ["O que mais pesa contra", placar.pesa, "bg-alerta"]] as const).map(([titulo, itens, cor]) =>
              <div key={titulo}>
                <p className="font-bold text-texto">{titulo}</p>
                <p className="text-xs text-texto-2">Em quantas das {placar.total} visitas foi citado</p>
                {itens.length ? <ul className="mt-3 space-y-2">{itens.map(([nome, n]) => <li key={nome}>
                  <div className="flex justify-between text-sm"><span>{nome}</span><span className="tabular-nums text-texto-2">{n} de {placar.total}</span></div>
                  <span className="mt-1 block h-2 overflow-hidden rounded-full bg-superficie-2"><span className={"block h-full " + cor} style={{ width: (n / placar.total) * 100 + "%" }} /></span>
                </li>)}</ul> : <p className="mt-3 text-sm text-texto-2">Nada marcado ainda.</p>}
              </div>)}
          </div>
          <div>
            <p className="font-bold text-texto">Interesse em cada visita</p>
            <p className="text-xs text-texto-2">Nota de 1 a 5, da mais antiga à mais recente</p>
            <div className="mt-3 flex h-28 items-end gap-2" role="img" aria-label={"Notas: " + placar.notas.join(", ")}>
              {placar.notas.map((n, i) => <div key={i} className="flex w-10 flex-col items-center gap-1">
                <span className="text-xs font-semibold">{n}</span>
                <span className="block w-full rounded-t-md bg-verde" style={{ height: n * 16 + "px" }} />
                <span className="text-[0.7rem] text-texto-2">V{i + 1}</span>
              </div>)}
            </div>
          </div>
        </>}
      </section>

      <section id="corretor" className="scroll-mt-32 cartao p-5 md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><UserRoundCheck className="size-5" /></span>
            <div>
              <p className="lp-eyebrow text-xs">Quem acompanha as visitas</p>
              <p className="lp-display mt-1.5 text-xl text-texto">{ac.intermediador.nome}</p>
              <p className="mt-1 text-sm text-texto-2">
                {ac.intermediador.tipo === "parceiro" ? "Corretor parceiro da ARINI"
                  : ac.intermediador.tipo === "arini" ? "Equipe comercial da ARINI"
                  : ac.intermediador.tipo === "proprietario" ? "A ARINI encaminhou o interessado diretamente a você"
                  : "Ainda não há interessado em atendimento. A Central ARINI acompanha o anúncio."}
              </p>
            </div>
          </div>
          {whats && <a href={whats} target="_blank" rel="noopener noreferrer" className="btn-verde inline-flex shrink-0 items-center justify-center gap-2 px-5 py-2.5 text-sm">
            <MessageCircle className="size-4" /> Conversar no WhatsApp</a>}
        </div>
        {perguntas.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{perguntas.map((p) =>
          <a key={p.rotulo} href={p.href} target="_blank" rel="noopener noreferrer" className="rounded-full border border-linha px-3 py-1.5 text-sm text-texto hover:border-verde">{p.rotulo}</a>)}
        </div>}
        {whats && <p className="mt-3 text-sm text-texto-2">A mensagem já vai escrita. Você revisa e envia pelo seu WhatsApp.</p>}
        <div className="mt-6 flex items-start gap-4 border-t border-linha pt-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><Compass className="size-5" /></span>
          <div className="min-w-0">
            <h3 className="font-bold text-texto">Próximos passos</h3>
            {ac.proximosPassos ? <>
              <p className="mt-1 whitespace-pre-line text-texto">{ac.proximosPassos.texto}</p>
              <p className="mt-1 text-sm text-texto-2">Atualizado em {dataBR(ac.proximosPassos.atualizadoEm)}.</p>
            </> : <p className="mt-1 text-texto-2">O corretor registra aqui o que vem a seguir. Você recebe o aviso a cada atualização.</p>}
          </div>
        </div>
      </section>

      {ac.propostas.length > 0 && (
        <section id="propostas" className="scroll-mt-32 space-y-4">
          <h2 className="lp-display text-2xl text-texto">Propostas recebidas</h2>
          <p className="text-base text-texto-2">Resumo das rodadas. Os dados do comprador ficam com o corretor.</p>
          <div className="cartao overflow-x-auto !p-0">
            <table className="w-full min-w-[34rem] text-left text-[0.95rem]">
              <thead className="text-xs uppercase tracking-[0.12em] text-texto-2">
                <tr className="border-b border-linha">
                  <th className="px-5 py-3 font-semibold">Interessado</th>
                  <th className="px-5 py-3 font-semibold">Rodada</th>
                  <th className="px-5 py-3 font-semibold">Valor</th>
                  <th className="px-5 py-3 font-semibold">Situação</th>
                  <th className="px-5 py-3 font-semibold">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linha">
                {ac.propostas.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3 text-texto">{p.interessado}</td>
                    <td className="px-5 py-3 text-texto-2">{p.rodada}{p.lado === "vendedor" ? " (contraproposta)" : ""}</td>
                    <td className="px-5 py-3 font-semibold tabular-nums text-texto">{formatBRL(p.valor)}</td>
                    <td className="px-5 py-3"><Etiqueta tom={TOM_PROPOSTA[p.status] ?? "neutro"}>{PROPOSTA_STATUS_LABEL[p.status] ?? p.status}</Etiqueta></td>
                    <td className="px-5 py-3 tabular-nums text-texto-2">{dataBR(p.quando)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section id="ferramentas" className="scroll-mt-32 space-y-4">
        <div>
          <p className="lp-eyebrow !text-[0.7rem]">{tipo === "rural" ? "Ferramentas da fazenda" : "Calculadoras do imóvel"}</p>
          <h2 className="lp-display mt-1 text-2xl text-texto">Seu dia a dia, sem sair da ARINI</h2>
        </div>
        <FerramentasImovel tipo={tipo} valorPedido={dados?.valor != null ? Number(dados.valor) : null} />
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={`/painel/imoveis/${id}/minha-area`} className="btn-contorno px-4 py-2">{tipo === "rural" ? "Mapa, medidas e Raio-X da área" : "Meu imóvel no mapa e medidas"}</Link>
          <Link href="/mercado" className="btn-contorno px-4 py-2">{tipo === "rural" ? "Cotações do boi gordo e dos grãos" : "Juros e mercado"}</Link>
        </div>
        <p className="text-sm text-texto-2">No WhatsApp da ARINI, mande <strong>MENU</strong> para ver as opções: cotações, consulta pela localização e avisos do seu imóvel.</p>
      </section>

      <section id="cofre" className="scroll-mt-32 cartao space-y-4 p-5 md:p-7">
        <header className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><FolderLock className="size-5" /></span>
          <div><h2 className="lp-display text-2xl text-texto">{tipo === "rural" ? "Cofre da propriedade" : "Cofre do imóvel"}</h2>
            <p className="text-texto-2">Guarde uma vez, encontre sempre. Cadastre a data de vencimento em Lembretes e a ARINI avisa antes de vencer.</p></div>
        </header>
        <ul className="flex flex-wrap gap-2">{COFRE[tipo].map((d) => <li key={d} className="rounded-full bg-superficie-2 px-3 py-1.5 text-sm">{d}</li>)}</ul>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={`/painel/imoveis/${id}`} className="btn-verde px-4 py-2">Guardar documento</Link>
          <Link href="/painel/cofre" className="btn-contorno px-4 py-2">Abrir o cofre</Link>
        </div>
      </section>

      <section id="divulgar" className="scroll-mt-32 cartao space-y-4 p-5 md:p-7">
        <header className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><Megaphone className="size-5" /></span>
          <div><h2 className="lp-display text-2xl text-texto">Divulgar meu imóvel</h2>
            <p className="text-texto-2">Compartilhe o anúncio com a sua rede e prepare o imóvel para as visitas.</p></div>
        </header>
        {["publicado", "em_negociacao"].includes(imovel.status) && <a href={`/imovel/${imovel.codigo}`} target="_blank" rel="noopener noreferrer" className="inline-flex font-semibold text-verde underline">
          Abrir o anúncio para compartilhar</a>}
        <ChecklistDivulgar chave={imovel.id} itens={CHECKLIST[tipo]} />
      </section>

      {tipo === "urbano" && <section className="cartao p-5 md:p-7">
        <p className="flex items-center gap-2 font-bold text-texto"><Sparkles className="size-4 text-ouro" /> Em breve no imóvel urbano</p>
        <ul className="mt-3 flex flex-wrap gap-2">{EM_BREVE_URBANO.map((t) => <li key={t} className="rounded-full border border-dashed border-linha px-3 py-1.5 text-sm text-texto-2">{t}</li>)}</ul>
      </section>}

      {/* lembretes: escondidos enquanto a migration 0060 não estiver aplicada */}
      {lembretes && <Lembretes propertyId={id} lembretes={lembretes} />}
    </div>
  );
}
