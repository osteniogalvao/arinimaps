import Link from "next/link";
import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatBRLFinanceiro } from "@/lib/format";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { aba, LINK_ACAO, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";
import NovoMovimento from "./NovoMovimento";

export const metadata = { title: "Caixa" };

type Saldo = { id: string; nome: string; tipo: string; ativo: boolean; padrao: boolean; saldo_inicial: number; entradas: number; saidas: number; saldo: number };

/** Caixa (migration 0157), no molde da Arini: saldo por conta e movimentos de entrada e saída. */
export default async function Caixa({ searchParams }: PageProps<"/admin/financeiro/caixa">) {
  await exigirSetor("financeiro", "diretoria");
  const q = await searchParams;
  const admin = supabaseAdmin();
  const { data: saldos, error } = await admin.rpc("fn_caixa_saldos");
  if (error) {
    return (
      <div className="space-y-4">
        <CabecalhoPagina titulo="Caixa" eyebrow="Financeiro" />
        <p className="cartao p-5" role="alert">Falta rodar a migration 0157 (Aluguéis, caixa e fluxo do imóvel) no Supabase.</p>
      </div>
    );
  }
  const contas = (saldos ?? []) as Saldo[];
  const conta = typeof q.conta === "string" && contas.some((c) => c.id === q.conta) ? q.conta : null;
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const desde = typeof q.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.desde) ? q.desde : hoje.slice(0, 8) + "01";
  let consulta = admin.from("lancamentos_contabeis").select("id, data, historico, natureza, valor, origem, estornado, conta_bancaria_id")
    .gte("data", desde).order("data", { ascending: false }).order("created_at", { ascending: false }).limit(300);
  if (conta) consulta = consulta.eq("conta_bancaria_id", conta);
  const [{ data: movs }, { data: plano }] = await Promise.all([
    consulta,
    admin.from("plano_contas").select("id, codigo, nome").eq("ativo", true).order("codigo"),
  ]);
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]));
  const validos = (movs ?? []).filter((m) => !m.estornado);
  const entradas = validos.filter((m) => m.natureza === "entrada").reduce((s, m) => s + Number(m.valor), 0);
  const saidas = validos.filter((m) => m.natureza === "saida").reduce((s, m) => s + Number(m.valor), 0);
  const total = contas.filter((c) => c.ativo).reduce((s, c) => s + Number(c.saldo), 0);

  return (
    <div className="space-y-6">
      <CabecalhoPagina titulo="Caixa" eyebrow="Financeiro" />
      <p className="flex flex-wrap gap-4 text-sm">
        <Link href="/admin/registros/contas-bancarias" className={LINK_ACAO}>Cadastrar ou editar contas</Link>
        <Link href="/admin/financeiro/alugueis" className={LINK_ACAO}>Aluguéis</Link>
        <Link href="/admin/financeiro/resultado" className={LINK_ACAO}>Resultado e contabilidade</Link>
      </p>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="cartao p-4"><p className="text-xs uppercase tracking-wider text-texto-2">Saldo total</p><p className="lp-display mt-1 text-2xl">{formatBRLFinanceiro(total)}</p></div>
        {contas.filter((c) => c.ativo).map((c) => (
          <Link key={c.id} href={`?conta=${c.id}&desde=${desde}`} className={"cartao block p-4 transition-colors hover:border-verde " + (conta === c.id ? "border-verde" : "")}>
            <p className="text-xs uppercase tracking-wider text-texto-2">{c.nome}{c.padrao ? " · principal" : ""}</p>
            <p className={"lp-display mt-1 text-2xl " + (Number(c.saldo) < 0 ? "text-critico" : "")}>{formatBRLFinanceiro(Number(c.saldo))}</p>
          </Link>
        ))}
      </section>
      <NovoMovimento contas={contas.filter((c) => c.ativo).map((c) => ({ id: c.id, nome: c.nome }))} plano={plano ?? []} />
      <nav className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`?desde=${desde}`} className={aba(!conta)}>Todas as contas</Link>
        <form className="flex items-center gap-2">
          {conta && <input type="hidden" name="conta" value={conta} />}
          <label className="text-xs text-texto-2">Desde <input type="date" name="desde" defaultValue={desde} className="rounded-xl border border-linha bg-superficie-2 px-2 py-1" /></label>
          <button className="btn-contorno px-3 py-1 text-xs">Filtrar</button>
        </form>
        <span className="text-texto-2">Entradas {formatBRLFinanceiro(entradas)} · Saídas {formatBRLFinanceiro(saidas)}</span>
      </nav>
      <div className={TABELA_CAIXA}>
        <table className={TABELA}>
          <thead className={THEAD}><tr><th className={TH}>Data</th><th className={TH}>Histórico</th><th className={TH}>Conta</th><th className={TH}>Origem</th><th className={TH}>Valor</th></tr></thead>
          <tbody className={TBODY}>
            {(movs ?? []).map((m) => (
              <tr key={m.id} className={TR + (m.estornado ? " opacity-50 line-through" : "")}>
                <td className={TD}>{m.data.split("-").reverse().join("/")}</td>
                <td className={TD}>{m.historico}</td>
                <td className={TD}>{nomeConta.get(m.conta_bancaria_id) ?? "—"}</td>
                <td className={TD}>{m.origem}</td>
                <td className={TD + " tabular-nums " + (m.natureza === "entrada" ? "text-verde" : "text-critico")}>{m.natureza === "entrada" ? "+" : "−"} {formatBRLFinanceiro(Number(m.valor))}</td>
              </tr>
            ))}
            {!movs?.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-texto-2">Nenhum movimento no período.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
