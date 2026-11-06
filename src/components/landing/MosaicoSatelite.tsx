/* eslint-disable @next/next/no-img-element */
import { urlTileAtivo } from "@/lib/map/config";

/** Mapa topográfico da Esri (relevo sombreado + cartografia), para os cartões "cartográficos". */
const urlTileRelevo = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`;

/**
 * Miniatura de satélite feita com os próprios tiles da Esri World Imagery que
 * o mapa usa (mesma fonte, mesma licença): um mosaico 3×3 em volta do ponto,
 * deslocado para o ponto cair no centro do cartão. O cartão mostra a janela
 * de 2×2 tiles do meio — sobra meio tile de cada lado para o deslocamento.
 *
 * Sem hooks: serve em componente de servidor e de cliente.
 */
function tileXY(lng: number, lat: number, z: number) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x, y };
}

export default function MosaicoSatelite({ lng, lat, z = 13, className = "", alt = "", camada = "satelite" }: {
  lng: number; lat: number; z?: number; className?: string; alt?: string; camada?: "satelite" | "relevo";
}) {
  const { x, y } = tileXY(lng, lat, z);
  const x0 = Math.floor(x) - 1;
  const y0 = Math.floor(y) - 1;
  // quanto o ponto está fora do centro do mosaico, em % da largura do mosaico
  const dx = ((1.5 - (x - x0)) / 3) * 100;
  const dy = ((1.5 - (y - y0)) / 3) * 100;
  const tiles: { k: string; src: string }[] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    tiles.push({ k: `${i}-${j}`, src: camada === "relevo" ? urlTileRelevo(z, x0 + i, y0 + j) : urlTileAtivo(z, x0 + i, y0 + j) });
  }
  return (
    <div className={`absolute inset-0 overflow-hidden bg-[#124431] ${className}`} role={alt ? "img" : undefined} aria-label={alt || undefined}>
      <div
        className="absolute left-1/2 top-1/2 grid aspect-square w-[150%] grid-cols-3"
        style={{ transform: `translate(calc(-50% + ${dx.toFixed(2)}%), calc(-50% + ${dy.toFixed(2)}%))` }}
        aria-hidden="true"
      >
        {tiles.map((t) => (
          <img key={t.k} src={t.src} alt="" width={256} height={256} loading="lazy" decoding="async"
            className="block h-full w-full object-cover" />
        ))}
      </div>
    </div>
  );
}
