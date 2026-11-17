export const CNPJ_IMOVEIS = "61134351000180";
export const CNPJ_TECNOLOGIA = "68128846000146";

export function parametrosFiscais(texto: string) {
  const p = JSON.parse(texto);
  const data = typeof p.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.desde) ? new Date(p.desde + "T12:00:00Z") : null;
  const idServico = typeof p.municipalServiceId === "string" ? p.municipalServiceId.trim() : "";
  const codigoServico = typeof p.municipalServiceCode === "string" ? p.municipalServiceCode.trim() : "";
  if (!data || !Number.isFinite(data.getTime()) || data.toISOString().slice(0, 10) !== p.desde ||
      ![CNPJ_IMOVEIS,CNPJ_TECNOLOGIA].includes(p.emitenteCnpj) || !["cobranca", "pagamento"].includes(p.momento) || !!idServico === !!codigoServico ||
      typeof p.municipalServiceName !== "string" || !p.municipalServiceName.trim() ||
      !Number.isFinite(p.deductions) || p.deductions < 0 || typeof p.taxes?.retainIss !== "boolean" ||
      !["iss","cofins","csll","inss","ir","pis"].every(k => Number.isFinite(p.taxes[k]) && p.taxes[k] >= 0 && p.taxes[k] <= 100)) {
    throw Error("Confira emitente, vigência, momento, serviço municipal, deduções e tributos da assinatura.");
  }
  return {
    emitente: p.emitenteCnpj as string, desde: p.desde as string, aposPagamento: p.momento === "pagamento",
    servico: { municipalServiceName: p.municipalServiceName as string,
      ...(idServico ? { municipalServiceId: idServico } : { municipalServiceCode: codigoServico }),
      deductions: p.deductions as number, taxes: p.taxes as Record<string, unknown> },
  };
}

export const referenciaFiscal = (fatura: string) => "nfse_plano_" + fatura;
export function faturaDaReferencia(valor: unknown) {
  return typeof valor === "string" ? /^nfse_plano_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(valor)?.[1] ?? null : null;
}

export function estadoFiscal(status: string) {
  switch (status) {
    case "SCHEDULED": case "SYNCHRONIZED": case "PROCESSING_CANCELLATION": return "agendada";
    case "AUTHORIZED": case "CANCELLATION_DENIED": return "emitida";
    case "ERROR": return "recusada";
    case "CANCELED": case "CANCELLED": return "cancelada";
    default: return null;
  }
}
