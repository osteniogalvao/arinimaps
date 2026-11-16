import assert from "node:assert/strict";
import test from "node:test";
import { analisarAmostra, melhoraCobertura } from "../src/lib/map/coberturaNuvens.ts";
import { urlDoTile, urlMosaico } from "../public/vendor/fonte-satelite.mjs";

function paisagem(cor) {
  const rgba = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      rgba.set(cor(x, y), (y * 32 + x) * 4);
    }
  }
  return analisarAmostra(rgba);
}

const branco = [230, 229, 226, 255];
const verde = [50, 100, 44, 255];
const nebulosa = paisagem((x, y) => x < 14 && y < 14 ? branco : verde);

test("agrupamento de pixels claros aciona a comparação, pontos dispersos não", () => {
  assert.equal(nebulosa.suspeita, true);
  assert.equal(paisagem((x, y) => x % 2 && y % 2 ? branco : verde).suspeita, false);
});
test("só aceita imagem com cobertura válida e redução de áreas claras", () => {
  assert.equal(melhoraCobertura(nebulosa, paisagem(() => verde)), true);
  assert.equal(melhoraCobertura(nebulosa, nebulosa), false);
  assert.equal(melhoraCobertura(nebulosa, paisagem(() => [0, 0, 0, 255])), false);
  assert.equal(melhoraCobertura(nebulosa, paisagem(() => [0, 0, 0, 0])), false);
});
test("o mosaico regional e a fotografia de detalhe seguem o zoom em qualquer município", () => {
  const detalhe = "https://example.org/{z}/{x}/{y}";
  assert.match(urlDoTile(4, 5, 8, detalhe), /gibs[.]earthdata[.]nasa[.]gov.*4\/8\/5[.]jpeg$/);
  for (const [z, x, y] of [[7, 45, 65], [13, 2733, 4166]]) {
    const url = new URL(urlDoTile(z, x, y, detalhe));
    assert.equal(url.href, new URL(urlMosaico(z, x, y)).href);
    const [w, s, e, n] = url.searchParams.get("BBOX").split(",").map(Number);
    assert.ok(w < e && s < n);
  }
  assert.equal(urlDoTile(14, 5464, 8330, detalhe), "https://example.org/14/5464/8330");
});
