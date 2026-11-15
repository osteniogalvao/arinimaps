declare module "vt-pbf" {
  export default function fromVectorTileJs(tile: { layers: Record<string, unknown> }): Uint8Array<ArrayBuffer>;
}
