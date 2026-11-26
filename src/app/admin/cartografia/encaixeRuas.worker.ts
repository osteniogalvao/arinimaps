import { encaixarEmPassadas, type Linha } from "@/lib/geo/encaixeRuas";

/** O encaixe de uma cidade inteira leva alguns segundos: roda fora da tela para o mapa não travar. */
self.onmessage = (e: MessageEvent<{ movel: Linha[]; fixo: Linha[]; ruas: Linha[] }>) => {
  const w = self as unknown as Worker;
  try {
    const resultado = encaixarEmPassadas(e.data.movel, e.data.fixo, e.data.ruas, (passada) => w.postMessage({ passada }));
    w.postMessage({ ok: true, resultado });
  } catch (err) {
    w.postMessage({ ok: false, erro: err instanceof Error ? err.message : String(err) });
  }
};
