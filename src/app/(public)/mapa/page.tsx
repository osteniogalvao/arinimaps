import type { Metadata } from "next";
import dynamicImport from "next/dynamic";
import { CENTRO_REGIAO, LIMITES_MAPA_REGIONAL, SATELITE, SATELITE_GOOGLE, TILE_DETALHE, TILE_GOOGLE, URL_MAPLIBRE, ZOOM_INICIAL_REGIONAL } from "@/lib/map/config";
import { CHAVE_PREFERENCIAS } from "@/lib/preferencias";
import Moldura from "@/components/shell/Moldura";
import { currentUser } from "@/lib/supabase/server";
import { acessoDe } from "@/lib/planos-servidor";
import { versaoDosLotes } from "@/lib/geo/versaoLotes";
import AjudaTour from "@/components/ajuda/AjudaTour";
import AvisoCartografia from "@/components/map/AvisoCartografia";
import { lerConfiguracoes, texto } from "@/lib/settings";

const MapaRegional = dynamicImport(() => import("@/components/map/MapaRegional"));

export const metadata: Metadata = {
  title: "Mapa Interativo",
  description: "Navegue pelo mapa da região e encontre fazendas, sítios e imóveis urbanos à venda.",
};

export default async function PaginaMapa() {
  const user = await currentUser();
  // planos por nicho: o mapa recebe os recursos da conta e esconde o que o
  // plano não libera (a trava de verdade fica nas rotas da API)
  const [acesso, versaoLotes, cfg] = await Promise.all([acessoDe(user?.id), versaoDosLotes(), lerConfiguracoes()]);
  // aviso de cartografia em manutenção (Carlos, 19/11): liga/desliga e texto no admin
  const avisoCartografia = cfg.aviso_cartografia_ativo === false ? "" : texto(cfg, "aviso_cartografia_texto");
  const usuario = user
    ? { nome: user.nome || "Conta", papel: acesso.equipe ? "Matriz" : acesso.planNome ?? "Usuário" }
    : null;

  return (
    <Moldura usuario={usuario} cheia>
      <link rel="modulepreload" href={URL_MAPLIBRE} />
      <script
        async fetchPriority="high" src="/precarregar-satelite.js?v=5"
        data-fonte={SATELITE_GOOGLE ? TILE_GOOGLE : TILE_DETALHE} data-maxzoom={SATELITE.maxzoom} data-tile-size={256}
        data-tamanho-fixo={SATELITE_GOOGLE ? "1" : undefined}
        data-camera={JSON.stringify([...CENTRO_REGIAO, ZOOM_INICIAL_REGIONAL])}
        data-limites={JSON.stringify(LIMITES_MAPA_REGIONAL)} data-preferencias={CHAVE_PREFERENCIAS}
      />
      {avisoCartografia && <AvisoCartografia texto={avisoCartografia} />}
      <MapaRegional recursos={[...acesso.recursos]} logado={!!user} versaoLotes={versaoLotes} />
      {/* tour de primeira visita + botão Ajuda (2ª etapa, item 14). No celular fica
          abaixo dos cartões do mapa (z-5), para não tampar o que a pessoa tocou. */}
      <AjudaTour perfil="mapa" className="fixed bottom-56 right-3 z-[5] sm:z-30 lg:bottom-36" />
    </Moldura>
  );
}
