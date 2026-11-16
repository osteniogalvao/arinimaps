import type { OportunidadeLote } from "./tipos";

type LinhaOportunidade = {
  id: string; codigo: string; etapa: string; property_id: string; responsavel_tipo: string | null;
  responsavel_partner_id: string | null; partner_comprador_id: string | null; lead: unknown;
};

/** Uma reserva on-line pode não ter oportunidade. O anunciante do lote
 * também pode ser diferente dos dois parceiros que atendem o comprador. */
export function oportunidadesDoEspelho(linhas: LinhaOportunidade[], comercial: boolean, parceiro: string | null) {
  const porUnidade = new Map<string, OportunidadeLote[]>();
  for (const o of linhas) {
    const atende = parceiro && (o.partner_comprador_id === parceiro ||
      (o.responsavel_tipo === "parceiro" && o.responsavel_partner_id === parceiro));
    if (!comercial && !atende) continue;
    const lista = porUnidade.get(o.property_id) ?? [];
    lista.push({ id:o.id, codigo:o.codigo, etapa:o.etapa, cliente:(o.lead as { nome:string } | null)?.nome ?? null });
    porUnidade.set(o.property_id, lista);
  }
  return porUnidade;
}

export function projetarAtendimento(
  comercial: boolean, oportunidades: OportunidadeLote[] | undefined, id: string | null,
  nomeInformado: string | null, nota: string | null, autor: string | null,
) {
  if (comercial) return { cliente:nomeInformado, oportunidade:id, nota, autor };
  // Texto livre e nome copiado da reserva podem descrever outra pessoa,
  // inclusive depois de transferir a oportunidade ou renovar uma reserva.
  const visivel = id ? oportunidades?.find(o => o.id === id) : null;
  return { cliente:visivel?.cliente ?? null, oportunidade:visivel?.id ?? null, nota:null, autor:null };
}
