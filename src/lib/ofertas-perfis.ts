export type OfertaPerfil = {
  id: string;
  perfil: string;
  nome: string;
  descricao: string;
  modalidade: "mapa" | "cadastro" | "anuncio" | "espera" | "proposta" | "complemento";
  ciclo: "mensal" | "avulso" | "proposta" | "gratuito";
  preco_centavos: number | null;
  anual_centavos: number | null;
  prazo_dias: number | null;
  limites: string[];
  detalhes: string[];
  aplica_em: string[];
  ativo: boolean;
  ordem: number;
  revisao: number;
};

export const PERFIS_COM_VITRINE = ["comprar", "leiloeiro", "instituicao", "empresa", "anunciar", "correspondente"];
export const moedaOferta = (valor: number) =>
  (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function valorOferta(oferta: OfertaPerfil, anual = false) {
  if (anual && oferta.anual_centavos !== null) return moedaOferta(oferta.anual_centavos) + " / ano";
  if (oferta.preco_centavos === null) return "Sob consulta";
  if (oferta.preco_centavos === 0) return "Grátis";
  return moedaOferta(oferta.preco_centavos) + (oferta.ciclo === "mensal" ? " / mês" : " avulso");
}

export function urlAcaoOferta(oferta: OfertaPerfil, autenticado: boolean, anual: boolean, complementos: OfertaPerfil[]) {
  if (oferta.id === "comprar_creditos") return autenticado ? "/conta/creditos" : "/entrar?cadastro=1&papel=comprador&nicho=comprador_investidor&volta=%2Fconta%2Fcreditos";
  switch (oferta.modalidade) {
    case "mapa": return "/mapa";
    case "cadastro": return autenticado ? "/mapa" : "/entrar?cadastro=1&papel=comprador&nicho=comprador_investidor&volta=%2Fmapa";
    case "anuncio": return autenticado ? "/painel/novo" : "/entrar?cadastro=1&papel=proprietario&nicho=proprietario&volta=%2Fpainel%2Fnovo";
    default: {
      const params = new URLSearchParams({ perfil: oferta.perfil, oferta: oferta.nome + (anual && oferta.anual_centavos !== null ? " (anual)" : "") });
      const selecionados = complementos.filter((c) => c.ativo && c.modalidade === "complemento" && c.aplica_em.includes(oferta.id));
      if (selecionados.length) params.set("complementos", selecionados.map((c) => c.nome).join(", "));
      return "/contato-perfil?" + params;
    }
  }
}

export function textoAcaoOferta(oferta: OfertaPerfil, autenticado: boolean) {
  if (oferta.id === "comprar_creditos") return "Ver carteira de créditos";
  if (oferta.modalidade === "mapa" || (oferta.modalidade === "cadastro" && autenticado)) return "Explorar o mapa";
  if (oferta.modalidade === "cadastro") return "Cadastrar grátis";
  if (oferta.modalidade === "anuncio") return "Anunciar meu imóvel";
  if (oferta.modalidade === "proposta") return oferta.prazo_dias ? "Pedir demonstração" : "Pedir proposta";
  return "Avise-me";
}
