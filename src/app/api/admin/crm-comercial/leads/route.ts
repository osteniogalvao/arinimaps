import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { emailDoProfile, sendEmail } from "@/lib/notify";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { ORIGENS_MANUAIS, TEMPERATURAS, limparEtiquetas } from "@/lib/crm-comercial";

const UUID = /^[0-9a-f-]{36}$/i;
const ORIGENS = ORIGENS_MANUAIS.map((o) => o.id);

type Entrada = {
  codigo_imovel: string; nome: string; telefone: string | null; email: string | null; mensagem: string | null;
  origem: string; temperatura: string | null; etiquetas: string[]; responsavel: string | null; rodizio: boolean;
};

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function validar(b: Record<string, unknown>, autor: string): Entrada | string {
  const codigo = texto(b.codigo_imovel, 40).toUpperCase();
  const nome = texto(b.nome, 180);
  const telefone = texto(b.telefone, 40) || null;
  const email = texto(b.email, 254).toLowerCase() || null;
  if (!codigo) return "Informe o código do imóvel (ex.: AIB-000123).";
  if (!nome) return "Informe o nome do cliente.";
  if (!telefone && !email) return "Informe telefone ou e-mail.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "E-mail inválido.";
  const origem = ORIGENS.includes(String(b.origem)) ? String(b.origem) : "telefone";
  const temperatura = TEMPERATURAS.includes(b.temperatura as never) ? String(b.temperatura) : null;
  const atribuir = String(b.atribuir ?? "rodizio");
  const responsavel = atribuir === "eu" ? autor : UUID.test(atribuir) ? atribuir : null;
  return {
    codigo_imovel: codigo, nome, telefone, email, mensagem: texto(b.mensagem, 2000) || null, origem, temperatura,
    etiquetas: limparEtiquetas(b.etiquetas), responsavel, rodizio: !responsavel,
  };
}

async function criar(e: Entrada, autor: string) {
  const { data, error } = await supabaseAdmin().rpc("fn_crm_lead_manual", {
    p_autor: autor, p_codigo_imovel: e.codigo_imovel, p_nome: e.nome, p_telefone: e.telefone, p_email: e.email,
    p_mensagem: e.mensagem, p_origem: e.origem, p_temperatura: e.temperatura, p_etiquetas: e.etiquetas,
    p_responsavel: e.responsavel, p_rodizio: e.rodizio,
  });
  if (error) {
    if (error.code === "P0001") return { erro: error.message };
    if (/fn_crm_lead_manual/.test(error.message)) return { erro: "Falta rodar a migration 0147 (CRM comercial)." };
    console.error("lead manual:", error.message);
    return { erro: "Não foi possível gravar o lead." };
  }
  return { ok: data as { id: string; codigo: string; responsavel: string | null } };
}

/**
 * Lead cadastrado pela equipe (ligação, balcão, indicação...). Um lead:
 * { codigo_imovel, nome, telefone, email, ... }. Importação: { linhas: [...] }
 * com até 500 leads; devolve quantos entraram e o erro de cada linha recusada.
 */
export async function POST(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Só o Comercial cadastra leads." }, { status: 403 });
  const limite = await limitar(`crm:lead:${a!.userId}`, 30, 600);
  if (!limite.permitido) return respostaLimite(limite, "cadastro");
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (Array.isArray(b.linhas)) {
    if (b.linhas.length > 500) return NextResponse.json({ error: "Importe no máximo 500 leads por vez." }, { status: 400 });
    let criados = 0;
    const erros: { linha: number; erro: string }[] = [];
    for (const [i, l] of (b.linhas as Record<string, unknown>[]).entries()) {
      const e = validar({ ...l, atribuir: b.atribuir ?? "rodizio" }, a!.userId);
      if (typeof e === "string") { erros.push({ linha: i + 1, erro: e }); continue; }
      const r = await criar(e, a!.userId);
      if (r.erro) erros.push({ linha: i + 1, erro: r.erro }); else criados++;
    }
    return NextResponse.json({ ok: true, criados, erros });
  }

  const e = validar(b, a!.userId);
  if (typeof e === "string") return NextResponse.json({ error: e }, { status: 400 });
  const r = await criar(e, a!.userId);
  if (r.erro) return NextResponse.json({ error: r.erro }, { status: 400 });
  // avisa quem recebeu, se não foi a própria pessoa
  if (r.ok?.responsavel && r.ok.responsavel !== a!.userId) {
    const email = await emailDoProfile(r.ok.responsavel);
    await sendEmail(email, `Novo lead para você: ${r.ok.codigo}`,
      `Um lead foi cadastrado na Central e entregue a você (${e.nome}).\n\n` +
      `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin/oportunidades/${r.ok.id}`);
  }
  return NextResponse.json({ ok: true, id: r.ok!.id, codigo: r.ok!.codigo });
}
