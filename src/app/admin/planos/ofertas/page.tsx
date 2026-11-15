import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { currentUser } from "@/lib/supabase/server";
import type { OfertaPerfil } from "@/lib/ofertas-perfis";
import EditarOfertas from "./EditarOfertas";

export default async function PaginaOfertas() {
  await exigirSetor("diretoria");
  const [user, { data, error }] = await Promise.all([
    currentUser(), supabaseAdmin().from("ofertas_perfis").select("*").order("ordem"),
  ]);
  return <div className="mx-auto max-w-5xl space-y-6">
    <CabecalhoPagina variante="simples" eyebrow="Diretoria" titulo="Ofertas por perfil"
      subtitulo="Preços, prazos, limites e complementos apresentados nas páginas de acesso, leilões, instituições, empresas e financiamento." />
    {error ? <p role="alert">A tabela de ofertas está indisponível.</p> :
      <EditarOfertas ofertas={(data ?? []) as OfertaPerfil[]} podeEditar={user?.role === "admin_central"} />}
  </div>;
}
