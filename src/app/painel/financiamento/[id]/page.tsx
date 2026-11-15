import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { lerAtendimento, vagaDaSimulacao } from "@/lib/financiamento-servidor";
import { AVISO_SIMULACAO, estadoLegivel } from "@/lib/financiamento";
import { formatBRL } from "@/lib/format";
import Acoes from "./Acoes";

export default async function Atendimento({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!ehUuid(id)) notFound();
  const a=await ator();
  if(!a) redirect("/entrar?volta=/painel/financiamento/"+id);
  const dados=await lerAtendimento(id,a);
  if(!dados) notFound();
  const {espelho:e,atendimento:t}=dados;
  const vaga=dados.proprio && !t ? await vagaDaSimulacao(id,a.userId) : null;
  return <main className="max-w-4xl space-y-5">
    <Link className="text-verde" href="/painel/financiamento">Voltar aos financiamentos</Link>
    <h1 className="lp-display text-3xl">{e.titulo}</h1>
    <section className="cartao space-y-2 p-5"><h2 className="lp-display text-xl">{e.banco} · {e.linha}</h2>
      <p>{e.codigo} · {e.sistema} · {e.prazo} meses · {e.taxa_nominal_aa}% nominal ao ano</p>
      <p>Preço {formatBRL(e.valor)} · Entrada {formatBRL(e.entrada)} · Financiado {formatBRL(e.financiado)}</p>
      <p>Primeira parcela {formatBRL(e.parcela_inicial)} · Total estimado {formatBRL(e.total)}</p>
      <p className="text-sm">{AVISO_SIMULACAO} Fonte: {e.fonte}.</p>
    </section>
    {t && <section className="cartao space-y-2 p-5"><h2 className="lp-display text-xl">Atendimento</h2>
      <p>{t.revogado_em ? "Compartilhamento revogado" : estadoLegivel(t.estado)}</p>
      <p>{t.consentimento} · {new Date(t.consentido_em).toLocaleString("pt-BR")}</p>
      {!dados.proprio && <><p>{t.nome} · {t.email} {t.telefone}</p>
        {t.renda && <p>Renda declarada {formatBRL(t.renda)}</p>}{t.nascimento && <p>Nascimento {t.nascimento}</p>}
        <p>Prazo do primeiro contato {new Date(t.prazo_contato).toLocaleString("pt-BR")}</p></>}
    </section>}
    <Acoes id={id} proprio={dados.proprio} estado={t?.estado??null} revogado={!!t?.revogado_em}
      documentos={dados.documentos} modelos={dados.modelos} vaga={vaga}/>
    <section className="cartao p-5"><h2 className="lp-display mb-3 text-xl">Histórico</h2>
      <ol className="space-y-2">{dados.eventos.map(ev=><li key={ev.id}><time>{new Date(ev.criado_em).toLocaleString("pt-BR")}</time> · {ev.estado}{ev.nota && " · "+ev.nota}</li>)}</ol>
    </section>
  </main>;
}

