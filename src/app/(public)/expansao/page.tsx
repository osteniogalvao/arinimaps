import type { Metadata } from "next";
import { Handshake, LineChart, MapPinned } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import { CabecalhoPagina, Conteudo } from "@/components/ui/Pagina";
import { currentUser } from "@/lib/supabase/server";
import FormExpansao from "./FormExpansao";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Faça parte da Arini",
  description: "Expansão Arini: invista com a Arini, leve a plataforma para a sua região e construa uma parceria.",
};

/**
 * "Expansão Arini" (revisão do Carlos, 29/10, seção 3.1.5): formulário curto
 * que filtra o interesse e cai na fila de suporte da equipe como chamado
 * "Expansão Arini", para a Arini analisar e retomar o contato formalmente.
 */
export default async function Expansao() {
  const user = await currentUser();
  return (
    <div className="min-h-screen bg-fundo">
      <SiteHeader />
      <CabecalhoPagina
        variante="faixa"
        eyebrow="Expansão Arini"
        titulo="Invista com"
        destaque="a Arini."
        subtitulo="Conecte seu negócio à tecnologia ARINI e descubra novas possibilidades de expansão. Conte um pouco sobre você: a equipe analisa e entra em contato para uma conversa formal."
      />
      <main>
        <Conteudo className="py-12 md:py-16">
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
            <FormExpansao nome={user?.nome ?? ""} email={user?.email ?? ""} logado={!!user} />
            <aside className="space-y-4 lg:sticky lg:top-28">
              {[
                { icone: LineChart, titulo: "Oportunidade de investimento", texto: "Participe de uma plataforma que conecta território, inteligência e negócios imobiliários." },
                { icone: MapPinned, titulo: "Desenvolvimento regional", texto: "Leve a ARINI para a sua cidade ou região, com a cartografia e as informações oficiais do território." },
                { icone: Handshake, titulo: "Construindo parceria", texto: "Cada proposta é analisada pela equipe Arini, que retorna para alinhar os próximos passos." },
              ].map(({ icone: Icone, titulo, texto }) => (
                <div key={titulo} className="cartao flex gap-4 p-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde">
                    <Icone className="size-5" />
                  </span>
                  <div>
                    <p className="lp-display text-lg text-texto">{titulo}</p>
                    <p className="mt-1 text-[15px] leading-relaxed text-texto-2">{texto}</p>
                  </div>
                </div>
              ))}
            </aside>
          </div>
        </Conteudo>
      </main>
    </div>
  );
}
