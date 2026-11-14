import Link from "next/link";
import { redirect } from "next/navigation";
import Moldura from "@/components/shell/Moldura";
import { CabecalhoPagina, Conteudo } from "@/components/ui/Pagina";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SITUACOES_PEDIDO, type PedidoPlano } from "@/lib/solicitacoes-planos";
import CancelarPedido from "./CancelarPedido";

export default async function MeusPedidos({ searchParams }: PageProps<"/planos/solicitacoes">) {
  const a = await ator();
  if (!a) redirect("/entrar?volta=/planos/solicitacoes");
  const pagina = Math.max(1, Math.min(100000, Math.floor(Number((await searchParams).pagina) || 1)));
  const inicio = (pagina - 1) * 20;
  const { data, error } = await supabaseAdmin().from("solicitacoes_planos").select("id,status,created_at,cotacao")
    .eq("user_id", a.userId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(inicio, inicio + 20);
  const pedidos = (data ?? []) as Pick<PedidoPlano, "id" | "status" | "created_at" | "cotacao">[];
  return <Moldura site usuario={{ nome: "Conta", papel: "Usuário" }}>
    <CabecalhoPagina titulo="Meus pedidos de planos" variante="faixa" compacta
      acoes={<Link href="/planos" className="lp-btn lp-btn-contorno">Ver planos</Link>} />
    <Conteudo className="space-y-4 py-10" estreito>
      {error ? <p role="alert">O histórico está indisponível. Atualize a página para tentar novamente.</p> :
        !pedidos.length && <p>Nenhum pedido nesta página.</p>}
      {pedidos.slice(0,20).map((p) => <article key={p.id} className="cartao space-y-3 p-5">
        <p className="text-sm text-texto-2">{new Date(p.created_at).toLocaleDateString("pt-BR", { timeZone:"America/Sao_Paulo" })} · {SITUACOES_PEDIDO[p.status]}</p>
        <h2 className="lp-display text-2xl">{p.cotacao.rotulo}</h2>
        <p>Plano {p.cotacao.ciclo} · {p.cotacao.totalCentavos === null ? "Sob orçamento" : (p.cotacao.totalCentavos/100).toLocaleString("pt-BR",{style:"currency", currency:"BRL"}) + (p.cotacao.ciclo === "anual" ? " em 12 meses" : " no primeiro mês")}</p>
        {p.cotacao.itens.length > 0 && <p>{p.cotacao.itens.map((i) => i.quantidade + " × " + i.nome).join(" · ")}</p>}
        {["pendente","em_analise"].includes(p.status) && <CancelarPedido id={p.id} />}
      </article>)}
      <nav aria-label="Páginas do histórico" className="flex gap-4">
        {pagina > 1 && <Link href={"?pagina=" + (pagina - 1)}>Página anterior</Link>}
        {pedidos.length > 20 && <Link href={"?pagina=" + (pagina + 1)}>Próxima página</Link>}
      </nav>
    </Conteudo>
  </Moldura>;
}
