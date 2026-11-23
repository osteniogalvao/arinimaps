import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ImageResponse } from "next/og";
import { MARCA_CAMINHOS, MARCA_VIEWBOX } from "@/lib/relatorio/marca-pdf";
import { OG_IMAGEM_PADRAO, urlDoSite } from "@/lib/compartilhar";
import {
  fotoUrl, listarVendidos, numerosVendas, ondeTexto, rotuloTipo, textoDias, vendidoPorId, type Vendido,
} from "@/lib/vendidos";

export const runtime = "nodejs";

const L = 1200, A = 630;
const padrao = () => Response.redirect(new URL(OG_IMAGEM_PADRAO, urlDoSite()), 302);

/** Foto do anúncio (Storage) ou a imagem padrão do site, já no tamanho pedido. */
async function foto(v: Pick<Vendido, "foto" | "tipo"> | null, w: number, h: number): Promise<Buffer> {
  let bruto: Buffer | null = null;
  if (v?.foto) {
    try {
      const r = await fetch(fotoUrl(v.foto), { signal: AbortSignal.timeout(8_000) });
      if (r.ok) bruto = Buffer.from(await r.arrayBuffer());
    } catch { /* cai na imagem padrão */ }
  }
  if (!bruto) {
    const arq = v?.tipo === "urbano" ? "casa-urbana.jpg" : "aerea-campo.jpg";
    bruto = await readFile(path.join(process.cwd(), "public", "img", v ? arq : "hero-fazenda.jpg"));
  }
  return sharp(bruto).rotate().resize(w, h, { fit: "cover", position: "attention" }).jpeg({ quality: 80 }).toBuffer();
}

const dataUrl = (b: Buffer, tipo = "image/jpeg") => `data:${tipo};base64,${b.toString("base64")}`;

const marcaSvg = () => {
  const paths = MARCA_CAMINHOS.map(({ d, cor }) => `<path d="${d}" fill="${cor}"/>`).join("");
  return dataUrl(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARCA_VIEWBOX.largura} ${MARCA_VIEWBOX.altura}">${paths}</svg>`,
  ), "image/svg+xml");
};

/**
 * Prévia do link no WhatsApp (1200×630, JPEG < 300 KB):
 *  · /og/vendidos       — mosaico das últimas vendas e "Vendidos pela ARINI";
 *  · /og/vendidos/[id]  — foto do imóvel com "Vendido em X dias" e o município.
 * Mesmas regras da vitrine: sem nome, valor ou localização exata.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id?: string[] }> }) {
  const { id } = await params;
  try {
    let fundo: Buffer;
    let selo: string, titulo: string, linha: string;
    if (id?.length) {
      if (id.length > 1) return new Response("Não encontrado", { status: 404 });
      const v = await vendidoPorId(id[0]);
      if (!v) return padrao();
      fundo = await foto(v, L, A);
      selo = "VENDIDO";
      titulo = textoDias(v.dias);
      linha = [rotuloTipo(v), ondeTexto(v), v.area].filter(Boolean).join(" · ");
    } else {
      const [lista, nv] = await Promise.all([listarVendidos(3), numerosVendas()]);
      if (lista.length >= 3) {
        const w = L / 3;
        const partes = await Promise.all(lista.map((v) => foto(v, w, A)));
        fundo = await sharp({ create: { width: L, height: A, channels: 3, background: "#0A2219" } })
          .composite(partes.map((input, k) => ({ input, left: k * w, top: 0 })))
          .jpeg({ quality: 80 }).toBuffer();
      } else {
        fundo = await foto(lista[0] ?? null, L, A);
      }
      selo = "RESULTADOS REAIS";
      titulo = "Vendidos pela ARINI";
      linha = [
        nv.vendidos > 0 && `${nv.vendidos.toLocaleString("pt-BR")} imóveis vendidos`,
        nv.mediaDias > 0 && `${nv.mediaDias.toLocaleString("pt-BR")} dias em média até a venda`,
      ].filter(Boolean).join(" · ") || "Imóveis rurais e urbanos da região";
    }

    const larguraMarca = 190;
    const png = new ImageResponse(
      (
        <div style={{ width: L, height: A, display: "flex", position: "relative", fontFamily: "Geist" }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={dataUrl(fundo)} width={L} height={A} style={{ position: "absolute", top: 0, left: 0 }} />
          <div style={{
            position: "absolute", top: 0, left: 0, width: L, height: A, display: "flex",
            backgroundImage: "linear-gradient(180deg, rgba(10,34,25,0.05) 25%, rgba(10,34,25,0.92) 100%)",
          }} />
          <div style={{ position: "absolute", left: 56, right: 56, bottom: 48, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex" }}>
              <div style={{
                display: "flex", background: "#D9BD6F", color: "#124431", fontSize: 26, letterSpacing: 3,
                padding: "8px 20px", borderRadius: 999,
              }}>{selo}</div>
            </div>
            <div style={{ display: "flex", color: "#FFFFFF", fontSize: 78, lineHeight: 1.05, marginTop: 18 }}>{titulo}</div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 14 }}>
              <div style={{ display: "flex", color: "rgba(255,255,255,0.88)", fontSize: 34, maxWidth: 820 }}>{linha}</div>
              {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
              <img src={marcaSvg()} width={larguraMarca} height={Math.round(larguraMarca * MARCA_VIEWBOX.altura / MARCA_VIEWBOX.largura)} />
            </div>
          </div>
        </div>
      ),
      { width: L, height: A },
    );
    const jpeg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(jpeg), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600, s-maxage=3600" },
    });
  } catch (e) {
    console.error("[og/vendidos]", id, e);
    return padrao();
  }
}
