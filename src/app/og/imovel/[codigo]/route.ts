import sharp from "sharp";
import { bbox } from "@turf/turf";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mosaicoEsri } from "@/lib/relatorio/pdf-area";
import { MARCA_CAMINHOS, MARCA_VIEWBOX } from "@/lib/relatorio/marca-pdf";
import { OG_IMAGEM_PADRAO, urlDoSite } from "@/lib/compartilhar";

// atrás do proxy o req.url é o endereço interno (localhost:3000): o desvio usa o endereço público
const padrao = () => Response.redirect(new URL(OG_IMAGEM_PADRAO, urlDoSite()), 302);

export const runtime = "nodejs";

const L = 1200, A = 630;

/** Web Mercator normalizado (0..1) — o mesmo do mosaico. */
const merc = (lng: number, lat: number) => {
  const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
};
const desmerc = (x: number, y: number) => [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI];

/**
 * Card do link (áudio do Carlos, 18/11/2026, 9h27: "pega esse link, esse card,
 * põe lá no outro WhatsApp, aí já aparece toda a questão da área"): satélite
 * da área com a divisa em dourado e a marca ARINI, 1200×630 em JPEG (< 300 KB,
 * o que o WhatsApp aceita na prévia). Só imóveis anunciados (fn_property_public).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  if (!/^AIB-\d{6}$/.test(codigo)) return new Response("Não encontrado", { status: 404 });
  const { data } = await supabaseAdmin().rpc("fn_property_public", { p_codigo: codigo });
  const im = data as { status: string; geometry: GeoJSON.Geometry | null } | null;
  if (!im?.geometry || !["publicado", "em_negociacao", "vendido"].includes(im.status)) {
    return padrao();
  }
  try {
    // janela: a área com folga, no formato 1200×630
    const [oeste, sul, leste, norte] = bbox(im.geometry);
    const [x0, y1] = merc(oeste, sul), [x1, y0] = merc(leste, norte);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let w = Math.max(x1 - x0, 1e-6) * 1.6, h = Math.max(y1 - y0, 1e-6) * 1.6;
    if (w / h > L / A) h = w * A / L; else w = h * L / A;
    const [jOeste, jNorte] = desmerc(cx - w / 2, cy - h / 2), [jLeste, jSul] = desmerc(cx + w / 2, cy + h / 2);
    const fundo = await mosaicoEsri([jSul, jOeste, jNorte, jLeste], L, A, false);

    const px = ([lng, lat]: GeoJSON.Position) => {
      const [mx, my] = merc(lng, lat);
      return `${(((mx - (cx - w / 2)) / w) * L).toFixed(1)},${(((my - (cy - h / 2)) / h) * A).toFixed(1)}`;
    };
    const aneis: GeoJSON.Position[][] = im.geometry.type === "Polygon" ? im.geometry.coordinates
      : im.geometry.type === "MultiPolygon" ? im.geometry.coordinates.flat() : [];
    const caminho = aneis.map((a) => "M" + a.map(px).join("L") + "Z").join(" ");
    const escala = 46 / MARCA_VIEWBOX.altura;
    const marca = MARCA_CAMINHOS.map(({ d, cor }) => `<path d="${d}" fill="${cor}"/>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${A}">
      ${caminho ? `<path d="${caminho}" fill="#D9BD6F" fill-opacity="0.22" fill-rule="evenodd" stroke="#1A1204" stroke-width="9" stroke-linejoin="round"/>
      <path d="${caminho}" fill="none" stroke="#FFE299" stroke-width="5" stroke-linejoin="round"/>` : ""}
      <rect x="24" y="${A - 24 - 74}" width="${MARCA_VIEWBOX.largura * escala + 44}" height="74" rx="18" fill="#0A2219" fill-opacity="0.88"/>
      <g transform="translate(46 ${A - 24 - 74 + 14}) scale(${escala})">${marca}</g>
    </svg>`;
    const jpeg = await sharp(fundo).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(jpeg), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400, s-maxage=86400" },
    });
  } catch (e) {
    console.error("[og/imovel]", codigo, e);
    return padrao();
  }
}
