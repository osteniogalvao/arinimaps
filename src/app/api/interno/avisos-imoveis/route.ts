import { processarAvisosWhatsapp } from "@/lib/avisos-whatsapp-servidor";
export const maxDuration = 90;
export function POST(req: Request) { return processarAvisosWhatsapp(req, "filtro"); }
