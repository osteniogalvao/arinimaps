import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { OG_NOME_SITE } from "@/lib/compartilhar";
import { formatArea, formatBRL } from "@/lib/format";
import AbrirLinkExclusivo from "./AbrirLinkExclusivo";

export const dynamic = "force-dynamic";

type Imovel = { codigo: string; tipo: "urbano" | "rural"; titulo: string; valor: number | null; area_m2: number | null; municipio: { nome: string; uf: string } | null };

/** Só lê o link: a prévia do WhatsApp e a página não gastam o uso único. */
async function ler(token: string) {
  if (!ehUuid(token)) return null;
  const admin = supabaseAdmin();
  const { data: l } = await admin.from("links_exclusivos").select("codigo, destinatario").eq("token", token).maybeSingle();
  if (!l) return null;
  const { data } = await admin.rpc("fn_property_public", { p_codigo: l.codigo });
  return { link: l as { codigo: string; destinatario: string | null }, imovel: data as Imovel | null };
}

const resumoDe = (im: Imovel) => [formatBRL(im.valor), im.area_m2 ? formatArea(im.area_m2, im.tipo) : null,
  im.municipio ? `${im.municipio.nome}/${im.municipio.uf}` : null].filter(Boolean).join(" · ");

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const r = await ler((await params).token);
  if (!r?.imovel) return { title: "Link exclusivo", robots: { index: false } };
  const titulo = `Tour 3D exclusivo · ${r.imovel.titulo}`;
  const descricao = `${resumoDe(r.imovel)} — link de uso único, abre em um só aparelho.`;
  return {
    title: titulo, description: descricao, robots: { index: false, follow: false },
    openGraph: {
      type: "website", siteName: OG_NOME_SITE, locale: "pt_BR", title: titulo, description: descricao,
      // o card mostra a área no satélite com a divisa (áudio do Carlos, 18/11, 9h27)
      images: [{ url: `/og/imovel/${r.imovel.codigo}`, width: 1200, height: 630, alt: titulo }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function LinkExclusivo({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await ler(token);
  if (!r?.imovel) notFound();
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#0A2219] px-4 py-10 text-[#F2F2EC]">
      <div className="w-full max-w-md space-y-4 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#D3DCD2]">Tour 3D exclusivo · {r.imovel.codigo}</p>
        <h1 className="lp-display text-3xl">{r.imovel.titulo}</h1>
        <p className="text-sm text-[#B3C3B8]">{resumoDe(r.imovel)}</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/og/imovel/${r.imovel.codigo}`} alt="A área do imóvel no satélite" className="w-full rounded-2xl border border-[#F2F2EC]/15" />
        <AbrirLinkExclusivo token={token} />
        <p className="text-xs text-[#B3C3B8]">Este link é de uso único: ele fica com o primeiro aparelho que o abre e não funciona se for repassado.</p>
      </div>
    </main>
  );
}
