import { NextResponse } from "next/server";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { parcelasSigefPorCodigo, type CampoBuscaSigef } from "@/lib/rural/adaptadores";
import { ufsDoEnvelope } from "@/lib/rural/ufs";

export const maxDuration = 60;

/**
 * Busca de parcela do SIGEF pelo código (busca única do mapa, ideia do
 * Geomart, 11/11/2026): `tipo` = parcela (UUID da certificação), ccir (código
 * do imóvel no INCRA) ou matricula; `bbox` = a tela do mapa, que decide em
 * quais UFs procurar (o INCRA publica um tema por estado).
 *
 * Dado público, sem login, como a matrícula do cartão do CAR.
 */
const CAMPO: Record<string, CampoBuscaSigef> = { parcela: "parcela_codigo", ccir: "codigo_imovel", matricula: "registro_matricula" };

/** As grafias que a base do INCRA pode ter para o mesmo código. */
function grafias(tipo: string, valor: string): string[] {
  const v = valor.trim();
  if (tipo === "parcela") return [v.toLowerCase(), v.toUpperCase()];
  const dig = v.replace(/\D/g, "");
  if (tipo === "ccir") {
    if (dig.length !== 13) return [];
    return [dig, `${dig.slice(0, 3)}.${dig.slice(3, 6)}.${dig.slice(6, 9)}.${dig.slice(9, 12)}-${dig.slice(12)}`];
  }
  if (!dig || dig.length > 8) return [];
  const milhar = Number(dig).toLocaleString("pt-BR");
  return [dig, milhar, String(Number(dig))];
}

export async function GET(request: Request) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const q = new URL(request.url).searchParams;
  const tipo = q.get("tipo") ?? "";
  const campo = CAMPO[tipo];
  const valores = campo ? grafias(tipo, q.get("valor") ?? "") : [];
  if (!campo || !valores.length) {
    return NextResponse.json({ error: "Código inválido.", codigo: "codigo_invalido" }, { status: 400 });
  }
  const [xmin, ymin, xmax, ymax] = (q.get("bbox") ?? "").split(",").map(Number);
  if (![xmin, ymin, xmax, ymax].every(Number.isFinite)) {
    return NextResponse.json({ error: "Faltou a área do mapa.", codigo: "sem_bbox" }, { status: 400 });
  }
  const ufs = ufsDoEnvelope({ xmin, ymin, xmax, ymax });
  if (!ufs.length) return NextResponse.json({ parcelas: [], ufs });
  if (ufs.length > 6) {
    return NextResponse.json({
      error: "Aproxime o mapa do estado do imóvel: o INCRA publica o SIGEF por estado.", codigo: "muitas_ufs", ufs,
    }, { status: 422 });
  }
  try {
    const parcelas = await parcelasSigefPorCodigo(campo, valores, ufs, 10);
    return NextResponse.json(
      { parcelas, ufs, fonte: "INCRA / SIGEF", consultado_em: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } },
    );
  } catch (e) {
    console.error("busca SIGEF falhou:", e);
    return NextResponse.json(
      { error: "O SIGEF do INCRA não respondeu agora. Tente de novo em instantes.", codigo: "sigef_indisponivel" },
      { status: 502 },
    );
  }
}
