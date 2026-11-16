import AppShell, { type Usuario } from "./AppShell";
import SiteHeader from "@/components/SiteHeader";
import RodapeSite from "@/components/landing/RodapeSite";
import ChatIA from "@/components/ia/ChatIA";
import { lerConfiguracoes, texto } from "@/lib/settings";

/**
 * Moldura das páginas públicas (08/10/2026): a casca do sistema (sidebar,
 * barra do topo) é só para quem está logado. Visitante vê a página com o
 * cabeçalho e o rodapé do site, como a página inicial.
 *
 *  · `site`  — sempre no estilo do site, mesmo logado (ex.: /planos);
 *  · `cheia` — tela cheia (mapa): sem rodapé, altura da janela.
 */
export default async function Moldura({
  usuario, children, site = false, cheia = false,
}: {
  usuario: Usuario;
  children: React.ReactNode;
  site?: boolean;
  cheia?: boolean;
}) {
  if (usuario && !site) {
    return <AppShell usuario={usuario} semPadding cheia={cheia}>{children}</AppShell>;
  }

  if (cheia) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-fundo">
        <SiteHeader />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        <ChatIA />
      </div>
    );
  }

  const cfg = await lerConfiguracoes();
  const contato = {
    whatsapp: texto(cfg, "whatsapp_central") || undefined,
    email: texto(cfg, "email_contato") || undefined,
    telefone: texto(cfg, "telefone_contato") || undefined,
    site: texto(cfg, "sobre_site") || undefined,
  };
  return (
    <div className="flex min-h-screen flex-col bg-fundo">
      <SiteHeader />
      <main className="flex flex-1 flex-col">{children}</main>
      <RodapeSite marca={texto(cfg, "nome_sistema", "ARINI")} contato={contato} />
      {/* respiro no fim da página: o botão flutuante do assistente não cobre o rodapé */}
      <div aria-hidden className="h-16 sm:h-0" />
      <ChatIA flutuante />
    </div>
  );
}
