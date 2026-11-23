import Link from "next/link";
import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { aba, CODIGO } from "@/components/admin/estilos";
import { FLUXO_ORDEM, FLUXO_STATUS, type Material } from "@/lib/fluxo-imovel";
import { eventosFluxo } from "@/lib/fluxo-imovel-servidor";
import FluxoImovel from "@/components/fluxo-imovel/FluxoImovel";
import ExigirAprovacao from "./ExigirAprovacao";

export const metadata = { title: "Imóveis para divulgar" };

/**
 * Fluxo captação → Marketing → Diretoria (migration 0157), no molde da Arini:
 * o Marketing só recebe o que a captação enviou, sobe o material editado e a
 * Diretoria aprova antes da divulgação.
 */
export default async function FluxoDivulgacao({ searchParams }: PageProps<"/admin/marketing/fluxo">) {
  const user = await exigirSetor("marketing", "operacoes", "diretoria");
  const q = await searchParams;
  const admin = supabaseAdmin();
  const filtro = typeof q.status === "string" && FLUXO_STATUS[q.status] ? q.status : "abertos";
  let consulta = admin.from("properties").select("id, codigo, titulo, status, marketing_status, marketing_material, marketing_enviado_em")
    .not("marketing_status", "is", null).order("marketing_enviado_em", { ascending: false }).limit(200);
  consulta = filtro === "abertos" ? consulta.neq("marketing_status", "aprovado") : consulta.eq("marketing_status", filtro);
  const [{ data, error }, exige, contagem] = await Promise.all([
    consulta,
    admin.from("settings").select("valor").eq("chave", "publicacao_exige_marketing").maybeSingle(),
    admin.from("properties").select("marketing_status").not("marketing_status", "is", null).limit(5000),
  ]);
  if (error) {
    return (
      <div className="space-y-4">
        <CabecalhoPagina titulo="Imóveis para divulgar" eyebrow="Marketing" />
        <p className="cartao p-5" role="alert">Falta rodar a migration 0157 (Aluguéis, caixa e fluxo do imóvel) no Supabase.</p>
      </div>
    );
  }
  const conta = (s: string) => (contagem.data ?? []).filter((x) => x.marketing_status === s).length;
  const imoveis = data ?? [];
  const eventos = await eventosFluxo(imoveis.map((i) => i.id));
  const pode = { operacoes: user.setores.includes("operacoes"), marketing: user.setores.includes("marketing"), diretoria: user.setores.includes("diretoria") };

  return (
    <div className="space-y-5">
      <CabecalhoPagina titulo="Imóveis para divulgar" eyebrow="Marketing" />
      <p className="text-sm text-texto-2">
        Operações envia o imóvel pela ficha dele (Imóveis &gt; abrir &gt; “Enviar ao Marketing”). O Marketing inicia a produção, sobe os links do material e envia
        para a Diretoria, que aprova ou pede ajustes.
      </p>
      {pode.diretoria && <ExigirAprovacao ligado={exige.data?.valor === true} />}
      <nav className="flex flex-wrap gap-2">
        <Link href="?" className={aba(filtro === "abertos")}>Em andamento</Link>
        {FLUXO_ORDEM.map((s) => <Link key={s} href={`?status=${s}`} className={aba(filtro === s)}>{FLUXO_STATUS[s]} ({conta(s)})</Link>)}
      </nav>
      <div className="grid gap-4 xl:grid-cols-2">
        {imoveis.map((i) => (
          <article key={i.id} id={i.id} className={"cartao space-y-3 p-5 " + (q.imovel === i.id ? "border-ouro" : "")}>
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <p><span className={CODIGO}>{i.codigo}</span> <strong>{i.titulo}</strong></p>
              {pode.operacoes && <Link href={`/admin/imoveis/${i.id}`} className="text-xs text-verde underline">Abrir ficha</Link>}
            </header>
            <FluxoImovel propertyId={i.id} status={i.marketing_status} material={(i.marketing_material ?? []) as Material[]} eventos={eventos.get(i.id) ?? []} pode={pode} />
          </article>
        ))}
        {!imoveis.length && <p className="cartao px-5 py-10 text-center text-texto-2 xl:col-span-2">Nenhum imóvel nesta etapa.</p>}
      </div>
    </div>
  );
}
