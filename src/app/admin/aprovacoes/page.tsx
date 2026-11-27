import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { formatBRL, STATUS_LABEL } from "@/lib/format";
import { CabecalhoPagina, Etiqueta } from "@/components/ui/Pagina";
import { LINHA_LISTA, LINK_ACAO, LISTA, LISTA_VAZIA, CODIGO } from "@/components/admin/estilos";
import Resumo from "@/components/admin/Resumo";
import { ArrowRight } from "lucide-react";

export const metadata = { title: "Aprovações" };

const LIMITE = 8;
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

function Bloco({ titulo, total, href, rotuloLink, children, vazio }: {
    titulo: string; total: number; href: string; rotuloLink: string; children: React.ReactNode; vazio: boolean;
  }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="lp-display text-xl text-texto">{titulo} <span className="ml-1 text-base font-semibold text-texto-2 tabular-nums">{total}</span></h2>
        <Link href={href} className={LINK_ACAO}>{rotuloLink} <ArrowRight className="size-4" /></Link>
      </div>
      <div className={LISTA}>{vazio ? <p className={LISTA_VAZIA}>Nada esperando aprovação.</p> : children}</div>
    </section>
  );
}

/**
 * Caixa de aprovações (tela do CRM da Arini Negócios, para a Diretoria): tudo
 * o que espera um "sim" num lugar só, por etapa — imóveis para analisar,
 * material do Marketing, despesas e cadastros. Cada linha leva à tela onde a
 * decisão é tomada; aqui não se aprova nada às cegas.
 */
export default async function Aprovacoes() {
  await exigirSetor("diretoria");
  const admin = supabaseAdmin();
  const [imoveis, marketing, despesas, donos, parceiros] = await Promise.all([
    admin.from("properties").select("id, codigo, titulo, status, created_at", { count: "exact" })
      .eq("demonstracao", false).in("status", ["pendente", "em_analise"]).order("created_at").limit(LIMITE),
    admin.from("properties").select("id, codigo, titulo, marketing_enviado_em", { count: "exact" })
      .eq("marketing_status", "aguardando_aprovacao").order("marketing_enviado_em").limit(LIMITE),
    admin.from("despesas").select("id, codigo, descricao, valor, vencimento", { count: "exact" })
      .eq("status", "pendente").order("vencimento", { nullsFirst: false }).limit(LIMITE),
    admin.from("owners").select("id, status, created_at, profile:profiles(nome)", { count: "exact" })
      .in("status", ["solicitado", "em_analise", "pendente"]).order("created_at").limit(LIMITE),
    admin.from("partners").select("id, tipo, razao_social, status, created_at", { count: "exact" })
      .in("status", ["solicitado", "em_analise", "pendente"]).order("created_at").limit(LIMITE),
  ]);
  const n = (r: { count: number | null }) => r.count ?? 0;
  const cadastros = n(donos) + n(parceiros);


  return (
    <div className="space-y-8">
      <CabecalhoPagina eyebrow="Diretoria" titulo="Aprovações"
        subtitulo="Tudo o que espera decisão, por etapa, do mais antigo para o mais novo. Clique para abrir e decidir." />
      <Resumo itens={[
        { rotulo: "Imóveis", valor: n(imoveis), tom: n(imoveis) ? "ouro" : "neutro", href: "#imoveis" },
        { rotulo: "Marketing", valor: n(marketing), tom: n(marketing) ? "ouro" : "neutro", href: "#marketing" },
        { rotulo: "Despesas", valor: n(despesas), tom: n(despesas) ? "ouro" : "neutro", href: "#despesas" },
        { rotulo: "Cadastros", valor: cadastros, tom: cadastros ? "ouro" : "neutro", href: "#cadastros" },
      ]} />

      <div id="imoveis"><Bloco titulo="Imóveis para analisar" total={n(imoveis)} href="/admin/imoveis?filtro=analise" rotuloLink="Fila de análise" vazio={!imoveis.data?.length}>
        {(imoveis.data ?? []).map((p) => (
          <Link key={p.id} href={`/admin/imoveis/${p.id}`} className={LINHA_LISTA}>
            <span className={CODIGO}>{p.codigo}</span><span className="flex-1 min-w-40 font-medium text-texto">{p.titulo}</span>
            <Etiqueta tom="ouro">{STATUS_LABEL[p.status]}</Etiqueta><span className="text-sm text-texto-2">{dia(p.created_at)}</span>
          </Link>
        ))}
      </Bloco></div>

      <div id="marketing"><Bloco titulo="Material do Marketing" total={n(marketing)} href="/admin/marketing/fluxo?status=aguardando_aprovacao" rotuloLink="Imóveis para divulgar" vazio={!marketing.data?.length}>
        {(marketing.data ?? []).map((p) => (
          <Link key={p.id} href={`/admin/imoveis/${p.id}`} className={LINHA_LISTA}>
            <span className={CODIGO}>{p.codigo}</span><span className="flex-1 min-w-40 font-medium text-texto">{p.titulo}</span>
            <span className="text-sm text-texto-2">enviado em {dia(p.marketing_enviado_em)}</span>
          </Link>
        ))}
      </Bloco></div>

      <div id="despesas"><Bloco titulo="Despesas" total={n(despesas)} href="/admin/registros/despesas" rotuloLink="Despesas" vazio={!despesas.data?.length}>
        {(despesas.data ?? []).map((d) => (
          <Link key={d.id} href="/admin/registros/despesas" className={LINHA_LISTA}>
            <span className={CODIGO}>{d.codigo}</span><span className="flex-1 min-w-40 font-medium text-texto">{d.descricao}</span>
            <span className="tabular-nums">{formatBRL(Number(d.valor))}</span>
            {d.vencimento && <span className="text-sm text-texto-2">vence {dia(d.vencimento)}</span>}
          </Link>
        ))}
      </Bloco></div>

      <div id="cadastros"><Bloco titulo="Cadastros de proprietários e parceiros" total={cadastros} href="/admin/cadastros" rotuloLink="Cadastros" vazio={!donos.data?.length && !parceiros.data?.length}>
        {((donos.data ?? []) as unknown as { id: string; status: string; created_at: string; profile: { nome: string } | null }[]).map((d) => (
          <Link key={d.id} href="/admin/cadastros" className={LINHA_LISTA}>
            <span className="flex-1 min-w-40 font-medium text-texto">{d.profile?.nome || "Sem nome"}</span>
            <Etiqueta>Proprietário</Etiqueta><span className="text-sm text-texto-2">{dia(d.created_at)}</span>
          </Link>
        ))}
        {(parceiros.data ?? []).map((p) => (
          <Link key={p.id} href="/admin/cadastros" className={LINHA_LISTA}>
            <span className="flex-1 min-w-40 font-medium text-texto">{p.razao_social}</span>
            <Etiqueta className="capitalize">{String(p.tipo)}</Etiqueta><span className="text-sm text-texto-2">{dia(p.created_at)}</span>
          </Link>
        ))}
      </Bloco></div>
    </div>
  );
}
