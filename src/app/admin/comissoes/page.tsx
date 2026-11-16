import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatBRLFinanceiro as formatBRL } from "@/lib/format";
import ComissaoBotoes from "./ComissaoBotoes";
import Recebimentos from "./Recebimentos";
import Paginacao from "@/components/admin/Paginacao";
import { lerEmLotes, paginaDe } from "@/lib/supabase/lotes";
import { exigirSetor } from "@/lib/setores-servidor";
import { CODIGO, TABELA, TABELA_CAIXA, TBODY, TH, THEAD, TR } from "@/components/admin/estilos";
import { CircleDollarSign, Handshake, Percent, Wallet } from "lucide-react";
import { CabecalhoPagina, Estatistica, Etiqueta, Vazio } from "@/components/ui/Pagina";

const TOM: Record<string, "ouro" | "alerta" | "verde" | "neutro"> = {
  registrada: "ouro", cobrada: "alerta", paga: "verde", conciliada: "verde",
};

const LABEL: Record<string, string> = {
  registrada: "Registrada", cobrada: "Cobrada", paga: "Paga", conciliada: "Conciliada",
};

const POR_PAGINA = 50;

export default async function AdminComissoes({ searchParams }: PageProps<"/admin/comissoes">) {
  await exigirSetor("financeiro");
  const sp = await searchParams;
  const { pagina, de, ate } = paginaDe(sp.pagina, POR_PAGINA);
  const admin = supabaseAdmin();
  // tabela paginada; os totais leem só valor+status de todas, em lotes
  // (o PostgREST corta cada pedido em 1000 linhas sem avisar)
  const [{ data: comissoes, count, error: erroLista }, { data: todas, error: erroTotais }] = await Promise.all([
    admin.from("comissoes_oficiais")
      .select(`
        id, base_calculo, percentual, valor, regra_contratual, status, pago_em, created_at, recebido, autorizacao_id, captador_id,
        captador:partners(razao_social,perfil:profiles!partners_profile_id_fkey(nome)),
        parcelas:comissao_recebimentos(id,referencia,recebido_em,valor,repasse,repassado,em_conferencia,motivo_conferencia),
        sale:sales(data_venda, opportunity:opportunities(codigo), property:properties(codigo, titulo))
      `, { count: "exact" })
      .order("created_at", { ascending: false }).order("id").range(de, ate),
    lerEmLotes<{ valor: number; recebido: number | null; status: string }>((i, f) => admin.from("comissoes_oficiais").select("valor, recebido, status").order("id").range(i, f), { maximo: Infinity }),
  ]);

  if (erroLista || erroTotais) return <Vazio icone={Percent} titulo="Comissões indisponíveis" texto="Atualize a página para consultar os recebimentos." />;
  const recebido = todas.reduce((total, c) => total + Number(c.recebido ?? (["paga","conciliada"].includes(c.status) ? c.valor : 0)),0);
  const pendente = todas.reduce((total,c) => total + Number(c.valor),0) - recebido;

  return (
    <div className="space-y-8">
      <CabecalhoPagina eyebrow="Financeiro" titulo="Comissões"
        subtitulo="Comissão de cada venda, do registro à conciliação." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Estatistica icone={Wallet} urgente={pendente > 0}
          valor={<span className="tabular-nums">{formatBRL(pendente)}</span>} rotulo="A receber" />
        <Estatistica icone={CircleDollarSign}
          valor={<span className="tabular-nums text-verde">{formatBRL(recebido)}</span>} rotulo="Recebido" />
        <Estatistica icone={Handshake} valor={<span className="tabular-nums">{count ?? todas.length}</span>} rotulo="Vendas com comissão" />
      </div>

      {!comissoes?.length ? (
        <Vazio icone={Percent} titulo="Nenhuma comissão ainda"
          texto="Elas nascem automaticamente ao registrar uma venda." />
      ) : (
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead>
              <tr className={THEAD}>
                <th className={TH}>Venda</th>
                <th className={TH}>Imóvel</th>
                <th className={TH}>Base</th>
                <th className={TH}>%</th>
                <th className={TH}>Comissão</th>
                <th className={TH}>Status</th>
                <th className={TH}></th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {comissoes.map((c) => {
                const captador = c.captador as unknown as {razao_social: string | null; perfil: {nome: string} | null} | null;
                const sale = c.sale as unknown as { data_venda: string; opportunity: { codigo: string } | null; property: { codigo: string; titulo: string } | null } | null;
                return (
                  <tr key={c.id} className={TR}>
                    <td className="px-4 py-3.5 whitespace-nowrap"><span className={CODIGO}>{sale?.opportunity?.codigo}</span><span className="block text-sm text-texto-2 tabular-nums">{sale ? new Date(sale.data_venda + "T12:00:00").toLocaleDateString("pt-BR") : ""}</span></td>
                    <td className="px-4 py-3.5"><span className="font-medium text-texto">{sale?.property?.titulo}</span><span className={"block mt-0.5 " + CODIGO}>{sale?.property?.codigo}</span></td>
                    <td className="px-4 py-3.5 tabular-nums whitespace-nowrap">{formatBRL(c.base_calculo)}</td>
                    <td className="px-4 py-3.5 tabular-nums">{Number(c.percentual).toLocaleString("pt-BR")}%</td>
                    <td className="px-4 py-3.5 tabular-nums whitespace-nowrap font-bold text-texto">{formatBRL(c.valor)}</td>
                    <td className="px-4 py-3.5"><Etiqueta tom={TOM[c.status] ?? "neutro"}>{LABEL[c.status]}{c.pago_em ? ` em ${new Date(c.pago_em + "T12:00:00").toLocaleDateString("pt-BR")}` : ""}</Etiqueta></td>
                    <td className="px-4 py-3.5 text-right">
                      {(!c.autorizacao_id || c.status !== "cobrada") && <ComissaoBotoes id={c.id} status={c.status} />}
                      {c.autorizacao_id && <Recebimentos id={c.id} recebido={Number(c.recebido)} parcelas={c.parcelas ?? []}
                        captador={c.captador_id ? captador?.razao_social || captador?.perfil?.nome || c.captador_id : null} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Paginacao caminho="/admin/comissoes" pagina={pagina} porPagina={POR_PAGINA} total={count} />
    </div>
  );
}
