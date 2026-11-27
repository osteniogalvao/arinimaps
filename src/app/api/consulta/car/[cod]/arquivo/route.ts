import { consultarCar } from "@/lib/geo/car";
import { paraKML, temPoligono, type CamadaSig } from "@/lib/geo/exportarSig";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { acessoAtual } from "@/lib/planos-servidor";
import { linkWhatsappValido } from "@/lib/relatorio/link-whatsapp";
import { exigirAparelhoAtivo, registrarDownload } from "@/lib/seguranca/uso";

/**
 * Perímetro do imóvel do CAR em KMZ ou KML (áudio do Carlos, 24/11/2026 8h05:
 * quem manda a localização pelo WhatsApp recebe os arquivos do seu plano).
 *
 * Duas portas: o link assinado que o atendimento do WhatsApp manda (o plano já
 * foi conferido; quem baixa é o servidor do provedor, sem sessão) ou a conta
 * logada com o recurso "ferramenta_exportar".
 *   GET /api/consulta/car/<cod>/arquivo?formato=kmz|kml[&exp&sig]
 */
export async function GET(request: Request, ctx: RouteContext<"/api/consulta/car/[cod]/arquivo">) {
  const url = new URL(request.url);
  const formato = url.searchParams.get("formato") === "kml" ? "kml" : "kmz";
  const cod = (await ctx.params).cod.toUpperCase();
  if (!/^[A-Z]{2}-\d{7}-[0-9A-F.-]{20,45}$/i.test(cod)) return Response.json({ error: "Código CAR inválido." }, { status: 400 });
  if (!linkWhatsappValido(url, cod, formato)) {
    const bloqueio = await limiteLeituraMapa(request, "relatorio");
    if (bloqueio) return bloqueio;
    const { userId, acesso } = await acessoAtual();
    if (!acesso.recursos.has("ferramenta_exportar")) {
      return userId
        ? Response.json({ error: "Seu plano não inclui baixar a área em KML/KMZ." }, { status: 403 })
        : Response.json({ error: "Entre para baixar a área em KML/KMZ." }, { status: 401 });
    }
    // limites por assinatura (26/11/2026): cota de KML/KMZ do mês do plano
    if (userId) {
      const barrado = await exigirAparelhoAtivo(request, userId, acesso) ?? await registrarDownload(request, userId, acesso, formato, "car");
      if (barrado) return barrado;
    }
  }
  const { data, error } = await consultarCar(cod);
  if (error) return Response.json({ error: "A consulta está indisponível." }, { status: 503 });
  const f = data as { geometry?: GeoJSON.Geometry; properties?: Record<string, unknown> } | null;
  if (!f?.properties || !temPoligono(f.geometry)) return Response.json({ error: "Perímetro do CAR não encontrado." }, { status: 404 });
  const p = f.properties;
  const camada: CamadaSig = {
    nome: "car", rotulo: `CAR ${cod}`, geometry: f.geometry!,
    atributos: {
      codigo_car: cod, municipio: (p.municipio as string) ?? null,
      area_declarada_ha: p.area_ha == null ? null : Number(p.area_ha),
      situacao: (p.status as string) ?? null, condicao: (p.condicao as string) ?? null,
      fonte: "SICAR (cópia consultada pela ARINI)",
    },
  };
  const kml = paraKML([camada], `ARINI · CAR ${cod}`);
  const nome = `ARINI-${cod}.${formato}`;
  const cabecalhos = { "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "private, no-store" };
  if (formato === "kml") {
    return new Response(kml, { headers: { ...cabecalhos, "Content-Type": "application/vnd.google-earth.kml+xml; charset=utf-8" } });
  }
  const { default: JSZip } = await import("jszip");
  const bytes = await new JSZip().file("doc.kml", kml).generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Response(Buffer.from(bytes), { headers: { ...cabecalhos, "Content-Type": "application/vnd.google-earth.kmz" } });
}
