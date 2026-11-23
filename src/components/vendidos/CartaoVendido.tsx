import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarDays, MapPin, Ruler } from "lucide-react";
import { fotoUrl, ondeTexto, rotuloTipo, textoDias, type Vendido } from "@/lib/vendidos";

/** Destino do chamado para quem quer vender (página aberta, sem login). */
export const LINK_ANUNCIE = "/planos";
export const TEXTO_ANUNCIE = "Quer vender seu imóvel assim?";

export function fotoDoVendido(v: Pick<Vendido, "foto" | "tipo">) {
  return v.foto ? fotoUrl(v.foto) : v.tipo === "rural" ? "/img/aerea-campo.jpg" : "/img/casa-urbana.jpg";
}

/**
 * Card de um vendido: foto, município e "Vendido em X dias", com link próprio
 * (/vendidos/[id]) e o chamado "Anuncie na ARINI". Sem nome, valor ou
 * localização exata (ver src/lib/vendidos.ts).
 */
export default function CartaoVendido({ v, prioridade = false }: { v: Vendido; prioridade?: boolean }) {
  const onde = ondeTexto(v);
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl bg-superficie ring-1 ring-linha transition hover:ring-verde/60">
      <Link href={`/vendidos/${v.id}`} className="flex flex-1 flex-col" aria-label={`${rotuloTipo(v)}${onde ? ` em ${onde}` : ""}, ${textoDias(v.dias).toLowerCase()}`}>
        <div className="relative aspect-[16/10] overflow-hidden bg-superficie-2">
          {/* foto do anúncio (Storage do Supabase): <img> com proporção fixa, sem salto */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fotoDoVendido(v)}
            alt=""
            loading={prioridade ? "eager" : "lazy"}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.05]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-transparent" aria-hidden="true" />
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[#D9BD6F] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#124431]">
            <BadgeCheck className="size-3.5" aria-hidden="true" /> Vendido
          </span>
          <p className="lp-display absolute bottom-3 left-4 right-4 text-2xl leading-tight text-white drop-shadow">
            {textoDias(v.dias)}
          </p>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 px-5 pb-3 pt-4">
          <p className="text-sm font-semibold uppercase tracking-[0.1em] text-texto-2">{rotuloTipo(v)}</p>
          {onde && (
            <p className="flex items-center gap-1.5 text-lg font-semibold text-texto">
              <MapPin className="size-4 shrink-0 text-verde" aria-hidden="true" /> {onde}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-texto-2">
            {v.area && <span className="inline-flex items-center gap-1.5"><Ruler className="size-4" aria-hidden="true" /> {v.area}</span>}
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden="true" /> {v.mes}</span>
          </p>
        </div>
      </Link>
      <Link
        href={LINK_ANUNCIE}
        className="mx-5 mb-5 mt-2 flex items-center justify-between gap-3 rounded-xl border border-linha px-4 py-3 text-[15px] leading-snug text-texto-2 transition hover:border-verde hover:text-texto"
      >
        <span>{TEXTO_ANUNCIE} <strong className="font-semibold text-verde">Anuncie na ARINI</strong></span>
        <ArrowRight className="size-4 shrink-0 text-verde" aria-hidden="true" />
      </Link>
    </article>
  );
}
