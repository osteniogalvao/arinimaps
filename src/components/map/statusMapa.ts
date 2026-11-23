import { STATUS_CORES } from "@/lib/map/config";

/**
 * Cor do imóvel à venda no mapa. Áudio do Carlos (23/11/2026, 13h42): o verde
 * do "publicado" sumia no meio da malha verde do CAR e do satélite; pediu uma
 * cor "mais viva, mais sólida, que demonstre presença". O primeiro teste foi
 * magenta, que ele achou "rosa, tipo fúcsia" (áudio de 14h35) e trocou por um
 * dourado mais destacado, com as bordas mais marcadas. É um ouro vivo, mais
 * saturado que o Dourado do manual (#D9BD6F, usado no leilão) e mais alaranjado
 * que o amarelo da seleção do CAR (#FFD400), para não se confundir com eles.
 */
export const COR_A_VENDA = "#F0B400";

/** Cores de status dos imóveis no mapa (pinos, divisas, legenda): STATUS_CORES, com o à venda em destaque. */
export const STATUS_MAPA: Record<string, string> = { ...STATUS_CORES, publicado: COR_A_VENDA };

/** Cor do anel do radar (Oliva) e do ponto (Dourado): marcador de localização do manual. */
export const RADAR_ANEL = "#998C54";
