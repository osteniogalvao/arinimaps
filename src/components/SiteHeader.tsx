import { currentUser } from "@/lib/supabase/server";
import { lerConfiguracoes, texto } from "@/lib/settings";
import CabecalhoSite from "@/components/landing/CabecalhoSite";
import { cotacoesFaixa } from "@/lib/mercado/cotacoes";

/**
 * Cabeçalho do site institucional (página inicial, suporte, termos). A área de
 * consultas — mapa, busca, relatórios, painel — usa o AppShell com sidebar;
 * aqui é um site comum, com navegação no topo e o mesmo design system.
 *
 * `sobreHero`: só a página inicial — o cabeçalho fica por cima do carrossel,
 * transparente, e vira sólido ao rolar. Nas demais páginas ele é "grudado"
 * (sticky) e sólido, ocupando o próprio espaço.
 */
export default async function SiteHeader({ sobreHero = false }: { sobreHero?: boolean }) {
  // cotações da faixa do topo: do banco, com cache de 15 min (nunca lança)
  const [user, cfg, cotacoes] = await Promise.all([currentUser(), lerConfiguracoes(), cotacoesFaixa()]);
  const painelHref =
    user?.role === "admin_central" || user?.role === "analista_arini" ? "/admin" : "/painel";

  return (
    <CabecalhoSite
      sobreHero={sobreHero}
      whatsapp={texto(cfg, "whatsapp_central") || undefined}
      email={texto(cfg, "email_contato") || undefined}
      usuario={user ? { nome: user.nome?.split(" ")[0] || "Painel", href: painelHref } : null}
      cotacoes={cotacoes}
    />
  );
}
