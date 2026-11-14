"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, Check, MessageCircle, Minus, Plus } from "lucide-react";
import {
  COMPLEMENTOS_CATALOGO, DISPONIBILIDADE_CATALOGO, PLANOS_CATALOGO, PROFISSOES_TECNICAS,
  RECURSOS_CATALOGO, cotarPlano, economiaAnualCentavos, comPrecoVigente, type PrecoVigente,
  type CicloCatalogo, type PersonaCatalogoId, type PlanoCatalogo, type SelecaoCatalogo,
} from "@/lib/planos-catalogo";
import { CAMPO } from "@/components/ui/Pagina";

const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
type Parametros = Record<string, string | string[] | undefined>;
type Props = { personaId: PersonaCatalogoId; perfil: string; autenticado: boolean; cadastro: string; whatsapp: string; parametros: Parametros; precos: PrecoVigente[] };

function recursosDoPacote(plano: PlanoCatalogo) {
  const recursos = new Set(plano.recursos);
  let base = PLANOS_CATALOGO.find((p) => p.id === plano.incluiPlanoId);
  while (base) {
    for (const id of base.recursos) recursos.add(id);
    const anterior = base.incluiPlanoId;
    base = PLANOS_CATALOGO.find((p) => p.id === anterior);
  }
  return [...recursos].map((id) => RECURSOS_CATALOGO[id]);
}

function limitesDoPacote({ limites }: PlanoCatalogo) {
  const itens: string[] = [];
  if (limites.usuarios) itens.push(limites.usuarios === 1 ? "1 usuário" : limites.usuarios + " usuários");
  if (limites.propriedades) itens.push(limites.propriedades + (limites.propriedades === 1 ? " propriedade" : " propriedades"));
  if (limites.areaTotalHa) itens.push("Até " + limites.areaTotalHa.toLocaleString("pt-BR") + " ha somados");
  if (limites.ndviHa) itens.push(limites.ndviHa.toLocaleString("pt-BR") + " ha de NDVI");
  if (limites.imoveisCrm) itens.push(limites.imoveisCrm === "ilimitado" ? "Imóveis sem limite na carteira" : "Até " + limites.imoveisCrm + " imóveis na carteira");
  if (typeof limites.creditosIaMensais === "number" && limites.creditosIaMensais > 0) itens.push(limites.creditosIaMensais + " créditos de IA por mês");
  if (limites.consultasMensais === "uso_justo") itens.push("Consultas com política de uso justo");
  return itens;
}

