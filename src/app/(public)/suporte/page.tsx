import type { Metadata } from "next";
import { Clock, MessagesSquare, ShieldCheck } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import { CabecalhoPagina, Conteudo } from "@/components/ui/Pagina";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import FormSuporte from "./FormSuporte";
import MeusChamados, { type Chamado } from "./MeusChamados";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Suporte",
  description: "Fale com a equipe da ARINI: dúvidas, problemas, anúncios, cobrança e dados pessoais.",
};

export default async function Suporte({ searchParams }: PageProps<"/suporte">) {
  const [user, sp] = await Promise.all([currentUser(), searchParams]);
  const admin = supabaseAdmin();

  // veio de /planos ("Falar com a Arini"): assunto já preenchido com o plano
  let assuntoInicial = "";
  const assuntoParam = typeof sp.assunto === "string" ? sp.assunto : "";
  const planoPedido = /^plano:([a-z][a-z0-9_]{2,40})$/.exec(assuntoParam)?.[1];
  if (planoPedido) {
    const { data: plano } = await admin.from("plans").select("nome").eq("id", planoPedido).maybeSingle();
    assuntoInicial = `Quero contratar o plano ${plano?.nome ?? planoPedido}`;
  } else if (assuntoParam) {
    assuntoInicial = assuntoParam.slice(0, 120);
  }

  let chamados: Chamado[] = [];
  if (user) {
    const { data: tickets } = await admin.from("support_tickets")
      .select("id, codigo, assunto, status, created_at, updated_at, avaliacao:support_avaliacoes(nota,comentario,created_at)")
      .eq("user_id", user.id).order("updated_at", { ascending: false }).limit(30);
    const ids = (tickets ?? []).map((t) => t.id);
    const { data: msgs } = ids.length
      ? await admin.from("support_messages")
          .select("id, ticket_id, autor_nome, da_equipe, corpo, created_at")
          .in("ticket_id", ids).eq("interno", false).order("created_at")
      : { data: [] };
    chamados = (tickets ?? []).map((t) => ({ ...t, avaliacao:Array.isArray(t.avaliacao)?t.avaliacao[0]??null:t.avaliacao, mensagens: (msgs ?? []).filter((m) => m.ticket_id === t.id) }));
  }

  return (
    <div className="min-h-screen bg-fundo">
      <SiteHeader />
      <CabecalhoPagina
        variante="faixa"
        eyebrow="Suporte"
        titulo="Como podemos"
        destaque="ajudar?"
        subtitulo={
          <>
            Escreva para a equipe. Respondemos por e-mail em horário comercial
            {user ? ", e a conversa continua aqui embaixo, ao vivo: quando a equipe responde, a mensagem aparece sem recarregar." : ". Com uma conta, a conversa também acontece nesta página, ao vivo."}
          </>
        }
      />

      <main>
        <Conteudo className="py-12 md:py-16">
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-12">
              <FormSuporte nome={user?.nome ?? ""} email={user?.email ?? ""} logado={!!user} assuntoInicial={assuntoInicial} />
              {user && <MeusChamados chamados={chamados} />}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-28">
              {[
                { icone: Clock, titulo: "Horário comercial", texto: "A equipe responde por e-mail em horário comercial." },
                { icone: MessagesSquare, titulo: "Conversa ao vivo", texto: "Com uma conta, a conversa continua nesta página e a resposta aparece sem recarregar." },
                { icone: ShieldCheck, titulo: "Dados pessoais (LGPD)", texto: "Pedidos sobre dados pessoais vão para o encarregado de dados e são respondidos em até 15 dias." },
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
