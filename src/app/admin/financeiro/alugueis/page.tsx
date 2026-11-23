import Link from "next/link";
import { AlertTriangle, CalendarClock, HandCoins, Percent } from "lucide-react";
import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatBRLFinanceiro } from "@/lib/format";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { Indicadores } from "@/components/admin/Painel";
import { aba, CODIGO, LINK_ACAO, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";
import AcoesParcela from "./AcoesParcela";

export const metadata = { title: "Aluguéis" };

type Parcela = {
  id: string; contrato_id: string; competencia: string; vencimento: string; valor: number; status: string;
  pago_em: string | null; valor_pago: number | null; valor_repasse: number | null; repasse_vencimento: string | null;
  repasse_status: string; repasse_em: string | null; observacoes: string | null;
  contrato: { codigo: string; inquilino_nome: string; inquilino_telefone: string | null; proprietario_nome: string; proprietario_pix: string | null; endereco: string | null } | null;
};

const STATUS: Record<string, string> = { pendente: "A vencer", atrasado: "Atrasado", pago: "Pago", cancelado: "Cancelado" };
const REPASSE: Record<string, string> = { pendente: "A repassar", repassado: "Repassado", retido: "Retido" };
const br = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

/** Gestão de aluguéis (migration 0157), no molde da Arini: parcela do inquilino, atraso e repasse ao proprietário. */
export default async function Alugueis({ searchParams }: PageProps<"/admin/financeiro/alugueis">) {
  await exigirSetor("financeiro", "diretoria");
  const q = await searchParams;
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const mes = typeof q.mes === "string" && /^\d{4}-\d{2}$/.test(q.mes) ? q.mes : hoje.slice(0, 7);
  const filtro = typeof q.filtro === "string" ? q.filtro : "mes";
  const admin = supabaseAdmin();

  let consulta = admin.from("alugueis_parcelas")
    .select("*, contrato:contratos_locacao(codigo, inquilino_nome, inquilino_telefone, proprietario_nome, proprietario_pix, endereco)")
    .order("vencimento");
  if (filtro === "atrasados") consulta = consulta.eq("status", "atrasado");
  else if (filtro === "repasses") consulta = consulta.eq("status", "pago").in("repasse_status", ["pendente", "retido"]);
  else consulta = consulta.eq("competencia", mes + "-01");
  const [{ data, error }, contratos, doMes] = await Promise.all([
    consulta.limit(500),
    admin.from("contratos_locacao").select("id", { count: "exact", head: true }).eq("status", "ativo"),
    admin.from("alugueis_parcelas").select("valor, status, valor_pago, valor_repasse, repasse_status").eq("competencia", mes + "-01"),
  ]);
  if (error) {
    return (
      <div className="space-y-4">
        <CabecalhoPagina titulo="Aluguéis" eyebrow="Financeiro" />
        <p className="cartao p-5" role="alert">Falta rodar a migration 0157 (Aluguéis, caixa e fluxo do imóvel) no Supabase.</p>
      </div>
    );
  }
  const parcelas = (data ?? []) as unknown as Parcela[];
  const m = doMes.data ?? [];
  const soma = (l: typeof m, f: (x: (typeof m)[number]) => number) => l.reduce((s, x) => s + f(x), 0);
  const pagas = m.filter((x) => x.status === "pago");
  const [ano, mm] = mes.split("-").map(Number);
  const navegar = (d: number) => new Date(Date.UTC(ano, mm - 1 + d, 1)).toISOString().slice(0, 7);
  const nomeMes = new Date(Date.UTC(ano, mm - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      <CabecalhoPagina titulo="Aluguéis" eyebrow="Financeiro" />
      <p className="flex flex-wrap gap-4 text-sm">
        <Link href="/admin/registros/contratos-locacao" className={LINK_ACAO}>Contratos de locação ({contratos.count ?? 0} ativos)</Link>
        <Link href="/admin/financeiro/caixa" className={LINK_ACAO}>Caixa e contas</Link>
      </p>
      <Indicadores itens={[
        { rotulo: `A receber em ${nomeMes}`, valor: formatBRLFinanceiro(soma(m.filter((x) => x.status !== "cancelado"), (x) => Number(x.valor))), icone: CalendarClock },
        { rotulo: "Recebido no mês", valor: formatBRLFinanceiro(soma(pagas, (x) => Number(x.valor_pago ?? x.valor))), icone: HandCoins },
        { rotulo: "Em atraso no mês", valor: m.filter((x) => x.status === "atrasado").length, destaque: m.some((x) => x.status === "atrasado"), icone: AlertTriangle, href: "?filtro=atrasados" },
        { rotulo: "Taxa de administração do mês", valor: formatBRLFinanceiro(soma(pagas, (x) => Number(x.valor_pago ?? x.valor) - Number(x.valor_repasse ?? 0))), icone: Percent },
      ]} />
      <nav className="flex flex-wrap items-center gap-2">
        <Link href={`?mes=${navegar(-1)}`} className={aba(false)}>‹</Link>
        <Link href={`?mes=${mes}`} className={aba(filtro === "mes")}>{nomeMes}</Link>
        <Link href={`?mes=${navegar(1)}`} className={aba(false)}>›</Link>
        <Link href="?filtro=atrasados" className={aba(filtro === "atrasados")}>Todos os atrasados</Link>
        <Link href="?filtro=repasses" className={aba(filtro === "repasses")}>Repasses a fazer</Link>
      </nav>
      <div className={TABELA_CAIXA}>
        <table className={TABELA}>
          <thead className={THEAD}><tr>
            <th className={TH}>Contrato</th><th className={TH}>Inquilino</th><th className={TH}>Vencimento</th><th className={TH}>Aluguel</th>
            <th className={TH}>Situação</th><th className={TH}>Repasse</th><th className={TH}></th>
          </tr></thead>
          <tbody className={TBODY}>
            {parcelas.map((p) => (
              <tr key={p.id} className={TR}>
                <td className={TD}><span className={CODIGO}>{p.contrato?.codigo}</span><span className="block text-xs text-texto-2">{p.contrato?.endereco}</span></td>
                <td className={TD}>{p.contrato?.inquilino_nome}<span className="block text-xs text-texto-2">{p.contrato?.inquilino_telefone}</span></td>
                <td className={TD}>{br(p.vencimento)}<span className="block text-xs text-texto-2">ref. {p.competencia.slice(5, 7)}/{p.competencia.slice(0, 4)}</span></td>
                <td className={TD}>{formatBRLFinanceiro(Number(p.valor))}{p.valor_pago != null && Number(p.valor_pago) !== Number(p.valor) && <span className="block text-xs text-texto-2">pago {formatBRLFinanceiro(Number(p.valor_pago))}</span>}</td>
                <td className={TD}><span className={p.status === "atrasado" ? "font-semibold text-critico" : ""}>{STATUS[p.status] ?? p.status}</span>{p.pago_em && <span className="block text-xs text-texto-2">em {br(p.pago_em)}</span>}</td>
                <td className={TD}>
                  {p.status === "pago" ? <>{REPASSE[p.repasse_status]} {formatBRLFinanceiro(Number(p.valor_repasse ?? 0))}
                    <span className="block text-xs text-texto-2">{p.repasse_status === "repassado" ? `em ${br(p.repasse_em)}` : `até ${br(p.repasse_vencimento)} · ${p.contrato?.proprietario_nome}${p.contrato?.proprietario_pix ? " · Pix " + p.contrato.proprietario_pix : ""}`}</span></> : "—"}
                </td>
                <td className={TD}><AcoesParcela id={p.id} status={p.status} repasse={p.repasse_status} valor={Number(p.valor)} /></td>
              </tr>
            ))}
            {!parcelas.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-texto-2">Nenhuma parcela aqui. Cadastre um contrato em “Contratos de locação”; as parcelas do mês saem sozinhas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
