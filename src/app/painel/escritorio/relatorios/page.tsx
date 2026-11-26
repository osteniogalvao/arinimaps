import { ETAPA_IDS, STATUS_IMOVEL, diaSP, reais, rotulosEtapa, type EtapaNegocio } from "@/lib/crm-escritorio";
import { CAMPO_P, BOTAO, CabecalhoEscritorio, SemEscritorio, abrirEscritorio, umParam, type Parametros } from "../comum";

type N = { etapa: EtapaNegocio; valor: number | null; origem: string | null; responsavel: string | null; criado_em: string; fechado_em: string | null };

function Numero({ rotulo, valor, ajuda }: { rotulo: string; valor: string | number; ajuda?: string }) {
  return     <div className="cartao p-4"><p className="text-sm text-texto-2">{rotulo}</p><p className="text-2xl font-semibold tabular-nums">{valor}</p>{ajuda && <p className="text-xs text-texto-2">{ajuda}</p>}</div>;
}

/** Relatórios do escritório: funil, conversão, origem, carteira, agenda e (com equipe) desempenho por pessoa. */
export default async function RelatoriosEscritorio({ searchParams }: { searchParams: Promise<Parametros> }) {
  const s = await abrirEscritorio();
  if (s.status !== 200) return <SemEscritorio status={s.status} />;
  const sp = await searchParams;
  const hoje = diaSP(new Date());
  const mes = /^\d{4}-\d{2}$/.test(umParam(sp, "mes")) ? umParam(sp, "mes") : hoje.slice(0, 7);
  const inicio = new Date(`${mes}-01T00:00:00-03:00`);
  const fim = new Date(inicio); fim.setMonth(fim.getMonth() + 1);
  const rotulos = rotulosEtapa(s.espaco);

  const [neg, imo, ag] = await Promise.all([
    s.banco.from("crm_esc_negocios").select("etapa,valor,origem,responsavel,criado_em,fechado_em").limit(5000),
    s.banco.from("crm_esc_imoveis").select("status").limit(5000),
    s.banco.from("crm_esc_agenda").select("status,tipo,responsavel").gte("inicio", inicio.toISOString()).lt("inicio", fim.toISOString()).limit(5000),
  ]);
  const negocios = (neg.data ?? []) as N[];
  const noMes = (d: string | null) => !!d && d >= inicio.toISOString() && d < fim.toISOString();
  const novos = negocios.filter((n) => noMes(n.criado_em));
  const ganhos = negocios.filter((n) => n.etapa === "fechado" && noMes(n.fechado_em));
  const perdidos = negocios.filter((n) => n.etapa === "perdido" && noMes(n.fechado_em));
  const conversao = ganhos.length + perdidos.length ? Math.round((ganhos.length / (ganhos.length + perdidos.length)) * 100) : null;
  const soma = (l: N[]) => l.reduce((t, n) => t + Number(n.valor ?? 0), 0);
  const conta = <T,>(l: T[], f: (x: T) => string) => [...l.reduce((m, x) => m.set(f(x), (m.get(f(x)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const nome = new Map(s.membros.map((m) => [m.user_id, m.nome]));
  const agenda = ag.data ?? [];

  return <section className="space-y-6">
    <CabecalhoEscritorio espaco={s.espaco} ativa="relatorios" titulo="Relatórios" />
    <form className="flex items-end gap-2"><label className="grid gap-1 text-sm">Mês<input type="month" name="mes" defaultValue={mes} className={CAMPO_P} /></label><button className={BOTAO}>Ver</button></form>
    {(neg.error || imo.error || ag.error) && <p role="alert">Parte dos dados não carregou. Tente novamente.</p>}

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Numero rotulo="Negócios novos no mês" valor={novos.length} />
      <Numero rotulo="Fechados no mês" valor={ganhos.length} ajuda={reais(soma(ganhos))} />
      <Numero rotulo="Perdidos no mês" valor={perdidos.length} />
      <Numero rotulo="Conversão" valor={conversao === null ? "—" : conversao + "%"} ajuda="fechados ÷ (fechados + perdidos)" />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <div className="cartao p-4"><h2 className="mb-3 font-semibold">Funil agora</h2>
        {ETAPA_IDS.map((e) => { const l = negocios.filter((n) => n.etapa === e); const max = Math.max(1, ...ETAPA_IDS.map((x) => negocios.filter((n) => n.etapa === x).length));
          return <div key={e} className="mb-2"><div className="flex justify-between text-sm"><span>{rotulos[e]}</span><span className="tabular-nums">{l.length} · {reais(soma(l))}</span></div>
            <div className="h-2 rounded bg-superficie-2"><div className="h-2 rounded bg-verde" style={{ width: `${(l.length / max) * 100}%` }} /></div></div>; })}
      </div>
      <div className="cartao p-4"><h2 className="mb-3 font-semibold">Origem dos negócios novos</h2>
        {novos.length ? <ul className="space-y-1 text-sm">{conta(novos, (n) => n.origem ?? "Não informada").map(([o, q]) => <li key={o} className="flex justify-between"><span>{o}</span><span className="tabular-nums">{q}</span></li>)}</ul>
          : <p className="text-sm text-texto-2">Nenhum negócio novo no mês.</p>}
      </div>
      <div className="cartao p-4"><h2 className="mb-3 font-semibold">Carteira de imóveis</h2>
        <ul className="space-y-1 text-sm">{Object.entries(STATUS_IMOVEL).map(([k, v]) => <li key={k} className="flex justify-between"><span>{v}</span>
          <span className="tabular-nums">{(imo.data ?? []).filter((i) => i.status === k).length}</span></li>)}</ul>
      </div>
      <div className="cartao p-4"><h2 className="mb-3 font-semibold">Agenda do mês</h2>
        <ul className="space-y-1 text-sm">
          <li className="flex justify-between"><span>Compromissos</span><span className="tabular-nums">{agenda.length}</span></li>
          <li className="flex justify-between"><span>Visitas</span><span className="tabular-nums">{agenda.filter((a) => a.tipo === "visita").length}</span></li>
          <li className="flex justify-between"><span>Feitos</span><span className="tabular-nums">{agenda.filter((a) => a.status === "feito").length}</span></li>
          <li className="flex justify-between"><span>Cancelados</span><span className="tabular-nums">{agenda.filter((a) => a.status === "cancelado").length}</span></li>
        </ul>
      </div>
    </div>

    {s.espaco.equipe && <div className="cartao overflow-x-auto p-4"><h2 className="mb-3 font-semibold">Desempenho da equipe no mês</h2>
      <table className="w-full min-w-[560px] text-sm"><thead className="text-left text-xs uppercase tracking-wider text-texto-2"><tr>
        <th className="py-1">Pessoa</th><th>Em andamento</th><th>Fechados</th><th>Valor fechado</th><th>Visitas feitas</th></tr></thead>
        <tbody className="divide-y divide-linha">{s.membros.map((m) => {
          const meus = negocios.filter((n) => n.responsavel === m.user_id);
          const g = ganhos.filter((n) => n.responsavel === m.user_id);
          return <tr key={m.user_id}><td className="py-2">{nome.get(m.user_id)}</td>
            <td className="tabular-nums">{meus.filter((n) => !["fechado", "perdido"].includes(n.etapa)).length}</td>
            <td className="tabular-nums">{g.length}</td><td className="tabular-nums">{reais(soma(g))}</td>
            <td className="tabular-nums">{agenda.filter((a) => a.responsavel === m.user_id && a.tipo === "visita" && a.status === "feito").length}</td></tr>;
        })}</tbody></table></div>}
  </section>;
}
