import Link from "next/link";
import {
  ETAPA_IDS, ORIGENS, UUID_ESC, dataHoraSP, paraCampoDataHora, reais, rotulosEtapa, type EtapaNegocio,
} from "@/lib/crm-escritorio";
import {
  Avisos, BOTAO, BOTAO_VERDE, BotaoExcluir, CAMPO_P, CabecalhoEscritorio, CampoResponsavel, SemEscritorio, abrirEscritorio, umParam,
  type Parametros,
} from "./comum";
import { moverNegocio, salvarNegocio } from "./acoes";

type Negocio = {
  id: string; titulo: string; etapa: EtapaNegocio; valor: number | null; origem: string | null;
  proxima_acao: string | null; proxima_acao_em: string | null; motivo_perda: string | null; observacoes: string | null;
  responsavel: string | null; pessoa_id: string | null; imovel_id: string | null; atualizado_em: string;
  pessoa: { nome: string; telefone: string | null } | null; imovel: { codigo: string; titulo: string } | null;
};

/**
 * Funil do escritório: negócios em colunas por etapa, como o kanban de leads
 * do CRM da Arini Negócios. Cada cartão avança ou volta de etapa com um toque.
 */
export default async function FunilEscritorio({ searchParams }: { searchParams: Promise<Parametros> }) {
  const s = await abrirEscritorio();
  if (s.status !== 200) return <SemEscritorio status={s.status} />;
  const sp = await searchParams;
  const rotulos = rotulosEtapa(s.espaco);
  const quem = umParam(sp, "quem");
  const busca = umParam(sp, "q").slice(0, 60);
  const editar = UUID_ESC.test(umParam(sp, "editar")) ? umParam(sp, "editar") : null;
  const volta = "/painel/escritorio?" + new URLSearchParams({ ...(quem ? { quem } : {}), ...(busca ? { q: busca } : {}) });

  let q = s.banco.from("crm_esc_negocios")
    .select("id,titulo,etapa,valor,origem,proxima_acao,proxima_acao_em,motivo_perda,observacoes,responsavel,pessoa_id,imovel_id,atualizado_em,pessoa:crm_esc_pessoas(nome,telefone),imovel:crm_esc_imoveis(codigo,titulo)")
    .order("atualizado_em", { ascending: false }).limit(600);
  if (quem && UUID_ESC.test(quem)) q = q.eq("responsavel", quem);
  if (busca) q = q.ilike("titulo", `%${busca.replace(/[%_,]/g, " ")}%`);
  const [negocios, pessoas, imoveis] = await Promise.all([
    q,
    s.banco.from("crm_esc_pessoas").select("id,nome,tipo").order("nome").limit(1000),
    s.banco.from("crm_esc_imoveis").select("id,codigo,titulo").neq("status", "inativo").order("codigo").limit(1000),
  ]);
  const lista = (negocios.data ?? []) as unknown as Negocio[];
  const nome = new Map(s.membros.map((m) => [m.user_id, m.nome]));
  const emEdicao = editar ? lista.find((n) => n.id === editar) : undefined;
  const agora = new Date().toISOString();
  const abertos = lista.filter((n) => !["fechado", "perdido"].includes(n.etapa));
  const totalAberto = abertos.reduce((t, n) => t + Number(n.valor ?? 0), 0);

  return <section>
    <CabecalhoEscritorio espaco={s.espaco} ativa="funil" titulo="Funil de negócios"
      subtitulo={`${abertos.length} em andamento · ${reais(totalAberto)} em negociação`} />
    <Avisos sp={sp} />
    {negocios.error && <p role="alert" className="mb-4">Não foi possível carregar o funil. Tente novamente.</p>}

    <form className="mb-4 flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm">Buscar<input name="q" defaultValue={busca} className={CAMPO_P} placeholder="Título do negócio" /></label>
      {s.espaco.equipe && <label className="grid gap-1 text-sm">Responsável<select name="quem" defaultValue={quem} className={CAMPO_P}>
        <option value="">Toda a equipe</option>{s.membros.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
      </select></label>}
      <button className={BOTAO}>Filtrar</button>
    </form>

    <details className="cartao mb-6 p-4" open={!!emEdicao || (!lista.length && !busca)}>
      <summary className="cursor-pointer font-semibold">{emEdicao ? `Editar: ${emEdicao.titulo}` : "Novo negócio"}</summary>
      <form action={salvarNegocio} className="mt-4 grid gap-3 md:grid-cols-3" key={emEdicao?.id ?? "novo"}>
        <input type="hidden" name="_volta" value={volta} />
        {emEdicao && <input type="hidden" name="id" value={emEdicao.id} />}
        <label className="grid gap-1 text-sm md:col-span-2">Título<input name="titulo" defaultValue={emEdicao?.titulo} className={CAMPO_P}
          placeholder={s.espaco.nicho === "engenheiro" ? "Ex.: Georreferenciamento Fazenda Boa Vista" : "Ex.: Compra de casa no centro"} /></label>
        <label className="grid gap-1 text-sm">Etapa<select name="etapa" defaultValue={emEdicao?.etapa ?? "novo"} className={CAMPO_P}>
          {ETAPA_IDS.map((e) => <option key={e} value={e}>{rotulos[e]}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Cliente cadastrado<select name="pessoa_id" defaultValue={emEdicao?.pessoa_id ?? ""} className={CAMPO_P}>
          <option value="">—</option>{(pessoas.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
        {!emEdicao && <>
          <label className="grid gap-1 text-sm">ou novo cliente<input name="novo_cliente" className={CAMPO_P} placeholder="Nome" /></label>
          <label className="grid gap-1 text-sm">Telefone do novo cliente<input name="novo_telefone" className={CAMPO_P} inputMode="tel" /></label>
        </>}
        <label className="grid gap-1 text-sm">Imóvel<select name="imovel_id" defaultValue={emEdicao?.imovel_id ?? ""} className={CAMPO_P}>
          <option value="">—</option>{(imoveis.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.titulo}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Valor (R$)<input name="valor" inputMode="decimal" defaultValue={emEdicao?.valor ?? ""} className={CAMPO_P} /></label>
        <label className="grid gap-1 text-sm">Origem<select name="origem" defaultValue={emEdicao?.origem ?? ""} className={CAMPO_P}>
          <option value="">—</option>{ORIGENS.map((o) => <option key={o}>{o}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Próxima ação<input name="proxima_acao" defaultValue={emEdicao?.proxima_acao ?? ""} className={CAMPO_P} placeholder="Ex.: ligar para confirmar visita" /></label>
        <label className="grid gap-1 text-sm">Quando<input type="datetime-local" name="proxima_acao_em" defaultValue={paraCampoDataHora(emEdicao?.proxima_acao_em)} className={CAMPO_P} /></label>
        <CampoResponsavel membros={s.membros} valor={emEdicao?.responsavel} equipe={s.espaco.equipe} />
        {emEdicao && <label className="grid gap-1 text-sm">Motivo da perda<input name="motivo_perda" defaultValue={emEdicao.motivo_perda ?? ""} className={CAMPO_P} /></label>}
        <label className="grid gap-1 text-sm md:col-span-3">Observações<textarea name="observacoes" rows={2} defaultValue={emEdicao?.observacoes ?? ""} className={CAMPO_P} /></label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-3">
          <button className={BOTAO_VERDE}>{emEdicao ? "Salvar alterações" : "Criar negócio"}</button>
          {emEdicao && <Link className={BOTAO} href={volta}>Cancelar</Link>}
          {emEdicao && <Link className={BOTAO} href={`/painel/escritorio/agenda?novo=1&negocio=${emEdicao.id}`}>Agendar</Link>}
        </div>
      </form>
      {emEdicao && <div className="mt-3"><BotaoExcluir tipo="negocio" id={emEdicao.id} volta={volta} /></div>}
    </details>

    <div className="flex gap-3 overflow-x-auto pb-4">
      {ETAPA_IDS.map((etapa, i) => {
        const cartoes = lista.filter((n) => n.etapa === etapa);
        const soma = cartoes.reduce((t, n) => t + Number(n.valor ?? 0), 0);
        return <section key={etapa} aria-label={rotulos[etapa]} className="w-72 shrink-0 rounded-2xl border border-linha bg-superficie-2/40">
          <header className="sticky top-0 rounded-t-2xl border-b border-linha bg-superficie px-3 py-2">
            <p className="font-semibold">{rotulos[etapa]} <span className="text-sm text-texto-2">({cartoes.length})</span></p>
            <p className="text-xs text-texto-2">{reais(soma)}</p>
          </header>
          <ul className="space-y-2 p-2">
            {cartoes.map((n) => {
              const atrasada = n.proxima_acao_em && n.proxima_acao_em < agora && !["fechado", "perdido"].includes(n.etapa);
              return <li key={n.id} className="rounded-xl border border-linha bg-superficie p-3 text-sm">
                <Link href={`/painel/escritorio?editar=${n.id}`} className="block font-semibold hover:underline">{n.titulo}</Link>
                {n.pessoa && <p className="text-texto-2">{n.pessoa.nome}{n.pessoa.telefone && <> · <a className="underline" href={`https://wa.me/55${n.pessoa.telefone.replace(/\D/g, "").replace(/^55/, "")}`}>{n.pessoa.telefone}</a></>}</p>}
                {n.imovel && <p className="text-texto-2">{n.imovel.codigo} · {n.imovel.titulo}</p>}
                {n.valor !== null && <p>{reais(n.valor)}</p>}
                {n.proxima_acao_em && <p className={atrasada ? "text-critico" : "text-texto-2"}>{atrasada ? "Atrasado: " : "Próxima: "}{n.proxima_acao ?? "ação"} · {dataHoraSP(n.proxima_acao_em)}</p>}
                {s.espaco.equipe && n.responsavel && <p className="text-xs text-texto-2">{nome.get(n.responsavel) ?? "—"}</p>}
                <div className="mt-2 flex gap-1">
                  {i > 0 && <form action={moverNegocio}><input type="hidden" name="id" value={n.id} /><input type="hidden" name="_volta" value={volta} />
                    <input type="hidden" name="etapa" value={ETAPA_IDS[i - 1]} /><button className={BOTAO} title={`Voltar para ${rotulos[ETAPA_IDS[i - 1]]}`} aria-label={`Voltar para ${rotulos[ETAPA_IDS[i - 1]]}`}>←</button></form>}
                  {i < ETAPA_IDS.length - 1 && <form action={moverNegocio}><input type="hidden" name="id" value={n.id} /><input type="hidden" name="_volta" value={volta} />
                    <input type="hidden" name="etapa" value={ETAPA_IDS[i + 1]} /><button className={BOTAO} aria-label={`Avançar para ${rotulos[ETAPA_IDS[i + 1]]}`}>{rotulos[ETAPA_IDS[i + 1]]} →</button></form>}
                </div>
              </li>;
            })}
            {!cartoes.length && <li className="px-2 py-6 text-center text-xs text-texto-2">Nenhum negócio</li>}
          </ul>
        </section>;
      })}
    </div>
  </section>;
}
