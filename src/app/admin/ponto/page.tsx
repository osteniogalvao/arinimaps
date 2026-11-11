import Link from "next/link";
import { Clock, Download } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { diaSP, horaSP, JORNADA_PADRAO, minutosEmHoras, montarEspelho, type Jornada, type Marcacao } from "@/lib/ponto";
import { CabecalhoPagina, Etiqueta, Vazio } from "@/components/ui/Pagina";
import { Secao } from "@/components/admin/Painel";
import { aba, LISTA, LISTA_VAZIA, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";
import BaterPonto from "@/components/ponto/BaterPonto";
import PedirAjuste from "@/components/ponto/PedirAjuste";

const AJUSTE_LABEL: Record<string, string> = { incluir: "Incluir marcação", desconsiderar: "Desconsiderar marcação", abono: "Abonar o dia" };

/**
 * Ponto eletrônico do colaborador (Central de CRMs, etapa 3): bater o ponto,
 * espelho do mês com saldo e pedidos de ajuste.
 */
export default async function Ponto({ searchParams }: PageProps<"/admin/ponto">) {
  const user = await exigirEquipe();
  const sp = await searchParams;
  const mesAtual = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const mes = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : mesAtual;
  const admin = supabaseAdmin();
  const inicio = new Date(`${mes}-01T00:00:00-03:00`);
  const fim = new Date(inicio); fim.setMonth(fim.getMonth() + 1);

  const [{ data: jornada, error }, { data: marcacoes }, { data: ajustes }] = await Promise.all([
    admin.from("ponto_jornadas").select("*").eq("user_id", user.id).maybeSingle(),
    admin.from("ponto_marcacoes").select("id, nsr, marcado_em, origem, hash").eq("user_id", user.id)
      .gte("marcado_em", inicio.toISOString()).lt("marcado_em", fim.toISOString()).order("marcado_em"),
    admin.from("ponto_ajustes").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (error) {
    return (
      <div className="max-w-4xl space-y-6">
        <CabecalhoPagina eyebrow="Equipe" titulo="Meu ponto" />
        <Vazio icone={Clock} titulo="Falta atualizar o banco" texto="O ponto precisa da migration 0067." />
      </div>
    );
  }
  const aprovados = (ajustes ?? []).filter((a) => a.status === "aprovado");
  const desc = new Set(aprovados.filter((a) => a.tipo === "desconsiderar").map((a) => String(a.marcacao_id)));
  const abonos = new Set(aprovados.filter((a) => a.tipo === "abono").map((a) => String(a.data)));
  const lista = (marcacoes ?? []) as Marcacao[];
  const dias = montarEspelho(mes, lista, (jornada as Jornada | null) ?? JORNADA_PADRAO, desc, abonos);
  const hoje = diaSP(new Date());
  const deHoje = lista.filter((m) => diaSP(m.marcado_em) === hoje && !desc.has(m.id));
  const saldo = dias.reduce((s, d) => s + d.saldo, 0);
  const meses = [0, 1, 2].map((i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7); });

  return (
    <div className="max-w-5xl space-y-8">
      <CabecalhoPagina eyebrow="Equipe" titulo="Meu ponto"
        subtitulo={jornada?.ativo === false || !jornada
          ? "A Diretoria ainda não definiu a sua jornada. Você pode marcar o ponto mesmo assim."
          : `Jornada de ${minutosEmHoras(jornada.carga_diaria_min)} por dia, entrada às ${String(jornada.entrada_prevista).slice(0, 5)}.`}
        acoes={user.setores.includes("diretoria") ? <Link href="/admin/ponto/equipe" className="btn-contorno px-4 py-2.5 text-sm">Ponto da equipe</Link> : undefined} />

      <section className="cartao flex flex-wrap items-center justify-between gap-6 p-6">
        <div>
          <p className="text-sm text-texto-2">Hoje</p>
          <p className="lp-display mt-1 text-2xl text-texto">{deHoje.length ? deHoje.map((m) => horaSP(m.marcado_em)).join(" · ") : "Nenhuma marcação"}</p>
          <p className="mt-1 text-sm text-texto-2">Saldo do mês: <strong className={saldo < 0 ? "text-critico" : "text-verde"}>{minutosEmHoras(saldo)}</strong></p>
        </div>
        <BaterPonto proxima={deHoje.length % 2 === 0 ? "entrada" : "saída"} />
      </section>

      <Secao titulo="Espelho do mês" acao={
        <span className="flex flex-wrap gap-2">
          {meses.map((m) => <Link key={m} href={`/admin/ponto?mes=${m}`} className={aba(m === mes)}>{m.split("-").reverse().join("/")}</Link>)}
          <a href={`/api/admin/ponto/exportar?mes=${mes}`} className="btn-contorno inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Download className="size-4" /> CSV</a>
        </span>
      }>
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead className={THEAD}><tr>
              <th className={TH}>Dia</th><th className={TH}>Marcações</th><th className={TH}>Trabalhado</th><th className={TH}>Previsto</th><th className={TH}>Saldo</th>
            </tr></thead>
            <tbody className={TBODY}>
              {dias.map((d) => (
                <tr key={d.data} className={TR}>
                  <td className={TD + " whitespace-nowrap"}>{new Date(`${d.data}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</td>
                  <td className={TD}>
                    {d.marcacoes.map((m) => (
                      <span key={m.id} title={`NSR ${m.nsr}`} className={"mr-2 tabular-nums " + (m.origem !== "web" ? "text-ouro" : "text-texto")}>{horaSP(m.marcado_em)}</span>
                    ))}
                    {d.incompleto && <Etiqueta tom="alerta">incompleto</Etiqueta>}
                    {d.abonado && <Etiqueta tom="verde">abonado</Etiqueta>}
                  </td>
                  <td className={TD + " tabular-nums"}>{minutosEmHoras(d.trabalhado)}</td>
                  <td className={TD + " tabular-nums text-texto-2"}>{minutosEmHoras(d.previsto)}</td>
                  <td className={TD + " tabular-nums " + (d.saldo < 0 ? "text-critico" : "text-texto")}>{minutosEmHoras(d.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!dias.length && <p className={LISTA_VAZIA}>Sem dias neste mês.</p>}
        </div>
        <p className="text-xs text-texto-2">Em dourado, marcações incluídas por ajuste ou feitas sem internet.</p>
      </Secao>

      <div className="grid gap-6 lg:grid-cols-2">
        <PedirAjuste marcacoes={lista.map((m) => ({ id: m.id, rotulo: `${new Date(m.marcado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} ${horaSP(m.marcado_em)}` })).reverse()} />
        <Secao titulo="Meus pedidos de ajuste">
          <div className={LISTA}>
            {(ajustes ?? []).map((a) => (
              <div key={a.id} className="px-5 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-texto">{AJUSTE_LABEL[a.tipo]} · {new Date(`${a.data}T12:00:00`).toLocaleDateString("pt-BR")}</span>
                  <Etiqueta tom={a.status === "aprovado" ? "verde" : a.status === "reprovado" ? "critico" : "ouro"}>{a.status}</Etiqueta>
                </div>
                <p className="mt-0.5 text-xs text-texto-2">{a.motivo}{a.resposta ? ` · Resposta: ${a.resposta}` : ""}</p>
              </div>
            ))}
            {!ajustes?.length && <p className={LISTA_VAZIA}>Nenhum pedido.</p>}
          </div>
        </Secao>
      </div>
    </div>
  );
}
