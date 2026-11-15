import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CabecalhoPagina, Conteudo } from "@/components/ui/Pagina";
import { carregarEspelhoPublico, estoquePublico, lerConfigEspelho, lerEmpreendimento } from "@/lib/empreendimento/espelho";
import { supabaseServer } from "@/lib/supabase/server";
import { lerTour } from "@/lib/imovel/tour";
import TourImersivo from "@/components/imovel/TourImersivo";
import EspelhoPublico from "@/components/empreendimento/EspelhoPublico";

export const metadata: Metadata = { title: "Lotes disponíveis" };
export const dynamic = "force-dynamic";

/**
 * Versão pública do espelho de vendas: só disponível/indisponível. Sem nome
 * de cliente, prazo de reserva ou negociação (o servidor já reduz os dados).
 */
export default async function EspelhoPublicoPagina({ params }: PageProps<"/imovel/[codigo]/espelho">) {
  const { codigo } = await params;
  const { data: p } = await supabaseAdmin().from("properties").select("id")
    .eq("codigo", codigo).in("status", ["publicado", "em_negociacao", "vendido"]).maybeSingle();
  const emp = p ? await lerEmpreendimento(p.id) : null;
  if (!emp) notFound();
  const { data: sessao } = await (await supabaseServer()).auth.getClaims();
  const usuario = sessao?.claims.sub ?? null;
  const [{ unidades, geometrias }, estoque, config] = await Promise.all([
    carregarEspelhoPublico(emp), estoquePublico(emp.id, usuario), lerConfigEspelho(emp.id),
  ]);
  if (!unidades.length || !estoque) notFound();
  return (
    <>
      <CabecalhoPagina variante="faixa" compacta eyebrow={emp.municipio ?? "Loteamento"} titulo={emp.titulo}
        subtitulo="Consulte a área, o preço e a situação de cada lote." />
      <Conteudo className="space-y-6 py-8 md:py-10">
        <Link href={`/imovel/${emp.codigo}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-texto-2 hover:text-verde">
          <ArrowLeft className="size-4" /> Ver o empreendimento
        </Link>
        {config.pre_lancamento && <p className="font-semibold text-verde">Pré-lançamento</p>}
        <EspelhoPublico id={emp.id} codigo={emp.codigo} logado={!!usuario} catalogo={unidades} geometrias={geometrias} inicial={estoque} />
        {config.projeto_url && <section className="cartao space-y-3 p-5">
          <h2 className="lp-display text-2xl">Projeto 3D do empreendimento</h2>
          {lerTour(config.projeto_url) ? <TourImersivo url={config.projeto_url} titulo={emp.titulo} /> :
            <a href={config.projeto_url} target="_blank" rel="noopener noreferrer" className="text-verde underline">Abrir projeto 3D</a>}
        </section>}
      </Conteudo>
    </>
  );
}
