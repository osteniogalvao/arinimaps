/**
 * Visual dos pontos de referência do entorno (pedido do Stenio, 17/11/2026:
 * "ícones bonitos, com vida" para o que existe em volta do lote). Uma cor e
 * um ícone por categoria, usados no mapa (pinos HTML), nas listas e no
 * relatório para imprimir. Os ícones são os do lucide (mesmos traços do
 * resto do site), guardados como SVG para o pino não depender do React.
 */
export type VisualPoi = { cor: string; rotulo: string; svg: string };

export const VISUAL_POI: Record<string, VisualPoi> = {
  combustivel: { cor: "#F97316", rotulo: "Posto de combustível", svg: "<path d=\"M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5\"></path><path d=\"M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16\"></path><path d=\"M2 21h13\"></path><path d=\"M3 9h11\"></path>" },
  farmacia: { cor: "#10B981", rotulo: "Farmácia", svg: "<path d=\"m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z\"></path><path d=\"m8.5 8.5 7 7\"></path>" },
  supermercado: { cor: "#EF4444", rotulo: "Supermercado", svg: "<path d=\"m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18\"></path><path d=\"M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25\"></path><circle cx=\"18\" cy=\"20\" r=\"2\"></circle><circle cx=\"8\" cy=\"20\" r=\"2\"></circle>" },
  hospital: { cor: "#E11D48", rotulo: "Hospital ou clínica", svg: "<path d=\"M12 7v4\"></path><path d=\"M14 21v-3a2 2 0 0 0-4 0v3\"></path><path d=\"M14 9h-4\"></path><path d=\"M18 11h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2\"></path><path d=\"M18 21V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16\"></path>" },
  escola: { cor: "#6366F1", rotulo: "Escola", svg: "<path d=\"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z\"></path><path d=\"M22 10v6\"></path><path d=\"M6 12.5V16a6 3 0 0 0 12 0v-3.5\"></path>" },
  centro: { cor: "#0E4D36", rotulo: "Centro da cidade", svg: "<path d=\"M10 18v-7\"></path><path d=\"M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z\"></path><path d=\"M14 18v-7\"></path><path d=\"M18 18v-7\"></path><path d=\"M3 22h18\"></path><path d=\"M6 18v-7\"></path>" },
  acesso_rodovia: { cor: "#475569", rotulo: "Acesso à rodovia", svg: "<circle cx=\"6\" cy=\"19\" r=\"3\"></circle><path d=\"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15\"></path><circle cx=\"18\" cy=\"5\" r=\"3\"></circle>" },
  banco: { cor: "#0EA5E9", rotulo: "Banco", svg: "<rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\"></rect><circle cx=\"12\" cy=\"12\" r=\"2\"></circle><path d=\"M6 12h.01M18 12h.01\"></path>" },
  igreja: { cor: "#A855F7", rotulo: "Igreja", svg: "<path d=\"M10 9h4\"></path><path d=\"M12 7v5\"></path><path d=\"M14 21v-3a2 2 0 0 0-4 0v3\"></path><path d=\"m18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9\"></path><path d=\"M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14\"></path>" },
  restaurante: { cor: "#F59E0B", rotulo: "Restaurante ou café", svg: "<path d=\"M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2\"></path><path d=\"M7 2v20\"></path><path d=\"M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7\"></path>" },
  parque: { cor: "#22C55E", rotulo: "Praça ou parque", svg: "<path d=\"M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z\"></path><path d=\"M7 16v6\"></path><path d=\"M13 19v3\"></path><path d=\"M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5\"></path>" },
  padaria: { cor: "#D97706", rotulo: "Padaria", svg: "<path d=\"M10.2 18H4.774a1.5 1.5 0 0 1-1.352-.97 11 11 0 0 1 .132-6.487\"></path><path d=\"M18 10.2V4.774a1.5 1.5 0 0 0-.97-1.352 11 11 0 0 0-6.486.132\"></path><path d=\"M18 5a4 3 0 0 1 4 3 2 2 0 0 1-2 2 10 10 0 0 0-5.139 1.42\"></path><path d=\"M5 18a3 4 0 0 0 3 4 2 2 0 0 0 2-2 10 10 0 0 1 1.42-5.14\"></path><path d=\"M8.709 2.554a10 10 0 0 0-6.155 6.155 1.5 1.5 0 0 0 .676 1.626l9.807 5.42a2 2 0 0 0 2.718-2.718l-5.42-9.807a1.5 1.5 0 0 0-1.626-.676\"></path>" },
  policia: { cor: "#1D4ED8", rotulo: "Polícia", svg: "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"></path>" },
  outro: { cor: "#64748B", rotulo: "Ponto de referência", svg: "<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\"></path><circle cx=\"12\" cy=\"10\" r=\"3\"></circle>" },
};

export function visualPoi(categoria: string): VisualPoi {
  return VISUAL_POI[categoria] ?? VISUAL_POI.outro;
}

/** SVG completo do ícone (traço branco por padrão), para innerHTML ou data URI. */
export function svgPoi(categoria: string, { cor = "#FFFFFF", tamanho = 16, traco = 2.25 } = {}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="${traco}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${visualPoi(categoria).svg}</svg>`;
}
