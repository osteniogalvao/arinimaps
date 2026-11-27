"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Acesso simultâneo (limites por assinatura, 26/11/2026): com a conta aberta,
 * confere a cada 2 minutos e ao voltar para a aba se este aparelho ainda é da
 * conta. Quando outro aparelho entrou depois (e o plano só permite um), encerra
 * a sessão aqui e leva para o login com o aviso.
 */
export default function VigiaAparelho() {
  useEffect(() => {
    let parado = false;
    let ocupado = false;
    async function conferir() {
      if (parado || ocupado || document.visibilityState === "hidden") return;
      ocupado = true;
      try {
        const { data } = await supabaseBrowser().auth.getSession();
        if (!data.session) return;
        const r = await fetch("/api/conta/aparelho", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json() as { ativo?: boolean };
        if (d.ativo === false && !parado) {
          parado = true;
          await supabaseBrowser().auth.signOut({ scope: "local" }).catch(() => undefined);
          window.location.assign("/entrar?outro_aparelho=1");
        }
      } catch { /* sem rede: tenta na próxima */ }
      finally { ocupado = false; }
    }
    const primeira = setTimeout(conferir, 4000);
    const intervalo = setInterval(conferir, 120_000);
    const aoVoltar = () => { if (document.visibilityState === "visible") void conferir(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { parado = true; clearTimeout(primeira); clearInterval(intervalo); document.removeEventListener("visibilitychange", aoVoltar); };
  }, []);
  return null;
}
