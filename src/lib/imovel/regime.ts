export const REGIMES_IMOVEL = {
  EXCLUSIVO_ARINI:"Intermediação ARINI",VENDA_PROPRIA_CRM:"Venda própria da empresa",LEILAO:"Leilão",EXPOSICAO:"Exposição institucional",
} as const;
export type RegimeImovel = keyof typeof REGIMES_IMOVEL;

