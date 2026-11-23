import { CabecalhoPagina } from "@/components/ui/Pagina";
import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkoutAtivo } from "@/lib/assinaturas-cotadas";
import FilaSolicitacoes from "./FilaSolicitacoes";

/** Contagem de um filtro; null quando a consulta falha (a tela mostra "—"). */
async function contar(consulta: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count, error } = await consulta;
  return error ? null : count ?? 0;
}

const diasAtras = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

export default async function SolicitacoesPlanos() {
  await exigirSetor("financeiro", "diretoria");
  const db = supabaseAdmin();
  const trintaDias = diasAtras(30);
  // Painel de acompanhamento (áudio do Carlos, 23/11/2026): onde cada venda está parada.
  const [naCentral, aguardandoAceite, aguardandoPagamento, pagos] = await Promise.all([
    contar(db.from("solicitacoes_planos").select("id", { count: "exact", head: true }).in("status", ["pendente", "em_analise"])),
    contar(db.from("assinaturas_cotadas").select("id", { count: "exact", head: true }).is("aceite", null).is("cancelado", null)),
    contar(db.from("faturas_cotadas").select("id", { count: "exact", head: true }).in("status", ["aberta", "vencida"]).is("operacao", null)),
    contar(db.from("faturas_cotadas").select("id", { count: "exact", head: true }).eq("status", "paga").gte("pagamento_confirmado_em", trintaDias)),
  ]);
  const cobranca = checkoutAtivo();
  const cartoes: [string, number | null, string][] = [
    ["Pedidos na Central", naCentral, "Pendentes ou em análise, sem proposta liberada"],
    ["Aguardando aceite", aguardandoAceite, "Proposta liberada, o cliente ainda não aceitou"],
    ["Aguardando pagamento", aguardandoPagamento, "Faturas abertas ou vencidas no Asaas"],
    ["Pagos em 30 dias", pagos, "Faturas confirmadas pelo Asaas"],
  ];
  return (
    <div className="mx-auto max-w-[1280px] space-y-8">
      <CabecalhoPagina eyebrow="Central · Financeiro" titulo="Planos: pedidos e pagamentos"
        subtitulo="Planos por conta com preço fechado são contratados e pagos direto pelo site. Planos sob orçamento, de escritório técnico ou com complementos especiais chegam aqui para a Central liberar." />
      <p role="status" className={"rounded-lg border px-4 py-3 text-sm " + (cobranca ? "border-verde/40 bg-verde/10" : "border-critico/40 bg-critico/10")}>
        {cobranca ? "Cobrança pelo Asaas ligada: Pix, boleto e cartão saem na hora da contratação."
          : "Cobrança pelo Asaas desligada neste servidor (falta ASAAS_API_KEY ou ASAAS_WEBHOOK_TOKEN). Sem ela ninguém consegue pagar um plano."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cartoes.map(([titulo, valor, dica]) => <div key={titulo} className="cartao p-4">
          <p className="text-sm text-texto-2">{titulo}</p>
          <p className="lp-display text-3xl">{valor ?? "—"}</p>
          <p className="text-xs text-texto-2">{dica}</p>
        </div>)}
      </div>
      <FilaSolicitacoes />
    </div>
  );
}
