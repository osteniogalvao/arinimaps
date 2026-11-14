import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { sessaoCrm, detalhePrivado, listarPrivados, configuracaoPrivada } from "@/lib/crm-privado-servidor";
import { ETAPAS_CRM_PRIVADO as ETAPAS, UUID_CRM, paginaCrm } from "@/lib/crm-privado";
import FormularioCrm, { ProfissaoCrm } from "./FormularioCrm";

const botao = "inline-flex min-h-10 items-center rounded-xl border border-linha px-3 py-2 font-medium hover:border-verde";
const data = (v: string) => v.slice(0,10).split("-").reverse().join("/");
const hora = (v: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(v));

function Paginador({ pagina, mais, id }: { pagina: number; mais: boolean; id?: string }) {
  const url = (n: number) => "/painel/crm?" + new URLSearchParams({ ...(id ? { id } : {}), pagina: String(n) });
  if (pagina === 1 && !mais) return null;
  return <nav className="mt-4 flex flex-wrap items-center gap-3" aria-label={id ? "Páginas do histórico" : "Páginas de atendimentos"}>
    {pagina > 1 && <Link href={url(pagina-1)} className={botao}>Anterior</Link>}
    <span>Página {pagina}</span>{mais && <Link href={url(pagina+1)} className={botao}>Próxima</Link>}
  </nav>;
}
export default async function MeuCrm({ searchParams }: PageProps<"/painel/crm">) {
  const s = await sessaoCrm();
  if (s.status === 401) redirect("/entrar?volta=/painel/crm");
  if (s.status === 403) return <section><h1 className="text-2xl font-semibold">Meu CRM</h1>
    <p className="my-3">Confira se o seu plano de corretor ou profissional técnico inclui o CRM privado e se sua sessão está verificada.</p>
    <Link className={botao} href="/planos">Consultar planos</Link></section>;
  if (s.status !== 200) return <p role="alert">O CRM está indisponível no momento. Tente novamente em instantes.</p>;
  const p = await searchParams;
  const id = typeof p.id === "string" ? p.id : null;
  const pagina = paginaCrm(typeof p.pagina === "string" ? p.pagina : null);
  if (id) {
    if (!UUID_CRM.test(id)) notFound();
    const [detalhe,config] = await Promise.all([detalhePrivado(s.banco, s.titular, id, pagina),configuracaoPrivada(s.banco)]);
    if (!detalhe) notFound();
    const a = detalhe.atendimento, c = a.contato;
    return <section className="space-y-6">
      <Link href="/painel/crm" className={botao}>← Todos os atendimentos</Link>
      <div><p className="text-sm text-texto-3">Atendimento · {ETAPAS[a.etapa]}</p><h1 className="mt-1 break-words text-3xl font-semibold">{a.assunto}</h1>
        <p className="mt-2 break-words">{c.nome}{c.telefone && <> · {c.telefone}</>}{c.email && <> · {c.email}</>}</p>
        <p className="text-sm text-texto-3">{a.proximo_retorno ? "Próximo retorno: " + data(a.proximo_retorno) : "Sem retorno agendado"}</p></div>
      {detalhe.servico && <section className="rounded-lg border border-linha p-4">
        <h2 className="font-semibold">{detalhe.servico.categoria_nome} · {detalhe.servico.modelo_nome}</h2>
        <dl className="mt-2 space-y-1">{Object.entries(detalhe.servico.campos).map(([k,campo]) => <div key={k} className="break-words"><dt className="inline text-texto-3">{campo.nome}: </dt>
          <dd className="inline">{campo.tipo === "data" ? data(campo.valor) : campo.valor}</dd></div>)}</dl></section>}
      <FormularioCrm key={a.id + "-" + a.versao} atendimento={a} />
      <section><h2 className="text-xl font-semibold">Histórico</h2><ol className="mt-3 divide-y divide-linha">
        {detalhe.eventos.map(e => <li key={e.versao} className="py-3"><p className="font-medium">{e.etapa_anterior ? ETAPAS[e.etapa_anterior] + " → " + ETAPAS[e.etapa] : "Aberto em triagem"}</p>
          <p className="text-sm text-texto-3">{hora(e.criado_em)} · {e.proximo_retorno ? "Retorno: " + data(e.proximo_retorno) : "Sem retorno agendado"}</p>
          {!e.etapa_anterior && detalhe.servico && <p className="text-sm">Serviço na abertura: {detalhe.servico.categoria_nome} ({detalhe.servico.modelo_nome})</p>}
          {e.nota && <p className="mt-1 whitespace-pre-wrap break-words">{e.nota}</p>}</li>)}</ol><Paginador id={id} pagina={pagina} mais={detalhe.temMais} /></section>
      <details className="rounded-xl border border-linha p-4"><summary className="cursor-pointer font-medium">Abrir outro atendimento para este contato</summary>
        <FormularioCrm key={config?.profissao} contato={c} config={config} /></details>
    </section>;
  }
  const [lista,config] = await Promise.all([listarPrivados(s.banco, s.titular, pagina),configuracaoPrivada(s.banco)]);
  return <section className="space-y-6"><div><h1 className="text-3xl font-semibold">Meu CRM</h1>
    <p className="mt-2 text-texto-3">Sua carteira particular de contatos e atendimentos. Somente você vê os registros deste espaço.</p></div>
    {config && <ProfissaoCrm config={config} />}
    <details className="rounded-xl border border-linha p-4" open={!lista.itens.length && pagina === 1}>
      <summary className="cursor-pointer font-medium">Novo contato e atendimento</summary><FormularioCrm key={config?.profissao} config={config} /></details>
    <section><h2 className="text-xl font-semibold">Atendimentos recentes</h2>
      {!lista.itens.length ? <p className="mt-3 text-texto-3">{pagina === 1 ? "Cadastre seu primeiro contato acima para iniciar a triagem." : "Nenhum atendimento nesta página."}</p>
        : <ul className="mt-3 divide-y divide-linha">{lista.itens.map(a => <li key={a.id}>
          <Link href={"/painel/crm?id=" + a.id} className="block rounded-lg px-2 py-3 hover:bg-verde/5">
            <span className="block break-words font-semibold">{a.assunto}</span><span className="text-sm text-texto-3">{a.contato.nome} · {ETAPAS[a.etapa]}
              {a.proximo_retorno && <> · Retorno: {data(a.proximo_retorno)}</>}</span></Link></li>)}</ul>}
      <Paginador pagina={pagina} mais={lista.temMais} /></section></section>;
}
