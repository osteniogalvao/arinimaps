import Link from "next/link";
import { redirect } from "next/navigation";
import Moldura from "@/components/shell/Moldura";
import { CabecalhoPagina, Conteudo } from "@/components/ui/Pagina";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SITUACOES_PEDIDO, type PedidoPlano } from "@/lib/solicitacoes-planos";
import Contratacao, {type OfertaAssinatura} from "./Contratacao";
import {checkoutAtivo} from "@/lib/assinaturas-cotadas";
import CancelarPedido from "./CancelarPedido";

export default async function MeusPedidos({ searchParams }: PageProps<"/planos/solicitacoes">) {
  const pedido=(await searchParams).pedido;
  const individual=typeof pedido==="string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pedido);
  const a = await ator();
  if (!a) redirect("/entrar?volta="+encodeURIComponent("/planos/solicitacoes"+(individual?"?pedido="+pedido:"")));
  const pagina = Math.max(1, Math.min(100000, Math.floor(Number((await searchParams).pagina) || 1)));
  const inicio = (pagina - 1) * 20;
  const consulta = supabaseAdmin().from("solicitacoes_planos").select("id,status,created_at,cotacao,assinatura:assinaturas_cotadas(id,plano,assinatura_cartao(final,situacao),ciclo,primeira,recorrente,adicionais,escopo_confirmado,aceite,cancelado,arrependimento,assinatura_reajustes(id,vigencia,valor,condicoes,aceito_em,aplicado_em,avisado_em),faturas_cotadas(id,status,componente,inicio,fim,valor,link,link_estorno,tentativa_cartao,operacao,nfse_assinaturas(estado,numero,pdf_url,xml_url)))")
    .eq("user_id", a.userId);
  const {data,error}=await (individual?consulta.eq("id",pedido):consulta).order("created_at", { ascending: false }).order("id", { ascending: false }).range(inicio, inicio + 20);
  const {data:avisos}=await supabaseAdmin().from("assinatura_contatos").select("id,assinatura,texto,criado_em").eq("titular",a.userId)
    .in("assinatura",(data??[]).map(p=>p.id)).order("criado_em",{ascending:false}).limit(60);
  const pedidos = (data ?? []) as unknown as (Pick<PedidoPlano, "id" | "status" | "created_at" | "cotacao"> & {assinatura:OfertaAssinatura|null})[];
  const {data:ativas} = await supabaseAdmin().from("assinaturas_cotadas").select("id,nicho")
    .eq("titular",a.userId).not("aceite","is",null).is("cancelado",null);
  const ids = pedidos.map(p=>p.id).join(",");
  const {data:trocas} = ids ? await supabaseAdmin().from("assinatura_trocas").select("oferta,assinatura,tipo,status,novo,fim_ciclo,proporcional")
    .or(`assinatura.in.(${ids}),oferta.in.(${ids})`).order("ordem",{ascending:false}) : {data:[]};
  return <Moldura site usuario={{ nome: "Conta", papel: "Usuário" }}>
    <CabecalhoPagina titulo="Meus pedidos de planos" variante="faixa" compacta
      acoes={<Link href="/planos" className="lp-btn lp-btn-contorno">Ver planos</Link>} />
    <Conteudo className="space-y-4 py-10" estreito>
      <Link className="text-verde underline" href="/privacidade/preferencias">Configurar lembretes e avisos da assinatura pelo WhatsApp</Link>
      {error ? <p role="alert">O histórico está indisponível. Atualize a página para tentar novamente.</p> :
        !pedidos.length && <p>Nenhum pedido nesta página.</p>}
      {pedidos.slice(0,20).map((p) => <article key={p.id} id={individual ? "pagamento" : undefined} className="cartao scroll-mt-24 space-y-3 p-5">
        <p className="text-sm text-texto-2">{new Date(p.created_at).toLocaleDateString("pt-BR", { timeZone:"America/Sao_Paulo" })} · {SITUACOES_PEDIDO[p.status]}</p>
        <h2 className="lp-display text-2xl">{p.cotacao.rotulo}</h2>
        <p>Plano {p.cotacao.ciclo} · {p.cotacao.totalCentavos === null ? "Sob orçamento" : (p.cotacao.totalCentavos/100).toLocaleString("pt-BR",{style:"currency", currency:"BRL"}) + (p.cotacao.ciclo === "anual" ? " em 12 meses" : " no primeiro mês")}</p>
        {p.cotacao.itens.length > 0 && <p>{p.cotacao.itens.map((i) => i.quantidade + " × " + i.nome).join(" · ")}</p>}
        {individual && p.assinatura?.aceite && !p.assinatura.cancelado && p.assinatura.faturas_cotadas.some(f=>["aberta","vencida","nova","emitindo"].includes(f.status)) &&
          <p className="rounded-lg border border-verde/40 bg-verde/10 px-4 py-3 text-sm">Falta só o pagamento. Use o Pix abaixo ou abra a fatura no Asaas para pagar com boleto ou cartão. O plano libera na conta assim que o Asaas confirmar. Se a fatura ainda estiver em emissão, toque em Atualizar faturas.</p>}
        {p.assinatura && p.status!=="cancelado" && <Contratacao s={p.assinatura} ativo={checkoutAtivo()}
          temPlano={!!ativas?.some(s=>s.id!==p.id && s.nicho===(p.cotacao.personaId==="profissional_tecnico"?"engenheiro":p.cotacao.personaId))}
          trocas={(trocas??[]).filter(t=>t.assinatura===p.id || t.oferta===p.id)}/>}
        {avisos?.some(av=>av.assinatura===p.id) && <details><summary className="cursor-pointer">Avisos da assinatura</summary>
          <ul className="mt-2 space-y-2">{avisos.filter(av=>av.assinatura===p.id).map(av=><li key={av.id}>{av.texto} <small>· {new Date(av.criado_em).toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"})}</small></li>)}</ul></details>}
        {["pendente","em_analise"].includes(p.status) && <CancelarPedido id={p.id} />}
      </article>)}
      {individual && <Link className="underline" href="/planos/solicitacoes">Ver todos os pedidos</Link>}
      <nav aria-label="Páginas do histórico" className="flex gap-4">
        {pagina > 1 && <Link href={"?pagina=" + (pagina - 1)}>Página anterior</Link>}
        {pedidos.length > 20 && <Link href={"?pagina=" + (pagina + 1)}>Próxima página</Link>}
      </nav>
    </Conteudo>
  </Moldura>;
}
