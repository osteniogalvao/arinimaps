import { tipoReal, CONTENT_TYPE } from "../seguranca/arquivos";

export class ErroRaster extends Error {
  status: number;
  constructor(mensagem: string, status = 415) {
    super(mensagem);
    this.status = status;
  }
}

/** Lê o raster com limite real, inclusive em transferências sem Content-Length. */
export async function lerRaster(corpo: ReadableStream<Uint8Array>, limite: number) {
  const reader = corpo.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > limite) {
        throw new ErroRaster(`A imagem passa do limite de ${Math.round(limite / 1024 / 1024)} MB.`, 413);
      }
      partes.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(partes, tamanho);
  const cabecalho = bytes.subarray(0, 16);
  const igual = (assinatura: number[]) => assinatura.every((v, i) => cabecalho[i] === v);
  const tiff = tamanho >= 8 && (igual([0x49, 0x49, 42, 0]) || igual([0x4d, 0x4d, 0, 42]));
  const bigTiff = tamanho >= 16 && (
    igual([0x49, 0x49, 43, 0, 8, 0, 0, 0]) || igual([0x4d, 0x4d, 0, 43, 0, 8, 0, 0])
  );
  if (tiff || bigTiff) return { bytes, ext: "tif", contentType: "image/tiff" };
  const tipo = tipoReal(cabecalho);
  if (tamanho >= 8 && (tipo === "jpg" || tipo === "png")) {
    return { bytes, ext: tipo, contentType: CONTENT_TYPE[tipo] };
  }
  throw new ErroRaster("Envie uma imagem TIFF, PNG ou JPEG com conteúdo válido.");
}
