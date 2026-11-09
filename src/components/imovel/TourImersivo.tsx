"use client";

import { useState } from "react";
import { Rotate3d, ExternalLink } from "lucide-react";
import { lerTour, PROVEDOR_TOUR_LABEL } from "@/lib/imovel/tour";

/**
 * Tour virtual 360 / vídeo imersivo na ficha pública (item 9).
 *
 * O iframe NÃO carrega com a página: até o clique fica só a capa (foto do
 * anúncio, se houver) com "Clique para abrir o tour". Assim o Matterport ou o
 * YouTube não pesam no carregamento de quem só quer ver as fotos.
 */
export default function TourImersivo({ url, poster, titulo }: { url: string; poster?: string | null; titulo: string }) {
  const [aberto, setAberto] = useState(false);
  const tour = lerTour(url);
  if (!tour) return null;
  const nome = PROVEDOR_TOUR_LABEL[tour.provedor];

  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-[20px] border border-linha bg-[#0A2219]">
        {aberto ? (
          <iframe
            src={tour.embed}
            title={`Tour virtual — ${titulo}`}
            loading="lazy"
            allow="autoplay; fullscreen; xr-spatial-tracking; gyroscope; accelerometer; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <button type="button" onClick={() => setAberto(true)}
            className="group absolute inset-0 grid place-items-center text-[#F2F2EC]">
            {poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45 transition-opacity group-hover:opacity-35" />
            )}
            <span className="relative flex flex-col items-center gap-3 px-6 text-center">
              <span className="grid size-16 place-items-center rounded-full border border-[#D9BD6F] bg-[#0A2219]/70 text-[#D9BD6F] transition-transform group-hover:scale-105">
                <Rotate3d className="size-7" />
              </span>
              <span className="lp-display text-xl md:text-2xl">Clique para abrir o tour</span>
              <span className="text-sm text-[#B3C3B8]">{tour.provedor === "youtube" || tour.provedor === "vimeo" ? "Vídeo" : "Tour 360"} pelo {nome}</span>
            </span>
          </button>
        )}
      </div>
      <a href={tour.url} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-texto-2 hover:text-verde transition-colors">
        <ExternalLink className="size-4" /> Abrir no {nome}
      </a>
    </div>
  );
}
