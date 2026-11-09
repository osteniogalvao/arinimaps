import type { Metadata } from "next";
import { OG_IMAGEM_PADRAO, OG_NOME_SITE, urlDoSite } from "@/lib/compartilhar";
import { Geist_Mono, League_Gothic, Quicksand } from "next/font/google";
import "./globals.css";
import { TEMA_SCRIPT } from "@/components/shell/BotaoTema";

// Tipografia do Manual de Identidade Visual v1.0 (out/2026):
// Quicksand — textos, interface, legendas e botões (e os subtítulos da interface).
const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Morganite — títulos e chamadas, sempre em caixa alta. A Morganite não está no
// Google Fonts e o PDF do manual só traz um recorte dela (sem Ç, Ã, Õ…); até
// chegarem os arquivos .woff2 completos, a League Gothic (mesmas proporções
// ultracondensadas, acentuação completa) ocupa o lugar. Para trocar: next/font/local
// com os arquivos da Morganite, mesma `variable`.
const titulo = League_Gothic({
  variable: "--font-titulo",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // links compartilhados (WhatsApp): imagens e URLs da prévia precisam ser absolutas
  metadataBase: new URL(urlDoSite()),
  openGraph: {
    type: "website", siteName: OG_NOME_SITE, locale: "pt_BR",
    images: [{ url: OG_IMAGEM_PADRAO, width: 1600, height: 900, alt: OG_NOME_SITE }],
  },
  title: {
    default: "Arini Imóveis Brasil — imóveis pelo mapa",
    template: "%s · Arini Imóveis Brasil",
  },
  // barra do navegador no celular no Verde Arini, a cor principal da marca
  other: { "theme-color": "#124431" },
  description:
    "Marketplace imobiliário regional: fazendas, sítios e imóveis urbanos direto no mapa, com intermediação da Arini Negócios Imobiliários.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${quicksand.variable} ${geistMono.variable} ${titulo.variable} h-full antialiased`}
      // o script do tema escreve data-tema aqui antes da hidratação; sem isto
      // o React reclama de atributo divergente em toda navegação
      suppressHydrationWarning
    >
      <head>
        {/* aplica o tema salvo antes da pintura, senão a tela pisca escura
            antes de virar clara a cada navegação */}
        <script dangerouslySetInnerHTML={{ __html: TEMA_SCRIPT }} />
        {/* servidores dos tiles do satélite: abre a conexão antes do mapa pedir */}
        <link rel="preconnect" href="https://wayback.maptiles.arcgis.com" crossOrigin="" />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
