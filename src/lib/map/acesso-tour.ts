import "server-only";
import { permiteItem, personaDaMatriz, type NivelItem } from "@/lib/direitos-persona";
import type { Acesso } from "@/lib/planos";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CamadaOficialId } from "./camadasOficiais";
import type { RelevoId } from "@/components/map/camadasRelevo";
import type { TemaCar } from "@/lib/geo/temasCar";

const itensCamadas: Record<CamadaOficialId, number[]> = {
  sigef: [50, 64], snci: [50, 65], credito_rural: [56, 860], outorgas_federais: [52, 111],
  ibama_embargos: [52, 97], anm: [58], funai: [50, 94], ucs: [52, 96], quilombolas: [50],
  prodes_cerrado: [52, 98], inpe_queimadas: [52, 128], ibge_biomas: [52, 821],
  aneel_transmissao: [58], aneel_hidreletricas: [58], aneel_termeletricas: [58], aneel_solar: [58],
  iphan_sitios: [50], ana_rios: [52, 109],
};
const itensRelevo: Record<RelevoId, number> = { sombra: 119, altitude: 121, curvas: 122, declividade: 120, hidrografia: 109 };
const itensAmbientais: Record<TemaCar | "nascente", number> = { area_imovel:62, app:88, reserva_legal:89, vegetacao_nativa:90,
  area_consolidada:91, uso_restrito:92, servidao_administrativa:53, hidrografia:109, area_pousio:91, nascente:107 };
export type TemaTour = keyof typeof itensAmbientais;
export type CamadasTour = { oficiais: CamadaOficialId[]; relevo: RelevoId[]; ambiente: TemaTour[] };

export async function direitosDoTour(acesso: Acesso, entrada: string | null, anuncio: boolean): Promise<CamadasTour | null> {
  if (!anuncio && !acesso.recursos.has("consulta_area")) return null;
  const oficiais = Object.keys(itensCamadas) as CamadaOficialId[];
  const relevo = Object.keys(itensRelevo) as RelevoId[];
  const ambiente = Object.keys(itensAmbientais) as TemaTour[];
  if (acesso.equipe) return { oficiais, relevo, ambiente };
  const persona = personaDaMatriz(acesso.nicho, entrada);
  if (!persona) return { oficiais: [], relevo: [], ambiente: [] };
  const ids = [...new Set([123, ...Object.values(itensCamadas).flat(), ...Object.values(itensRelevo), ...Object.values(itensAmbientais)])];
  const { data, error } = await supabaseAdmin().rpc("fn_niveis_itens_persona", {
    p_persona: persona, p_plano: acesso.vencido ? null : acesso.planId, p_itens: ids,
  });
  if (error) {
    console.error("Falha ao conferir as permissões das camadas do tour", error.code);
    return anuncio ? { oficiais: [], relevo: [], ambiente: [] } : null;
  }
  const niveis = new Map((data as NivelItem[]).map(n => [n.id, n]));
  // O nível P requer a liberação específica destes itens no plano vigente.
  const pode = (id: number) => permiteItem(niveis.get(id), "consultar", false, anuncio);
  if (!anuncio && !pode(123)) return null;
  return { oficiais: oficiais.filter(c => itensCamadas[c].every(pode)), relevo: relevo.filter(c => pode(itensRelevo[c])),
    ambiente: ambiente.filter(c => pode(52) && pode(itensAmbientais[c])) };
}
