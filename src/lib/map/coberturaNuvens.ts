// Amostra pequena: o mapa verifica concentração de pixels claros e pouco saturados.
// Telhados isolados costumam ocupar poucos pixels; também comparamos a mesma área
// em uma segunda imagem antes de trocar a fotografia.
const LADO = 32;

export function analisarAmostra(rgba: Uint8ClampedArray) {
  const claros = new Uint8Array(LADO * LADO);
  let total = 0;
  let validos = 0;
  for (let i = 0; i < claros.length; i++) {
    const j = i * 4;
    const max = Math.max(rgba[j], rgba[j + 1], rgba[j + 2]);
    const min = Math.min(rgba[j], rgba[j + 1], rgba[j + 2]);
    if (rgba[j + 3] < 240 || max < 10) continue;
    validos++;
    if (max > 178 && min > 0.82 * max) {
      claros[i] = 1;
      total++;
    }
  }
  // Pelo menos 2,5% do tile em trechos contínuos de 3 × 3 pixels da amostra.
  let continuos = 0;
  for (let y = 1; y < LADO - 1; y++) {
    for (let x = 1; x < LADO - 1; x++) {
      const i = y * LADO + x;
      if (claros[i] && claros[i-1] && claros[i+1] && claros[i-LADO] && claros[i+LADO]) continuos++;
    }
  }
  return { claros, total, suspeita: continuos >= 26, utilizavel: validos >= 0.98 * claros.length };
}

export type Amostra = ReturnType<typeof analisarAmostra>;

export function melhoraCobertura(original: Amostra, alternativa: Amostra) {
  if (!alternativa.utilizavel || alternativa.total >= original.total / 2) return false;
  let persistentes = 0;
  for (let i = 0; i < original.claros.length; i++) {
    if (original.claros[i] && alternativa.claros[i]) persistentes++;
  }
  return persistentes < original.total / 3;
}

export async function amostrarImagem(data: ArrayBuffer): Promise<Amostra | null> {
  if (typeof createImageBitmap !== "function") return null;
  const tela = document.createElement("canvas");
  tela.width = tela.height = LADO;
  const ctx = tela.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const imagem = await createImageBitmap(new Blob([data]), { resizeWidth: LADO, resizeHeight: LADO, resizeQuality: "medium" });
  try {
    ctx.drawImage(imagem, 0, 0, LADO, LADO);
    return analisarAmostra(ctx.getImageData(0, 0, LADO, LADO).data);
  } finally {
    imagem.close();
  }
}

