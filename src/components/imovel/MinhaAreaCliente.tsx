"use client";

import dynamic from "next/dynamic";

// mapa pesado (MapLibre + turf): só no navegador, fora do bundle inicial
const MinhaArea = dynamic(() => import("@/components/imovel/MinhaArea"), {
  ssr: false,
  loading: () => <div className="h-[28rem] w-full animate-pulse rounded-2xl bg-superficie-2 md:h-[34rem]" />,
});

export default function MinhaAreaCliente({ propertyId, somenteLeitura = false }: { propertyId: string; somenteLeitura?: boolean }) {
  return <MinhaArea propertyId={propertyId} somenteLeitura={somenteLeitura} />;
}
