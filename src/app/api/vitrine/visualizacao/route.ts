import { type NextRequest } from "next/server";
import { registrarEventoImovel } from "@/lib/imovel/eventos";
import { limitarEmMemoria } from "@/lib/geo/limiteMemoria";
import { COOKIE_ESCOLHA } from "@/lib/privacidade/consentimento";
import { ipDoPedido, respostaLimite } from "@/lib/seguranca/limite";
import { currentUser } from "@/lib/supabase/server";

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export async function POST(request: NextRequest) {
  const semConteudo = () => new Response(null, { status: 204 });
  const temSessao = request.cookies.getAll().some(c => /^sb-.+-auth-token(?:\.\d+)?$/.test(c.name));
  if (!temSessao && request.cookies.get(COOKIE_ESCOLHA)?.value !== "rastro-v1") return semConteudo();

  const ip = ipDoPedido(request);
  const limite = limitarEmMemoria("visualizacao:" + ip, 90, 60);
  if (!limite.permitido) return respostaLimite(limite, "visualização no mapa");
  const dados = await request.json().catch(() => null);
  if (!dados || typeof dados.imovel !== "string" || !UUID.test(dados.imovel)) return new Response(null, { status: 400 });
  const u = temSessao ? await currentUser() : null;
  if (temSessao && !u) return semConteudo();
  await registrarEventoImovel({ propertyId: dados.imovel, tipo: "visualizacao", userId: u?.id, request });
  return semConteudo();
}
