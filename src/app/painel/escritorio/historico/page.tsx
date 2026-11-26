import Link from "next/link";
import { dataHoraSP } from "@/lib/crm-escritorio";
import { BOTAO, CabecalhoEscritorio, SemEscritorio, abrirEscritorio, umParam, type Parametros } from "../comum";

const ENTIDADE: Record<string, string> = { pessoas: "Cadastro", imoveis: "Imóvel", negocios: "Negócio", agenda: "Agenda" };
const POR_PAGINA = 50;

/** Trilha de alterações do escritório (plano Premium, recurso crm_auditoria). */
export default async function HistoricoEscritorio({ searchParams }: { searchParams: Promise<Parametros> }) {
  const s = await abrirEscritorio();
  if (s.status !== 200) return <SemEscritorio status={s.status} />;
  if (!s.espaco.auditoria) return <section>
    <CabecalhoEscritorio espaco={s.espaco} ativa="historico" titulo="Histórico" />
    <p>A trilha de alterações do escritório (quem criou, mudou de etapa ou excluiu cada registro) faz parte do plano Premium.</p>
    <Link className={BOTAO + " mt-3"} href="/planos?perfil=corretor">Ver planos</Link>
  </section>;
  const sp = await searchParams;
  const pagina = Math.max(1, Math.min(1000, Number(umParam(sp, "pagina")) || 1));
  const { data, error } = await s.banco.from("crm_esc_historico").select("id,entidade,acao,resumo,autor,criado_em")
    .order("criado_em", { ascending: false }).range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const itens = (data ?? []).slice(0, POR_PAGINA);
  const nome = new Map(s.membros.map((m) => [m.user_id, m.nome]));
  return <section>
    <CabecalhoEscritorio espaco={s.espaco} ativa="historico" titulo="Histórico de alterações" subtitulo="Tudo o que a equipe criou, alterou ou excluiu no escritório." />
    {error && <p role="alert">Não foi possível carregar o histórico.</p>}
    {!itens.length ? <p className="text-texto-2">Nenhuma alteração registrada.</p>
      : <ul className="cartao divide-y divide-linha">{itens.map((h) => <li key={h.id} className="flex flex-wrap gap-3 px-4 py-2 text-sm">
        <span className="w-32 shrink-0 tabular-nums text-texto-2">{dataHoraSP(h.criado_em)}</span>
        <span className="w-20 shrink-0 text-texto-2">{ENTIDADE[h.entidade] ?? h.entidade}</span>
        <span className="min-w-0 flex-1">{h.resumo}</span>
        <span className="text-texto-2">{h.autor ? nome.get(h.autor) ?? "Ex-membro" : "Sistema"}</span>
      </li>)}</ul>}
    <nav className="mt-4 flex gap-2">
      {pagina > 1 && <Link className={BOTAO} href={`/painel/escritorio/historico?pagina=${pagina - 1}`}>Anterior</Link>}
      {(data?.length ?? 0) > POR_PAGINA && <Link className={BOTAO} href={`/painel/escritorio/historico?pagina=${pagina + 1}`}>Próxima</Link>}
    </nav>
  </section>;
}
