import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, Building2, FileText, Layers, LifeBuoy, PlayCircle, Ruler, ScanSearch, Search, Sparkles, Upload,
  type LucideIcon,
} from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { CabecalhoPagina, Conteudo } from "@/components/ui/Pagina";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import BotaoAri from "./BotaoAri";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Central de ajuda",
  description: "Passo a passo de cada ferramenta do Arini Imóveis Brasil e respostas para as dúvidas mais comuns.",
};

/**
 * Central de ajuda (2ª etapa do cliente, item 14). Passo a passo por
 * ferramenta (base: docs/MANUAL.md §4), perguntas frequentes e os artigos
 * publicados da base de conhecimento da Ari (kb_artigos, editados em
 * Marketing › Conhecimento). Sem a tabela ou sem artigos, a seção some.
 */

type Ferramenta = { id: string; icone: LucideIcon; titulo: string; passos: string[]; link?: { href: string; rotulo: string } };

const FERRAMENTAS: Ferramenta[] = [
  {
    id: "busca", icone: Search, titulo: "Buscar imóveis",
    passos: [
      "Abra o Mapa Interativo ou a página Imóveis.",
      "Digite o município, o código do anúncio (AIB-000000) ou parte do nome do imóvel.",
      "Use os filtros Rural, Urbano e Leilão para estreitar a lista.",
      "Clique no imóvel para ver fotos, divisa, valor e pontos de interesse com a distância.",
    ],
    link: { href: "/mapa?tour=1", rotulo: "Abrir o mapa com o tour" },
  },
  {
    id: "camadas", icone: Layers, titulo: "Camadas e dados oficiais",
    passos: [
      "No mapa, toque em Camadas e Dados.",
      "Ligue o que precisa: CAR, embargos ambientais, focos de queimada, processos minerários, biomas.",
      "Clique numa área para ver o que cada fonte diz sobre ela, com órgão e data.",
      "Algumas camadas dependem do plano; as travadas aparecem com cadeado.",
    ],
    link: { href: "/mapa?camada=car", rotulo: "Abrir o CAR no mapa" },
  },
  {
    id: "medir", icone: Ruler, titulo: "Desenhar e medir",
    passos: [
      "Na barra Ferramentas do mapa, escolha Medir Área ou Medir Distância.",
      "Clique nos vértices; o duplo clique encerra o desenho.",
      "A medida usa a geodésia (a mesma conta de campo), não os pixels da tela.",
      "Limpe o desenho pelo X ao lado do resultado.",
    ],
  },
  {
    id: "consulta", icone: ScanSearch, titulo: "Consultar uma área",
    passos: [
      "Em Ferramentas, escolha Consultar Área e contorne a área (qualquer lugar do Brasil).",
      "Feche o desenho com duplo clique e toque em Consultar fontes oficiais.",
      "Em 10 a 40 segundos sai o relatório com cada fonte, órgão e data. Conta uma consulta do plano.",
    ],
    link: { href: "/mapa?ferramenta=consulta", rotulo: "Consultar uma área" },
  },
  {
    id: "kml", icone: Upload, titulo: "Importar KML e capturar",
    passos: [
      "Em Ferramentas, Importar KML abre arquivos .kml e .kmz (Google Earth, GPS).",
      "Imprimir e Capturar Imagem salvam a vista atual do mapa.",
      "Essas ferramentas dependem do plano.",
    ],
  },
  {
    id: "anunciar", icone: Building2, titulo: "Anunciar um imóvel",
    passos: [
      "Entre na sua conta e vá em Painel › Anunciar.",
      "Preencha os dados, marque a divisa no mapa (desenho, ponto, KML, área do CAR ou lote) e envie fotos.",
      "Anexe a matrícula (ou escritura registrada): nenhum imóvel é publicado sem a Arini conferir.",
      "Aceite os termos e envie. Você acompanha a análise em Meus imóveis.",
    ],
    link: { href: "/painel/novo", rotulo: "Anunciar agora" },
  },
  {
    id: "cadastro-ari", icone: Sparkles, titulo: "Cadastro rápido com a Ari",
    passos: [
      "No topo de Anunciar, abra Cadastro rápido com a Ari.",
      "Cole a descrição que você já tem e anexe fotos e documentos (matrícula, CAR, escritura).",
      "A Ari preenche o formulário, separa os documentos e sugere a ordem e a capa das fotos.",
      "Os campos preenchidos pela Ari ficam com contorno dourado: confira cada um antes de enviar.",
    ],
    link: { href: "/painel/novo", rotulo: "Experimentar" },
  },
  {
    id: "painel", icone: FileText, titulo: "Painel e documentos",
    passos: [
      "Meus imóveis mostra cada anúncio e em que ponto está a análise.",
      "Na página do anúncio você envia documentos novos (com versões) e propõe alterações.",
      "Oportunidades lista os interessados que a Arini encaminhou.",
    ],
    link: { href: "/painel?tour=1", rotulo: "Abrir o painel com o tour" },
  },
];

