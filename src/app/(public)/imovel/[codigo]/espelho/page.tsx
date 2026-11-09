import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CabecalhoPagina, Conteudo } from "@/components/ui/Pagina";
import { carregarEspelhoPublico, lerEmpreendimento } from "@/lib/empreendimento/espelho";
import EspelhoPublico from "@/components/empreendimento/EspelhoPublico";

export const metadata: Metadata = { title: "Lotes disponíveis" };
export const revalidate = 300;

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
  const { unidades, geometrias } = await carregarEspelhoPublico(emp);
  if (!unidades.length) notFound();
  return (
    <>
      <CabecalhoPagina variante="faixa" compacta eyebrow={emp.municipio ?? "Loteamento"} titulo={emp.titulo}
        subtitulo="Lotes disponíveis e indisponíveis. Toque num lote para ver a área e o preço." />
      <Conteudo className="space-y-6 py-8 md:py-10">
        <Link href={`/imovel/${emp.codigo}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-texto-2 hover:text-verde">
          <ArrowLeft className="size-4" /> Ver o empreendimento
        </Link>
        <EspelhoPublico unidades={unidades} geometrias={geometrias} />
      </Conteudo>
    </>
  );
}
