import { STATUS_CORES } from "@/lib/map/config";

/**
 * Cor do imóvel à venda no mapa. Áudio do Carlos (23/11/2026, 13h42): o verde
 * do "publicado" sumia no meio da malha verde do CAR e do satélite. Pediu uma
 * cor "mais viva, mais sólida, que demonstre presença". O magenta é o oposto
 * do verde no círculo de cores, então não se confunde com a malha, com o
 * satélite nem com o amarelo da seleção.
 *
 * Áudio do Carlos (23/11/2026, 14h35): o magenta "não ficou legal"; pediu um
 * dourado mais destacado, com as bordas mais destacadas. Este é um dourado
 * vivo, mais saturado e escuro que o Dourado do leilão (#D9BD6F) e que o
 * amarelo da seleção do CAR (#FFD400), para não se confundir com eles. A borda
 * escura de baixo (camada "imoveis-contorno") ficou mais grossa e firme.
 */
export const COR_A_VENDA = "#F0A818";

/** Cores de status dos imóveis no mapa (pinos, divisas, legenda): STATUS_CORES, com o à venda em destaque. */
export const STATUS_MAPA: Record<string, string> = { ...STATUS_CORES, publicado: COR_A_VENDA };

/** Cor do anel do radar (Oliva) e do ponto (Dourado): marcador de localização do manual. */
export const RADAR_ANEL = "#998C54";