const PERGUNTAS: { p: string; r: string }[] = [
  { p: "O CAR comprova que o imóvel é meu?", r: "Não. O CAR é um cadastro ambiental declarado pelo próprio dono. A propriedade se comprova pela matrícula no cartório de registro de imóveis, e é ela que a Arini confere antes de publicar." },
  { p: "Quanto tempo leva para o anúncio ser publicado?", r: "Depois do envio, a equipe confere documentos, divisa e a consulta territorial. Se faltar algo, você recebe o pedido de correção no painel. O andamento aparece em Meus imóveis." },
  { p: "Meus documentos ficam públicos?", r: "Não. Matrícula, escritura, selfie e demais documentos ficam em área privada: só você e a equipe da Arini veem. O site mostra apenas \"matrícula conferida\", nunca o número." },
  { p: "Por que algumas ferramentas aparecem com cadeado?", r: "Elas fazem parte de planos pagos. O cadeado leva aos planos, onde você vê o que cada um libera." },
  { p: "Não encontrei meu imóvel no mapa. E agora?", r: "No mapa, toque em \"Não encontrei meu imóvel\" e descreva a situação. A equipe de cartografia analisa e ajusta o mapa." },
  { p: "A Ari pode errar?", r: "Pode. Ela responde com os dados publicados e com a base de conhecimento da Arini, e no cadastro rápido só preenche o que leu. Confira sempre; em caso de dúvida, fale com o suporte." },
  { p: "Como vejo o tour de novo?", r: "Pelo botão Ajuda, no canto da tela do mapa, do painel e da Central: Ver o tour de novo." },
];

async function artigosPublicados() {
  try {
    const { data, error } = await supabaseAdmin().from("kb_artigos")
      .select("id, titulo, conteudo").eq("status", "publicado")
      .order("updated_at", { ascending: false }).limit(30);
    if (error) return [];
    return (data ?? []) as { id: string; titulo: string; conteudo: string }[];
  } catch {
    return [];
  }
}

export default async function Ajuda() {
  const [user, artigos] = await Promise.all([currentUser(), artigosPublicados()]);
  const usuario = user ? { nome: user.nome || "Conta", papel: "Usuário" } : null;

  return (
    <Moldura usuario={usuario}>
      <CabecalhoPagina
        variante="faixa"
        eyebrow="Central de ajuda"
        titulo="Como usar o"
        destaque="Arini"
        subtitulo="Passo a passo de cada ferramenta, respostas para as dúvidas mais comuns e, se faltar algo, a Ari e a equipe de suporte."
        acoes={<BotaoAri />}
      />

      <div>
        <Conteudo className="space-y-14 py-12 md:py-16">
          <nav aria-label="Ferramentas" className="flex flex-wrap gap-2">
            {FERRAMENTAS.map((f) => (
              <a key={f.id} href={`#${f.id}`}
                className="inline-flex items-center gap-2 rounded-full border border-linha-forte px-4 py-2 text-sm text-texto-3 transition hover:border-ouro hover:text-texto">
                <f.icone className="size-4" /> {f.titulo}
              </a>
            ))}
          </nav>

          <section aria-labelledby="passo-a-passo" className="space-y-5">
            <h2 id="passo-a-passo" className="lp-display text-2xl text-texto md:text-3xl">Passo a passo por ferramenta</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {FERRAMENTAS.map((f) => (
                <article key={f.id} id={f.id} className="cartao scroll-mt-28 p-5 md:p-6">
                  <header className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><f.icone className="size-5" /></span>
                    <h3 className="lp-display text-xl text-texto">{f.titulo}</h3>
                  </header>
                  <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-texto-2 marker:font-semibold marker:text-ouro">
                    {f.passos.map((p) => <li key={p}>{p}</li>)}
                  </ol>
                  {f.link && (
                    <Link href={f.link.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-verde">
                      {f.link.rotulo} <ArrowRight className="size-4" />
                    </Link>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="perguntas" className="space-y-5">
            <h2 id="perguntas" className="lp-display text-2xl text-texto md:text-3xl">Perguntas frequentes</h2>
            <div className="divide-y divide-linha rounded-2xl border border-linha">
              {PERGUNTAS.map((q) => (
                <details key={q.p} className="group px-5 py-4">
                  <summary className="cursor-pointer list-none text-base font-semibold text-texto marker:hidden">
                    <span className="flex items-start justify-between gap-4">
                      {q.p}
                      <span aria-hidden className="text-ouro transition group-open:rotate-45">+</span>
                    </span>
                  </summary>
                  <p className="mt-2 text-[15px] leading-relaxed text-texto-2">{q.r}</p>
                </details>
              ))}
            </div>
          </section>

          {artigos.length > 0 && (
            <section aria-labelledby="artigos" className="space-y-5">
              <div>
                <h2 id="artigos" className="lp-display text-2xl text-texto md:text-3xl">Da base de conhecimento</h2>
                <p className="mt-1.5 text-base text-texto-2">Os mesmos artigos que a Ari usa para responder, mantidos pela equipe da Arini.</p>
              </div>
              <div className="divide-y divide-linha rounded-2xl border border-linha">
                {artigos.map((a) => (
                  <details key={a.id} className="group px-5 py-4">
                    <summary className="cursor-pointer list-none text-base font-semibold text-texto marker:hidden">
                      <span className="flex items-start justify-between gap-4">
                        {a.titulo}
                        <span aria-hidden className="text-ouro transition group-open:rotate-45">+</span>
                      </span>
                    </summary>
                    <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-texto-2">
                      {a.conteudo.length > 2500 ? a.conteudo.slice(0, 2500) + "…" : a.conteudo}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          )}

          <section className="cartao flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div>
              <p className="lp-display text-2xl text-texto">Não achou o que procurava?</p>
              <p className="mt-1.5 text-base text-texto-2">Pergunte à Ari, reveja o tour ou fale com a equipe.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <BotaoAri />
              <Link href="/mapa?tour=1" className="inline-flex items-center gap-1.5 rounded-full border border-linha-forte px-4 py-2 text-sm font-semibold text-texto transition hover:border-verde">
                <PlayCircle className="size-4" /> Ver o tour
              </Link>
              <Link href="/suporte" className="inline-flex items-center gap-1.5 rounded-full border border-linha-forte px-4 py-2 text-sm font-semibold text-texto transition hover:border-verde">
                <LifeBuoy className="size-4" /> Suporte
              </Link>
            </div>
          </section>
        </Conteudo>
      </div>
    </Moldura>
  );
}