export default function EscolherPlano({ personaId, perfil, autenticado, cadastro, whatsapp, parametros, precos }: Props) {
  const planos = PLANOS_CATALOGO.filter((p) => p.personaId === personaId).flatMap((p) => {
    const preco = precos.find((v) => v.id === p.id);
    return preco ? [comPrecoVigente(p, preco)] : [];
  });
  const inicial = planos.find((p) => p.id === parametros.pacote) ?? planos[0];
  const [planoId, setPlanoId] = useState(inicial.id);
  const plano = planos.find((p) => p.id === planoId)!;
  const [periodo, setPeriodo] = useState<CicloCatalogo>(parametros.ciclo === "anual" ? "anual" : "mensal");
  const ciclo = plano.anualCentavos === null ? "mensal" : periodo;
  const [qtd, setQtd] = useState<Record<string, number>>(() => {
    const valores: Record<string, number> = {};
    for (const c of COMPLEMENTOS_CATALOGO.filter((x) => x.planos.includes(inicial.id))) {
      const n = Number(parametros["extra_" + c.id]);
      if (Number.isSafeInteger(n) && n > 0 && (c.unidade !== "conta" || n === 1)) valores[c.id] = n;
    }
    return valores;
  });
  const [profissao, setProfissao] = useState(typeof parametros.profissao === "string" ? parametros.profissao.slice(0,150) : "");
  const [area, setArea] = useState(typeof parametros.area === "string" ? parametros.area : "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [protocolo, setProtocolo] = useState("");
  const [ativacao, setAtivacao] = useState("");
  const tentativa = useRef({ selecao: "", chave: "" });
  const complementos = COMPLEMENTOS_CATALOGO.filter((c) => planos.some((p) => c.planos.includes(p.id)) && c.id !== "drone");
  const adicionais = complementos.filter((c) => c.planos.includes(planoId) && qtd[c.id] > 0).map((c) => ({ id: c.id, quantidade: qtd[c.id] }));
  const selecao: SelecaoCatalogo = { planoId, ciclo, adicionais };
  if (plano.exigeProfissao) selecao.profissao = profissao.trim();
  if (personaId === "proprietario" && area) selecao.areaTotalHa = Number(area);
  let cotacao: ReturnType<typeof cotarPlano> | undefined;
  let validacao = "";
  try { cotacao = cotarPlano(selecao, planos); } catch (e) { validacao = e instanceof Error ? e.message : "Confira a seleção."; }

  function escolher(id: typeof planoId) {
    setPlanoId(id);
    setQtd({});
    setErro("");
    setProtocolo("");
    setAtivacao("");
  }
  function alterar(id: string, n: number) {
    setErro("");
    setProtocolo("");
    setQtd((antes) => {
      const novos = { ...antes, [id]: Math.max(0, n) };
      if (n <= 0) {
        for (const c of complementos) {
          if ((c.requerComplementoPorPersona?.[personaId] ?? c.requerComplemento) === id) delete novos[c.id];
        }
      }
      return novos;
    });
  }
  const retorno = new URLSearchParams({ perfil, pacote: planoId, ciclo });
  for (const item of adicionais) retorno.set("extra_" + item.id, String(item.quantidade));
  if (selecao.profissao) retorno.set("profissao", selecao.profissao);
  if (selecao.areaTotalHa) retorno.set("area", String(selecao.areaTotalHa));
  const volta = encodeURIComponent("/planos?" + retorno + "#configuracao");
  const podeAtivar = plano.mensalCentavos === 0 && (plano.teste || plano.id === "proprietario_gratuito")
    && adicionais.length === 0 && cotacao?.totalCentavos === 0;
  async function ativar() {
    setEnviando(true); setErro("");
    try {
      const r = await fetch("/api/planos/teste", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({planoId}) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Falha ao ativar o plano.");
      setAtivacao(d.validoAte ? "Teste ativo até " + new Date(d.validoAte).toLocaleString("pt-BR",{ timeZone:"America/Sao_Paulo" }) + " (Brasília)." : "Cofre gratuito ativo.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha de conexão."); }
    finally { setEnviando(false); }
  }
  async function enviar() {
    if (!cotacao || enviando) return;
    setErro("");
    setEnviando(true);
    const corpo = JSON.stringify(selecao);
    if (tentativa.current.selecao !== corpo) tentativa.current = { selecao: corpo, chave: crypto.randomUUID() };
    try {
      const r = await fetch("/api/planos/solicitacoes", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": tentativa.current.chave }, body: corpo });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Falha ao registrar o pedido.");
      setProtocolo(d.solicitacao.id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha de conexão. Tente novamente."); }
    finally { setEnviando(false); }
  }
  return <div className="space-y-8">
    <fieldset disabled={enviando} className="space-y-5">
      <legend className="sr-only">Período do plano</legend>
      <div className="inline-flex gap-1 rounded-full border border-linha bg-superficie-2 p-1">
        {(["mensal", "anual"] as const).map((valor) => <button type="button" key={valor} aria-pressed={periodo === valor}
          onClick={() => { setPeriodo(valor); setProtocolo(""); setErro(""); }}
          className={"rounded-full px-5 py-2 text-sm font-bold " + (periodo === valor ? "bg-verde text-fundo" : "text-texto-2")}>
          {valor === "mensal" ? "Mensal" : "Anual"}
        </button>)}
      </div>
      <div className={"grid items-start gap-3 sm:grid-cols-2 " + (planos.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
        {planos.map((p) => {
          const anual = periodo === "anual" && p.anualCentavos !== null;
          const preco = anual ? p.anualCentavos! : p.mensalCentavos;
          const economia = economiaAnualCentavos(p);
          return <article key={p.id} className={"cartao space-y-3 p-4 " + (p.id === planoId ? "!border-verde ring-1 ring-verde" : "")}>
            <h3 className="lp-display text-2xl">{p.nome}</h3>
            <p className="text-sm text-texto-2">{p.descricao}</p>
            <p className="text-xl font-bold">{preco === 0 ? "Grátis" : reais(preco)}
              <small className="ml-1 text-sm font-normal">{preco ? (anual ? "/ ano" : "/ mês") : p.teste ? "por " + p.teste.dias + " dias" : ""}</small></p>
            {!anual && p.primeiroMesCentavos && <p className="text-sm font-semibold text-verde">Primeiro mês por {reais(p.primeiroMesCentavos)}</p>}
            {anual && economia != null && economia > 0 && <p className="text-sm text-verde">Economia de {reais(economia)} no primeiro ano</p>}
            <p className="text-sm text-texto-2">{limitesDoPacote(p).join(" · ")}</p>
            <p className="text-xs font-semibold text-texto-2">{DISPONIBILIDADE_CATALOGO[p.disponibilidade]}</p>
            <button type="button" aria-pressed={p.id === planoId} onClick={() => escolher(p.id)}
              className={"lp-btn w-full " + (p.id === planoId ? "lp-btn-verde" : "lp-btn-contorno")}>{p.id === planoId ? <><Check /> Selecionado</> : "Selecionar"}</button>
            <details className="border-t border-linha pt-2 text-sm"><summary className="cursor-pointer font-semibold">Recursos e condições</summary>
              <ul className="my-3 space-y-2">{recursosDoPacote(p).map((r) => <li key={r.nome}>{r.nome} <small className="block text-texto-2">{DISPONIBILIDADE_CATALOGO[r.disponibilidade]}</small></li>)}</ul>
              <p className="text-texto-2">{p.motivoDisponibilidade}</p>
              {p.teste && <p className="mt-2">Após o teste, continua disponível o mapa de imóveis à venda.</p>}
            </details>
          </article>;
        })}
      </div>
    </fieldset>

    <fieldset disabled={enviando} id="configuracao" className="cartao scroll-mt-24 space-y-5 p-5 md:p-7">
      <legend className="sr-only">Configuração e complementos</legend>
      <div><h3 className="lp-display text-2xl">Complementos do plano</h3><p className="mt-1 text-texto-2">Pacote selecionado · {plano.nome}</p></div>
      {plano.exigeProfissao && <label className="block max-w-lg text-sm font-semibold">Profissão do escritório
        <input className={CAMPO + " mt-1"} list="profissoes-arini" maxLength={150} placeholder="Escolha ou digite sua profissão" value={profissao}
          onChange={(e) => { setProfissao(e.target.value); setProtocolo(""); setErro(""); }} />
        <datalist id="profissoes-arini">{PROFISSOES_TECNICAS.map((p) => <option key={p.id} value={p.nome} />)}</datalist>
      </label>}
      {plano.exigeProfissao && PROFISSOES_TECNICAS.find(p => p.nome === profissao)?.modulos.length ? <p className="text-sm text-texto-2">
        Atividades previstas para {profissao.toLowerCase()} · {PROFISSOES_TECNICAS.find(p => p.nome === profissao)?.modulos.join(" · ")}
      </p> : null}
      {personaId === "proprietario" && <label className="block max-w-sm text-sm font-semibold">Área total em hectares (opcional)
        <input type="number" min="0.000001" step="any" className={CAMPO + " mt-1"} value={area}
          onChange={(e) => { setArea(e.target.value); setProtocolo(""); setErro(""); }} /></label>}
      <div className="grid gap-3 md:grid-cols-2">
        {complementos.map((c) => {
          const disponivel = c.planos.includes(planoId);
          const requisito = c.requerComplementoPorPersona?.[personaId] ?? c.requerComplemento;
          const impedido = !!requisito && !qtd[requisito];
          const n = qtd[c.id] || 0;
          const unitario = c.mensalCentavosPorPlano?.[planoId] ?? c.mensalCentavos;
          const opcoes = planos.filter((p) => c.planos.includes(p.id));
          return <div key={c.id} className="rounded-xl border border-linha p-4">
            <p className="font-semibold">{c.nome}</p><p className="mt-1 text-sm text-texto-2">{c.descricao}</p>
            {c.inclui?.numerosWhatsApp && <p className="mt-1 text-sm">1 número · {c.inclui.usuarios} atendentes · {c.inclui.respostasIaMensais} respostas de IA/mês</p>}
            {disponivel ? <>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">{unitario === null ? "Sob orçamento" : reais(unitario) + "/mês por " + (c.quantidadePorUnidade > 1 ? c.quantidadePorUnidade + " " : "") + c.unidade}</span>
                <div className="inline-flex items-center gap-3 rounded-full border border-linha">
                  <button type="button" className="p-2 disabled:opacity-35" aria-label={"Remover " + c.nome} disabled={!n} onClick={() => alterar(c.id,n - 1)}><Minus size={16} /></button>
                  <output aria-label={"Quantidade de " + c.nome}>{n}</output>
                  <button type="button" className="p-2 disabled:opacity-35" aria-label={"Adicionar " + c.nome} disabled={impedido || (c.unidade === "conta" && n === 1)} onClick={() => alterar(c.id,n + 1)}><Plus size={16} /></button>
                </div>
              </div>
              {impedido && <p className="mt-1 text-xs text-texto-2">Selecione primeiro {COMPLEMENTOS_CATALOGO.find((x) => x.id === requisito)?.nome}.</p>}
            </> : <div className="mt-2 text-sm">Disponível nos planos {opcoes.map((p,i) => <span key={p.id}>{i > 0 && " · "}<button type="button" className="font-semibold text-verde underline" onClick={() => escolher(p.id)}>{p.nome}</button></span>)}</div>}
          </div>;
        })}
      </div>
      {personaId === "produtor_rural" && <section><h4 className="font-semibold">Serviços sob orçamento</h4>
        <div className="mt-2 flex flex-wrap gap-3">{["Levantamento com drone", "Análise de agronomia de precisão"].map((nome) => {
          const numero = whatsapp.replace(/\D/g, "");
          const href = numero ? "https://wa.me/" + numero + "?text=" + encodeURIComponent("Olá, gostaria de um orçamento para " + nome.toLowerCase() + ".") : "/suporte?assunto=" + encodeURIComponent(nome);
          return <a key={nome} href={href} target={numero ? "_blank" : undefined} rel="noopener noreferrer" className="lp-btn lp-btn-contorno"><MessageCircle />{nome}</a>;
        })}</div>
      </section>}
      <div className="border-t border-linha pt-4" aria-live="polite">
        {cotacao && <><p className="font-semibold">{cotacao.sobOrcamento ? "Configuração sob orçamento" : ciclo === "anual" ? reais(cotacao.baseCicloCentavos) + " pelo plano anual" : reais(cotacao.primeiraMensalidadeCentavos!) + " no primeiro mês"}</p>
          {!cotacao.sobOrcamento && ciclo === "mensal" && cotacao.mensalRecorrenteCentavos !== cotacao.primeiraMensalidadeCentavos && <p>Depois, {reais(cotacao.mensalRecorrenteCentavos!)}/mês com os complementos.</p>}
          {!cotacao.sobOrcamento && ciclo === "anual" && cotacao.adicionaisMensaisCentavos > 0 && <p>Complementos de {reais(cotacao.adicionaisMensaisCentavos)}/mês. Total estimado em 12 meses de {reais(cotacao.totalCentavos!)}.</p>}</>}
        {validacao && <p>{validacao}</p>}
        <p className="mt-2 text-sm text-texto-2">{podeAtivar ? plano.teste ? "Experimente os recursos disponíveis por 72 horas. Ao terminar o teste, a conta continua sem cobrança." : "O cofre gratuito permite cadastrar até três propriedades." : "A Central confirma a disponibilidade e as condições antes da ativação. O envio deste pedido é gratuito."}</p>
      </div>
      {erro && <p role="alert" className="text-alerta">{erro}</p>}
      {ativacao && podeAtivar ? <p role="status">{ativacao} <Link href={plano.id === "corretor_teste" ? "/painel/crm" : plano.id === "tecnico_teste" ? "/painel/crm/demonstracao" : "/painel/cofre"} className="font-semibold text-verde underline">Abrir recurso</Link></p> :
        protocolo ? <p role="status">Pedido registrado. <Link className="font-semibold text-verde underline" href="/planos/solicitacoes">Acompanhar meus pedidos</Link></p> :
        autenticado && podeAtivar ? <button type="button" className="lp-btn lp-btn-verde" disabled={enviando || !cotacao} onClick={ativar}>{enviando ? "Ativando…" : plano.teste ? "Iniciar teste de 3 dias" : "Ativar cofre gratuito"} <ArrowRight /></button> :
        autenticado ? <button type="button" className="lp-btn lp-btn-verde disabled:opacity-50" disabled={!cotacao || enviando} onClick={enviar}>{enviando ? "Enviando…" : "Solicitar à Central"} <ArrowRight /></button> :
        <div className="flex flex-wrap gap-3"><Link className="lp-btn lp-btn-verde" href={"/entrar?volta=" + volta}>Entrar para solicitar <ArrowRight /></Link>
          <Link className="lp-btn lp-btn-contorno" href={(plano.alcance === "global" ? "/entrar?cadastro=1&papel=consulta&nicho=consulta" : cadastro) + "&volta=" + volta}>Criar conta</Link></div>}
    </fieldset>
  </div>;
}
