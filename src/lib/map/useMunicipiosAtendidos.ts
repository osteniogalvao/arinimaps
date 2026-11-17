"use client";

import { useEffect, useState } from "react";
import type { MunicipioAtendido } from "@/lib/geo/atendimento";

let pedido: Promise<MunicipioAtendido[] | null> | null = null;

/**
 * Municípios onde a Arini anuncia, buscados uma vez por página. `null`
 * enquanto carrega ou se a busca falhar: aí o botão "anunciar" segue como
 * antes e quem barra é o servidor ao enviar o anúncio.
 */
export function useMunicipiosAtendidos(): MunicipioAtendido[] | null {
  const [lista, setLista] = useState<MunicipioAtendido[] | null>(null);
  useEffect(() => {
    let vivo = true;
    pedido ??= fetch("/api/geo/municipios-atendidos")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (Array.isArray(d?.municipios) && d.municipios.length ? d.municipios as MunicipioAtendido[] : null))
      .catch(() => null)
      .then((l) => { if (!l) pedido = null; return l; });
    pedido.then((l) => { if (vivo) setLista(l); });
    return () => { vivo = false; };
  }, []);
  return lista;
}
