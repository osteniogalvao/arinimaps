export class CorpoMuitoGrande extends Error {}

/** Interrompe o fluxo assim que a quantidade real de bytes ultrapassa o limite. */
export function limitarFluxo(corpo: ReadableStream<Uint8Array>, limite: number) {
  let total = 0;
  return corpo.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(parte, destino) {
      total += parte.byteLength;
      if (total > limite) throw new CorpoMuitoGrande();
      destino.enqueue(parte);
    },
  }));
}
