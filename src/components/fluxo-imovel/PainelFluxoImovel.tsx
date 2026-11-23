import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { setoresDe } from "@/lib/setores";
import { eventosFluxo } from "@/lib/fluxo-imovel-servidor";
import type { Material } from "@/lib/fluxo-imovel";
import FluxoImovel from "./FluxoImovel";

/** Bloco do fluxo de divulgação na ficha do imóvel. Some enquanto a migration 0157 não rodou. */
export default async function PainelFluxoImovel({ propertyId }: { propertyId: string }) {
  const { data, error } = await supabaseAdmin().from("properties").select("marketing_status, marketing_material").eq("id", propertyId).maybeSingle();
  if (error || !data) return null;
  const user = await currentUser();
  const setores = user ? setoresDe(user.role, user.setores) : [];
  const eventos = (await eventosFluxo([propertyId])).get(propertyId) ?? [];
  return (
    <section className="cartao space-y-4 p-6">
      <div>
        <h2 className="lp-display text-xl text-texto md:text-2xl">Divulgação: Marketing e Diretoria</h2>
        <p className="mt-1 text-sm text-texto-2">Como na Arini: a captação envia ao Marketing, o Marketing sobe o material e a Diretoria aprova antes de divulgar.</p>
      </div>
      <FluxoImovel propertyId={propertyId} status={data.marketing_status} material={(data.marketing_material ?? []) as Material[]} eventos={eventos}
        pode={{ operacoes: setores.includes("operacoes"), marketing: setores.includes("marketing"), diretoria: setores.includes("diretoria") }} />
    </section>
  );
}
