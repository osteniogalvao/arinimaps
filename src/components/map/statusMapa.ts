import { STATUS_CORES } from "@/lib/map/config";

/**
 * Cor do imóvel à venda no mapa. Áudio do Carlos (23/11/2026, 13h42): o verde
 * do "publicado" sumia no meio da malha verde do CAR e do satélite. Pediu uma
 * cor "mais viva, mais sólida, que demonstre presença". O magenta é o oposto
 * do verde no círculo de cores, então não se confunde com a malha, com o
 * satélite nem com o amarelo da seleção.
 */
export const COR_A_VENDA = "#FF2EB4";

/** Cores de status dos imóveis no mapa (pinos, divisas, legenda): STATUS_CORES, com o à venda em destaque. */
export const STATUS_MAPA: Record<string, string> = { ...STATUS_CORES, publicado: COR_A_VENDA };

/** Cor do anel do radar (Oliva) e do ponto (Dourado): marcador de localização do manual. */
export const RADAR_ANEL = "#998C54";
