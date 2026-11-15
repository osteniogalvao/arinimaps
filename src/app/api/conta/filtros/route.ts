import { NextResponse } from "next/server";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { falha } from "@/lib/erros";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export async function POST(req: Request) {
  const a = await ator();
  if (!a || a.nicho !== "comprador_investidor") return falha(403, "perfil_incompativel", "Use o perfil de comprador ou investidor.");
  const limite = await limitar("filtro:alterar:" + a.userId, 60, 600);
  if (!limite.permitido) return respostaLimite(limite, "alterações de filtros");
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return falha(400, "dados_invalidos", "Confira os critérios do filtro.");
  const db = supabaseAdmin();
  if (b.aviso) {
    if (!UUID.test(b.aviso)) return falha(400, "aviso_invalido", "Aviso inválido.");
    const {error} = await db.from("filtro_avisos").update({ lido_em: new Date().toISOString() })
      .eq("titular", a.userId).eq("id", b.aviso).is("lido_em", null);
    if (error) return falha(503, "aviso_indisponivel", "Tente novamente.");
    return NextResponse.json({ ok: true });
  }
  const id = b.id ?? null;
  if (id !== null && (typeof id !== "string" || !UUID.test(id) || typeof b.ativo !== "boolean")) return falha(400, "filtro_invalido", "Filtro inválido.");
  if (id === null) {
    if (typeof b.nome !== "string" || !b.nome.trim() || b.nome.trim().length > 80 || (b.tipo != null && !["rural","urbano","leilao"].includes(b.tipo))
      || (b.municipio != null && (typeof b.municipio !== "string" || !UUID.test(b.municipio)))
      || typeof b.essenciais !== "string" || b.essenciais.length > 120
      || ["financiamento","permuta","whatsapp"].some(k => typeof b[k] !== "boolean")
      || ["area_min","area_max","preco_min","preco_max"].some(k => b[k] != null && (typeof b[k] !== "number" || !Number.isFinite(b[k]) || b[k]<0 || b[k]>1e14))
      || (b.area_min != null && b.area_max != null && b.area_min>b.area_max) || (b.preco_min != null && b.preco_max != null && b.preco_min>b.preco_max)) {
      return falha(400, "criterios_invalidos", "Confira o nome, o tipo e os limites das faixas.");
    }
  }
  const { data, error } = await db.rpc("fn_filtro_salvar", { p_titular: a.userId, p_id: id, p_ativo: id ? b.ativo : true, p_dados: id ? {} : b });
  if (error) {
    if (error.code === "P9401") return falha(409, "limite_filtros", "Você atingiu seu limite de filtros ativos. Desative um filtro para criar outro.");
    if (error.code === "P9402") return falha(409, "sem_consentimento", "Confirme o consentimento de WhatsApp nas preferências da conta.");
    if (error.code === "42501" || error.code === "P0002") return falha(403, "perfil_incompativel", "O filtro está indisponível neste perfil.");
    return falha(503, "filtro_indisponivel", "Não foi possível salvar. Tente novamente.");
  }
  return NextResponse.json({ id: data });
}