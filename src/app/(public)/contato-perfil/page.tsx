import { notFound } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { Conteudo } from "@/components/ui/Pagina";
import { currentUser } from "@/lib/supabase/server";
import { PERSONAS_PLANOS } from "@/lib/planos";
import FormContato from "./FormContato";

type Busca = Promise<{ perfil?: string; oferta?: string; complementos?: string }>;

export default async function ContatoPerfil({ searchParams }: { searchParams: Busca }) {
  const busca = await searchParams;
  const perfil = PERSONAS_PLANOS.find(p => p.id === busca.perfil);
  if (!perfil) notFound();
  const conta = await currentUser();
  const proposta = perfil.id === "instituicao" || perfil.id === "empresa";
  return <>
    <SiteHeader />
    <Conteudo className="max-w-3xl py-10">
      <Link className="text-verde" href={`/planos?perfil=${perfil.id}`}>Voltar aos planos</Link>
      <h1 className="lp-display mt-5 text-3xl">{proposta ? "Solicitar proposta" : "Registrar interesse"}</h1>
      <p className="my-4 text-texto-2">{perfil.nome} · A equipe ARINI responde por e-mail.</p>
      <FormContato perfil={perfil.nome} proposta={proposta} oferta={String(busca.oferta ?? "").slice(0,200)}
        complementos={String(busca.complementos ?? "").slice(0,600)} nome={conta?.nome ?? ""} email={conta?.email ?? ""} />
    </Conteudo>
  </>;
}

