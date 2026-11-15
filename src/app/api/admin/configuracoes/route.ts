import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { TODOS_CAMPOS, CHAVES_VALIDAS, validarCampo } from "@/lib/configuracoes";

export async function POST(request: Request) {
  const a = await ator();
  if (!a || !temSetor(a, "diretoria")) return NextResponse.json({ error: "Configurações são da diretoria." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = supabaseAdmin();

  const paraGravar: { chave: string; valor: unknown; updated_at: string }[] = [];
  const erros: string[] = [];

  for (const [chave, bruto] of Object.entries(body)) {
    if (!CHAVES_VALIDAS.has(chave)) continue;
    const campo = TODOS_CAMPOS.find((c) => c.chave === chave)!;
    if (campo.somenteDiretoria && a.role !== "admin_central") {
      erros.push(`${campo.rotulo}: só a diretoria altera.`);
      continue;
    }
    const r = validarCampo(campo, bruto);
    if ("erro" in r) { erros.push(r.erro); continue; }
    paraGravar.push({ chave, valor: r.valor, updated_at: new Date().toISOString() });
  }

  if (erros.length) return NextResponse.json({ error: erros.join(" ") }, { status: 400 });
  if (!paraGravar.length) return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });

  const { error } = await admin.from("settings").upsert(paraGravar as never);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (paraGravar.some(c => c.chave === "cotacoes_cepea_autorizado")) revalidateTag("cotacoes", { expire: 0 });
  await logAudit({
    user_id: a.userId, acao: "configuracoes_alteradas", entidade: "settings",
    dados_depois: Object.fromEntries(paraGravar.map((p) => [p.chave, p.valor])),
  });
  return NextResponse.json({ ok: true, salvos: paraGravar.length });
}
