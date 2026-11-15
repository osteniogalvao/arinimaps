import { modeloAnterior } from "./juridico/versoes-anteriores";
import arquivos from "./juridico/2026-11-15.json";
import { documentosLegados, VERSOES as LEGADAS, type Documento, type DocId } from "./juridico/legado";
import { VERSOES } from "./juridico/versoes";

export type { Documento, DocId };
export { VERSOES, assinatura } from "./juridico/versoes";
const titulos = {
  "termos-de-uso": ["Termos de Uso", "Condições de acesso à plataforma, planos, imóveis à venda e intermediação.", "Todos que usam a plataforma"],
  privacidade: ["Política de Privacidade", "Tratamento de dados pessoais, compartilhamento, cookies e direitos dos titulares.", "Todos que usam a plataforma"],
  exclusividade: ["Termo de Exclusividade", "Intermediação imobiliária exclusiva, condições de venda, prazos e assinatura do proprietário.", "Proprietários que anunciam"],
  remuneracao: ["Regra de Remuneração", "Comissão, repasse, pagamento e hipóteses de isenção por perfil.", "Proprietários e parceiros"],
  parceiros: ["Termo de Parceria da Rede de Corretores", "Credenciamento opcional, captação de imóveis e repasse ao corretor.", "Corretores e imobiliárias que aderem à Rede"],
} as const;

export function paginasOficiais(id: DocId) {
  return id === "autorizacao" ? null : arquivos[id].paginas;
}

export function versaoAnterior(id: DocId) {
  return LEGADAS[id] === VERSOES[id] ? null : LEGADAS[id];
}

function oficial(id: keyof typeof arquivos): Documento {
  const arquivo = arquivos[id];
  const [titulo, resumo, paraQuem] = titulos[id];
  return {
    id, titulo, resumo, paraQuem, versao: VERSOES[id], vigencia: "15/11/2026",
    pdf: `/juridico/2026-11-15/${id}.pdf`, sha256: arquivo.sha256,
    secoes: arquivo.paginas.map((pagina, i) => ({
      titulo: `Página ${i+1}`,
      itens: pagina.map(bloco => typeof bloco === "string" ? bloco : bloco.map(linha => linha.join(" | ")).join("\n")),
    })),
  };
}

export function documento(cfg: Record<string, unknown>, id: string, meses?: 6 | 12, versao?: string): Documento | null {
  if (!Object.hasOwn(VERSOES,id)) return null;
  const chave = id as DocId;
  if (chave !== "autorizacao" && (!versao || versao === VERSOES[chave])) return oficial(chave);
  if (versao && versao !== LEGADAS[chave]) return modeloAnterior(cfg,chave,versao);
  return documentosLegados(cfg,meses).find(d => d.id === chave) ?? null;
}

export function documentos(cfg: Record<string, unknown>) {
  return (Object.keys(VERSOES) as DocId[]).map(id => documento(cfg,id)!);
}

export function ipDe(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

export type { Secao } from "./juridico/legado";
