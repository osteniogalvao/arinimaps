"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Radar } from "lucide-react";
import { RAIOS_CONSULTA, rotuloRaio } from "@/lib/rural/raios";

/**
 * Raio da pesquisa à vista, em chips (vídeo do Carlos, 17/11/2026 16h37: "a
 * pesquisa de raio tem que estar mais à vista, tá meio escondido"). Muda o
 * `raio_m` da página: vale para o anel no mapa, para o cruzamento com as
 * fontes oficiais (usinas, mineração, embargos...) e para o Tour 3D.
 */
export default function RaioDaConsulta({ raioM }: { raioM: number }) {
  const router = useRouter();
  const [mudando, navegar] = useTransition();
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">
        <Radar className="size-4 text-ouro" aria-hidden /> Raio da pesquisa
        {mudando && <LoaderCircle className="size-3.5 animate-spin" aria-label="Atualizando" />}
      </p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Raio da pesquisa">
        {RAIOS_CONSULTA.map((m) => {
          const ativo = m === raioM;
          return (
            <button key={m} type="button" role="radio" aria-checked={ativo} disabled={mudando}
              onClick={() => {
                if (ativo) return;
                const destino = new URL(window.location.href);
                destino.searchParams.set("raio_m", String(m));
                destino.searchParams.delete("tour");
                navegar(() => router.replace(destino.pathname + destino.search + destino.hash, { scroll: false }));
              }}
              className={"rounded-full border-2 px-3 py-1 text-xs font-bold transition disabled:opacity-60 " +
                (ativo ? "border-[#D9BD6F] bg-[#D9BD6F] text-[#124431]" : "border-linha text-texto hover:border-[#D9BD6F]")}>
              {m === 0 ? "Só a área" : `até ${rotuloRaio(m)}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
