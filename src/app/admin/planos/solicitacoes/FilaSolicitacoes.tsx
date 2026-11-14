"use client";

import { useEffect, useState } from "react";
import { SITUACOES_PEDIDO, type PedidoCentral, type SituacaoPedido } from "@/lib/solicitacoes-planos";

const endpoint = "/api/admin/planos/solicitacoes";
const proximos: Record<SituacaoPedido, Partial<Record<SituacaoPedido, string>>> = {
  pendente: { em_analise: "Iniciar análise", cancelado: "Cancelar pedido" },
  em_analise: { concluido: "Concluir atendimento", cancelado: "Cancelar pedido" },
  cancelado: {}, concluido: {},
};
const dataBR = (v: string) => new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dinheiro = (v: number | null) => v === null ? "Sob orçamento" : moeda.format(v / 100);

export default function FilaSolicitacoes() {
  const [filtro, setFiltro] = useState("pendente");
  const [pagina, setPagina] = useState(1);
  const [versao, setVersao] = useState(0);
  const [resultado, setResultado] = useState<{ solicitacoes: PedidoCentral[]; temMais: boolean } | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const params = new URLSearchParams({ pagina: String(pagina) });
    if (filtro) params.set("status", filtro);
    (async () => {
      try {
        const r = await fetch(endpoint + "?" + params, { cache: "no-store", signal: ac.signal });
        const b = await r.json();
        if (!r.ok) throw Error(b.error ?? "Não foi possível consultar os pedidos.");
        if (!ac.signal.aborted) setResultado(b);
      } catch (e) { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : "Falha de conexão."); }
    })();
    return () => ac.abort();
  }, [filtro, pagina, versao]);
  function recarregar() { setResultado(null); setErro(""); setVersao(v => v + 1); }
  async function conceder(id:string, quantidade:number) {
    if (!window.confirm(`Conceder ${quantidade} vaga(s) de propriedade ao titular deste pedido?`)) return;
    setOcupado(id); setErro("");
    try {
      const r = await fetch(endpoint + "/cofre", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
      if (!r.ok) throw Error((await r.json()).error ?? "Falha ao conceder vagas.");
      recarregar();
    } catch(e) { setErro(e instanceof Error ? e.message : "Não foi possível confirmar a concessão."); }
    finally { setOcupado(null); }
  }
  async function mudar(id: string, status: string) {
    if ((status === "cancelado" || status === "concluido") &&
        !window.confirm(status === "cancelado" ? "Cancelar este pedido? O atendimento será encerrado." : "Registrar este atendimento como concluído?")) return;
    setOcupado(id); setErro("");
    try {
      const r = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      if (!r.ok) throw Error((await r.json()).error ?? "Não foi possível registrar a situação.");
      recarregar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha de conexão. Atualize a lista antes de tentar novamente."); }
    finally { setOcupado(null); }
  }
  return <section aria-label="Fila de solicitações" className="space-y-4">
    <div className="flex items-center gap-3 flex-wrap">
      <label htmlFor="situacao-pedido" className="font-semibold">Situação</label>
      <select id="situacao-pedido" value={filtro} className="campo" disabled={!!ocupado} onChange={e => {
        setResultado(null); setErro(""); setPagina(1); setFiltro(e.target.value);
      }}>
        {Object.entries(SITUACOES_PEDIDO).map(([s, n]) => <option key={s} value={s}>{n}</option>)}
        <option value="">Todas</option>
      </select>
      <button type="button" onClick={recarregar} disabled={!!ocupado} className="btn-contorno px-4 py-2">Atualizar</button>
    </div>
    {erro && <p role="alert" className="text-critico">{erro}</p>}
    {!resultado && !erro && <p role="status">Carregando solicitações…</p>}
    {resultado && !resultado.solicitacoes.length && <p>Nenhuma solicitação nesta página.</p>}
    {resultado?.solicitacoes.map(p => <article key={p.id} className="cartao p-5 space-y-3">
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div><h2 className="font-semibold">{p.cotacao.rotulo}</h2>
          <p className="text-sm text-texto-2">{p.perfil?.nome || "Conta sem nome"} · Pedido em {dataBR(p.created_at)}</p>
          <p className="text-sm text-texto-2">{[p.email_contato, p.perfil?.telefone].filter(Boolean).join(" · ") || "Conta " + p.user_id}</p>
        </div><span>{SITUACOES_PEDIDO[p.status]}</span>
      </div>
      <p><strong>Estimativa {p.cotacao.ciclo === "anual" ? "para 12 meses" : "do primeiro mês"}:</strong> {dinheiro(p.cotacao.totalCentavos)}
        {p.cotacao.mensalRecorrenteCentavos !== null && p.cotacao.mensalRecorrenteCentavos !== p.cotacao.totalCentavos &&
          <> · Depois: {dinheiro(p.cotacao.mensalRecorrenteCentavos)}/mês</>}</p>
      {p.cotacao.areaTotalHa !== null && <p>Área: {p.cotacao.areaTotalHa.toLocaleString("pt-BR")} ha</p>}
      {p.cotacao.profissao && <p>Profissão: {p.cotacao.profissao}</p>}
      {!!p.cotacao.itens.length && <ul className="list-disc pl-6 text-sm">{p.cotacao.itens.map(i =>
        <li key={i.id}>{i.quantidade} × {i.nome} · {i.subtotalMensalCentavos === null ? "Sob orçamento" : dinheiro(i.subtotalMensalCentavos) + "/mês"}</li>)}</ul>}
      {p.status === "concluido" && p.cotacao.itens.filter(i => i.id === "propriedade_adicional").map(i =>
        p.vagas_cofre ? <p key={i.id}>Cofre ampliado em {p.vagas_cofre.quantidade} vaga(s).</p> :
        <button key={i.id} type="button" className="btn-contorno px-4 py-2" disabled={!!ocupado}
          onClick={() => conceder(p.id,i.quantidade)}>Conceder {i.quantidade} vaga(s) no cofre</button>)}
      <div className="flex flex-wrap gap-2">{Object.entries(proximos[p.status]).map(([s, n]) =>
        <button key={s} type="button" className="btn-contorno px-4 py-2 text-sm" disabled={!!ocupado}
          onClick={() => mudar(p.id, s)}>{n}</button>)}</div>
    </article>)}
    {(pagina > 1 || resultado?.temMais) && <nav aria-label="Páginas de solicitações" className="flex gap-4 items-center">
      <button type="button" disabled={pagina === 1 || !!ocupado} onClick={() => { setResultado(null); setErro(""); setPagina(v => v - 1); }}>Anterior</button>
      <span>Página {pagina}</span>
      <button type="button" disabled={!resultado?.temMais || !!ocupado} onClick={() => { setResultado(null); setErro(""); setPagina(v => v + 1); }}>Próxima</button>
    </nav>}
  </section>;
}
