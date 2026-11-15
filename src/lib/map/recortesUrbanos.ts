export type RecorteUrbano = {
  id: string; camada: string; nome: string; geometry: GeoJSON.Polygon;
  bbox: [number, number, number, number];
};

let pedido: Promise<RecorteUrbano[]> | undefined;
let expira = 0;
export function recortesPublicados() {
  if (!pedido || Date.now() >= expira) {
    expira = Date.now() + 30_000;
    pedido = fetch("/api/geo/recortes-urbanos").then(async r => {
      if (!r.ok) throw new Error("Não foi possível carregar os recortes urbanos.");
      return await r.json() as RecorteUrbano[];
    }).catch(e => { pedido = undefined; throw e; });
  }
  return pedido;
}

export function recortesNoTile(recortes: RecorteUrbano[], z: number, x: number, y: number) {
  const n = 2 ** z;
  const lng = (v: number) => v / n * 360 - 180;
  const lat = (v: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
  const margem = 64 / 4096;
  const oeste = lng(x - margem), leste = lng(x + 1 + margem);
  const sul = lat(y + 1 + margem), norte = lat(y - margem);
  return recortes.filter(({ bbox: b }) => b[2] >= oeste && b[0] <= leste && b[3] >= sul && b[1] <= norte);
}
