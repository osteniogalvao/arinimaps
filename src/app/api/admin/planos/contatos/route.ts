import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request) {
  const a = await ator();
  if (!temSetor(a, "financeiro", "diretoria"))
    return Response.json({ error: "Acesso restrito ao Financeiro." }, { status: 403 });
  const b = await req.json().catch(() => null);
  const tipos = ["recuperacao", "renovacao", "vencimento", "lembrete", "pagamento"];
  if (
    !b ||
    !tipos.includes(b.tipo) ||
    typeof b.ativo !== "boolean" ||
    !Array.isArray(b.dias) ||
    !b.dias.length ||
    !b.dias.every((d: unknown) => typeof d === "string" && /^\d{1,2}$/.test(d)) ||
    typeof b.mensagem !== "string" ||
    b.mensagem.trim().length < 5 ||
    b.mensagem.length > 700 ||
    typeof b.modelo_id !== "string" ||
    !/^\d{0,24}$/.test(b.modelo_id)
  )
    return Response.json({ error: "Confira os dias, o texto e o ID do modelo." }, { status: 400 });
  const dias: number[] = b.dias.map(Number);
  if (
    dias.length > 3 ||
    dias.some((d, i) => d > 90 || (i > 0 && d <= dias[i - 1])) ||
    (b.tipo === "recuperacao" && dias.length > 2) ||
    (b.tipo === "vencimento" && (dias.length !== 1 || dias[0] < 1 || dias[0] > 15)) ||
    (b.tipo === "renovacao" && dias.join() !== "30") ||
    (b.tipo === "pagamento" && dias.join() !== "0")
  )
    return Response.json(
      { error: "Use dias distintos, em ordem crescente e dentro do intervalo desta regra." },
      { status: 400 },
    );
  const valores = { ativo: b.ativo, dias, mensagem: b.mensagem.trim(), modelo_id: b.modelo_id || null };
  const { error } = await supabaseAdmin()
    .from("assinatura_regras_contato")
    .update(valores)
    .eq("tipo", b.tipo);
  if (error) return Response.json({ error: "Não foi possível salvar a regra." }, { status: 503 });
  await logAudit({
    user_id: a!.userId,
    acao: "assinatura.regra_contato",
    entidade: "assinatura_regras_contato",
    dados_depois: { tipo: b.tipo, ...valores },
  });
  return Response.json({ ok: true });
}
