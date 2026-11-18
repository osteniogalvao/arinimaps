import type { Metadata } from "next";
import dynamicImport from "next/dynamic";
import { CENTRO_REGIAO, LIMITES_MAPA_REGIONAL, SATELITE, TILE_DETALHE, URL_MAPLIBRE, ZOOM_INICIAL_REGIONAL } from "@/lib/map/config";
import { CHAVE_PREFERENCIAS } from "@/lib/preferencias";
import Moldura from "@/components/shell/Moldura";
import { currentUser } from "@/lib/supabase/server";
import { acessoDe } from "@/lib/planos-servidor";
import { versaoDosLotes } from "@/lib/geo/versaoLotes";
import AjudaTour from "@/components/ajuda/AjudaTour";

const MapaRegional = dynamicImport(() => import("@/components/map/MapaRegional"));

export const metadata: Metadata = {
  title: "Mapa Interativo",
  description: "Navegue pelo mapa da região e encontre fazendas, sítios e imóveis urbanos à venda.",
};

export default async function PaginaMapa() {
  const user = await currentUser();
  // planos por nicho: o mapa recebe os recursos da conta e esconde o que o
  // plano não libera (a trava de verdade fica nas rotas da API)
  const [acesso, versaoLotes] = await Promise.all([acessoDe(user?.id), versaoDosLotes()]);
  const usuario = user
    ? { nome: user.nome || "Conta", papel: acesso.equipe ? "Matriz" : acesso.planNome ?? "Usuário" }
    : null;

  return (
    <Moldura usuario={usuario} cheia>
      <link rel="modulepreload" href={URL_MAPLIBRE} />
      <script
        async fetchPriority="high" src="/precarregar-satelite.js?v=4"
        data-fonte={TILE_DETALHE} data-maxzoom={SATELITE.maxzoom} data-tile-size={256}
        data-camera={JSON.stringify([...CENTRO_REGIAO, ZOOM_INICIAL_REGIONAL])}
        data-limites={JSON.stringify(LIMITES_MAPA_REGIONAL)} data-preferencias={CHAVE_PREFERENCIAS}
      />
      <MapaRegional recursos={[...acesso.recursos]} logado={!!user} versaoLotes={versaoLotes} />
      {/* tour de primeira visita + botão Ajuda (2ª etapa, item 14). No celular fica
          abaixo dos cartões do mapa (z-5), para não tampar o que a pessoa tocou. */}
      <AjudaTour perfil="mapa" className="fixed bottom-56 right-3 z-[5] sm:z-30 lg:bottom-36" />
    </Moldura>
  );
}
