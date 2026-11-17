import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { equipeAtiva } from "@/components/admin/Painel";
import NovoLeadForm from "@/components/crm-comercial/NovoLeadForm";

/** Lead que chegou por ligação, balcão, indicação, evento ou portal: entra pela Central. */
export default async function NovoLead({ searchParams }: PageProps<"/admin/leads/novo">) {
  const user = await exigirSetor("comercial");
  const sp = await searchParams;
  const [{ data: imoveis }, equipe] = await Promise.all([
    supabaseAdmin().from("properties").select("codigo, titulo, status")
      .not("status", "in", "(vendido,historico,reprovado)").eq("demonstracao", false)
      .order("codigo", { ascending: false }).limit(2000)
      .then(async (r) => (r.error
        ? await supabaseAdmin().from("properties").select("codigo, titulo, status").not("status", "in", "(vendido,historico,reprovado)").order("codigo", { ascending: false }).limit(2000)
        : r)),
    equipeAtiva(),
  ]);
  return (
    <div className="max-w-3xl space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Novo lead"
        subtitulo="Para quem chegou por ligação, balcão, indicação, evento ou portal. O lead entra no funil e, se você escolher, passa pelo rodízio." />
      <NovoLeadForm
        imoveis={(imoveis ?? []).map((i) => ({ codigo: i.codigo, titulo: i.titulo }))}
        equipe={equipe.map((m) => ({ id: m.user_id, nome: m.nome }))}
        eu={user.id}
        codigoInicial={typeof sp.imovel === "string" ? sp.imovel : ""}
      />
    </div>
  );
}
