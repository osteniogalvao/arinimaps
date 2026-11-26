import Link from "next/link";
import { ORIGENS, TIPOS_PESSOA, UUID_ESC } from "@/lib/crm-escritorio";
import {
  Avisos, BOTAO, BOTAO_VERDE, BotaoExcluir, CAMPO_P, CabecalhoEscritorio, CampoResponsavel, SemEscritorio, abrirEscritorio, umParam,
  type Parametros,
} from "../comum";
import { salvarPessoa } from "../acoes";

type Pessoa = {
  id: string; tipo: keyof typeof TIPOS_PESSOA; nome: string; telefone: string | null; email: string | null;
  documento: string | null; cidade: string | null; origem: string | null; observacoes: string | null; responsavel: string | null;
};

/** Clientes, proprietários, leads e parceiros do escritório. */
export default async function PessoasEscritorio({ searchParams }: { searchParams: Promise<Parametros> }) {
  const s = await abrirEscritorio();
  if (s.status !== 200) return <SemEscritorio status={s.status} />;
  const sp = await searchParams;
  const tipo = Object.hasOwn(TIPOS_PESSOA, umParam(sp, "tipo")) ? umParam(sp, "tipo") : "";
  const busca = umParam(sp, "q").slice(0, 60);
  const editar = UUID_ESC.test(umParam(sp, "editar")) ? umParam(sp, "editar") : null;
  const volta = "/painel/escritorio/pessoas?" + new URLSearchParams({ ...(tipo ? { tipo } : {}), ...(busca ? { q: busca } : {}) });

  let q = s.banco.from("crm_esc_pessoas").select("id,tipo,nome,telefone,email,documento,cidade,origem,observacoes,responsavel")
    .order("nome").limit(1000);
  if (tipo) q = q.eq("tipo", tipo);
  if (busca) { const b = busca.replace(/[%_,()]/g, " "); q = q.or(`nome.ilike.%${b}%,telefone.ilike.%${b}%,email.ilike.%${b}%`); }
  const [pessoas, contagem] = await Promise.all([q, s.banco.from("crm_esc_pessoas").select("tipo")]);
  const lista = (pessoas.data ?? []) as Pessoa[];
  const porTipo = (contagem.data ?? []).reduce<Record<string, number>>((m, p) => ({ ...m, [p.tipo]: (m[p.tipo] ?? 0) + 1 }), {});
  let emEdicao = editar ? lista.find((p) => p.id === editar) : undefined;
  if (editar && !emEdicao) emEdicao = ((await s.banco.from("crm_esc_pessoas").select("*").eq("id", editar).maybeSingle()).data ?? undefined) as Pessoa | undefined;

  // negócios e imóveis da pessoa em edição
  const [negocios, imoveis] = emEdicao ? await Promise.all([
    s.banco.from("crm_esc_negocios").select("id,titulo,etapa").eq("pessoa_id", emEdicao.id).limit(50),
    s.banco.from("crm_esc_imoveis").select("id,codigo,titulo").eq("proprietario_id", emEdicao.id).limit(50),
  ]) : [null, null];

  return <section>
    <CabecalhoEscritorio espaco={s.espaco} ativa="pessoas" titulo="Clientes e proprietários" />
    <Avisos sp={sp} />
    <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Tipo de cadastro">
      <Link className={`${BOTAO} ${!tipo ? "border-verde" : ""}`} href="/painel/escritorio/pessoas">Todos ({contagem.data?.length ?? 0})</Link>
      {Object.entries(TIPOS_PESSOA).map(([k, v]) => <Link key={k} className={`${BOTAO} ${tipo === k ? "border-verde" : ""}`}
        href={`/painel/escritorio/pessoas?tipo=${k}`}>{v} ({porTipo[k] ?? 0})</Link>)}
    </nav>

    <details className="cartao mb-6 p-4" open={!!emEdicao || !!tipo && !lista.length}>
      <summary className="cursor-pointer font-semibold">{emEdicao ? `Editar ${emEdicao.nome}` : "Novo cadastro"}</summary>
      <form action={salvarPessoa} className="mt-4 grid gap-3 md:grid-cols-3" key={emEdicao?.id ?? "novo"}>
        <input type="hidden" name="_volta" value={volta} />
        {emEdicao && <input type="hidden" name="id" value={emEdicao.id} />}
        <label className="grid gap-1 text-sm">Tipo<select name="tipo" defaultValue={emEdicao?.tipo ?? (tipo || "cliente")} className={CAMPO_P}>
          {Object.entries(TIPOS_PESSOA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-sm md:col-span-2">Nome<input name="nome" required defaultValue={emEdicao?.nome} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm">Telefone / WhatsApp<input name="telefone" inputMode="tel" defaultValue={emEdicao?.telefone ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm">E-mail<input name="email" type="email" defaultValue={emEdicao?.email ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm">CPF/CNPJ<input name="documento" defaultValue={emEdicao?.documento ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm">Cidade<input name="cidade" defaultValue={emEdicao?.cidade ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm">Origem<select name="origem" defaultValue={emEdicao?.origem ?? ""} className={CAMPO_P}>
          <option value="">—</option>{ORIGENS.map((o) => <option key={o}>{o}</option>)}</select></label>
        <CampoResponsavel membros={s.membros} valor={emEdicao?.responsavel} equipe={s.espaco.equipe} />
        <label className="grid gap-1 text-sm md:col-span-3">Observações<textarea name="observacoes" rows={2} defaultValue={emEdicao?.observacoes ?? ""} className={CAMPO_P} /></label>
        <div className="flex flex-wrap gap-3 md:col-span-3">
          <button className={BOTAO_VERDE}>{emEdicao ? "Salvar alterações" : "Cadastrar"}</button>
          {emEdicao && <Link className={BOTAO} href={volta}>Cancelar</Link>}
          {emEdicao && <Link className={BOTAO} href={`/painel/escritorio/agenda?novo=1&pessoa=${emEdicao.id}`}>Agendar</Link>}
        </div>
      </form>
      {emEdicao && <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div><p className="font-semibold">Negócios</p>{negocios?.data?.length ? <ul>{negocios.data.map((n) => <li key={n.id}>
          <Link className="underline" href={`/painel/escritorio?editar=${n.id}`}>{n.titulo}</Link></li>)}</ul> : <p className="text-texto-2">Nenhum.</p>}</div>
        <div><p className="font-semibold">Imóveis como proprietário</p>{imoveis?.data?.length ? <ul>{imoveis.data.map((i) => <li key={i.id}>
          <Link className="underline" href={`/painel/escritorio/imoveis?editar=${i.id}`}>{i.codigo} · {i.titulo}</Link></li>)}</ul> : <p className="text-texto-2">Nenhum.</p>}</div>
        <BotaoExcluir tipo="pessoa" id={emEdicao.id} volta={volta} />
      </div>}
    </details>

    <form className="mb-4 flex flex-wrap items-end gap-2">
      {tipo && <input type="hidden" name="tipo" value={tipo} />}
      <label className="grid gap-1 text-sm">Buscar<input name="q" defaultValue={busca} className={CAMPO_P} placeholder="Nome, telefone ou e-mail" /></label>
      <button className={BOTAO}>Buscar</button>
    </form>
    {pessoas.error && <p role="alert">Não foi possível carregar os cadastros.</p>}
    {!lista.length ? <p className="rounded-xl border border-dashed border-linha px-4 py-10 text-center text-texto-2">Nenhum cadastro encontrado.</p>
      : <ul className="cartao divide-y divide-linha">{lista.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Link href={`/painel/escritorio/pessoas?${new URLSearchParams({ ...(tipo ? { tipo } : {}), editar: p.id })}`} className="min-w-0 flex-1 font-medium hover:underline">{p.nome}</Link>
        <span className="text-sm text-texto-2">{TIPOS_PESSOA[p.tipo]}{p.cidade && <> · {p.cidade}</>}</span>
        {p.telefone && <a className="text-sm underline" href={`https://wa.me/55${p.telefone.replace(/\D/g, "").replace(/^55/, "")}`}>{p.telefone}</a>}
      </li>)}</ul>}
  </section>;
}
