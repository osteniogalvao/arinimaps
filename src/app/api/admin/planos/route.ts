import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator } from "@/lib/authz";
import { registrarTentativa } from "@/lib/planos-servidor";
import { COTAS, NICHO_IDS, RECURSO_IDS, type Plano } from "@/lib/planos";

const SLUG = /^[a-z][a-z0-9_]{2,40}$/;
const PERIODICIDADES = ["gratis", "mensal", "anual"];
const ESCOPOS = ["conta", "organizacao"];
const COTA_IDS = COTAS.map((c) => c.id);

type Corpo = Record<string, unknown>;

/** Valida o corpo e devolve os campos prontos para gravar, ou a lista de erros. */
function validar(body: Corpo, { novo }: { novo: boolean }) {
  const erros: string[] = [];
  const patch: Partial<Plano> = {};

  const id = String(body.id ?? "").trim();
  if (!SLUG.test(id)) erros.push("Identificador inválido: use de 3 a 41 caracteres, começando por letra, só minúsculas, números e _.");

  if (body.nome !== undefined || novo) {
    const nome = String(body.nome ?? "").trim();
    if (!nome) erros.push("Informe o nome do plano.");
    else patch.nome = nome.slice(0, 80);
  }
  if (body.descricao !== undefined) patch.descricao = String(body.descricao ?? "").trim().slice(0, 600);

  if (body.preco_mensal !== undefined) {
    const preco = Number(body.preco_mensal);
    if (!Number.isFinite(preco) || preco < 0) erros.push("Preço precisa ser um número maior ou igual a zero.");
    else patch.preco_mensal = Math.round(preco * 100) / 100;
  }
  if (body.periodicidade !== undefined) {
    if (!PERIODICIDADES.includes(String(body.periodicidade))) erros.push("Periodicidade inválida.");
    else patch.periodicidade = body.periodicidade as Plano["periodicidade"];
  }
  for (const coluna of ["preco_anual_centavos", "primeiro_mes_centavos"] as const) {
    const valor = body[coluna];
    if (valor === undefined) continue;
    if (valor === null) patch[coluna] = null;
    else if (typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= 2_147_483_647) patch[coluna] = valor;
    else erros.push("O valor anual e a promoção precisam ser expressos em centavos inteiros positivos ou zero.");
  }
  if (body.escopo !== undefined) {
    if (!ESCOPOS.includes(String(body.escopo))) erros.push("Escopo inválido.");
    else patch.escopo = body.escopo as Plano["escopo"];
  }
  if (body.destaque !== undefined) patch.destaque = body.destaque === true;
  if (body.ativo !== undefined) patch.ativo = body.ativo !== false;
  if (body.ordem !== undefined) {
    const ordem = Number(body.ordem);
    if (!Number.isInteger(ordem) || ordem < 0 || ordem > 10_000) erros.push("Ordem precisa ser um inteiro entre 0 e 10000.");
    else patch.ordem = ordem;
  }
  if (body.nichos_padrao !== undefined) {
    if (!Array.isArray(body.nichos_padrao)) erros.push("Nichos inválidos.");
    else {
      const lista = [...new Set(body.nichos_padrao.map(String))];
      const ruins = lista.filter((n) => !(NICHO_IDS as string[]).includes(n));
      if (ruins.length) erros.push(`Nicho desconhecido: ${ruins.join(", ")}.`);
      else patch.nichos_padrao = lista;
    }
  }
  if (body.recursos !== undefined) {
    if (!Array.isArray(body.recursos)) erros.push("Recursos inválidos.");
    else {
      const lista = [...new Set(body.recursos.map(String))];
      const ruins = lista.filter((r) => !(RECURSO_IDS as string[]).includes(r));
      if (ruins.length) erros.push(`Recurso desconhecido: ${ruins.join(", ")}.`);
      else patch.recursos = lista;
    }
  }
  if (body.cotas !== undefined) {
    if (!body.cotas || typeof body.cotas !== "object" || Array.isArray(body.cotas)) erros.push("Cotas inválidas.");
    else {
      const cotas: Record<string, number> = {};
      for (const [k, v] of Object.entries(body.cotas as Record<string, unknown>)) {
        if (!COTA_IDS.includes(k)) { erros.push(`Cota desconhecida: ${k}.`); continue; }
        if (v === null || v === "") continue;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) { erros.push(`Cota “${k}” precisa ser um inteiro maior ou igual a zero.`); continue; }
        cotas[k] = n;
      }
      patch.cotas = cotas;
    }
  }
  return { id, patch, erros };
}

async function exigirDiretoria(request: Request) {
  const a = await ator();
  if (a?.role !== "admin_central") {
    await registrarTentativa({ request, userId: a?.userId, role: a?.role, planId: a?.acesso.planId, recurso: "setor:diretoria", motivo: a ? "sem_setor" : "sem_sessao" });
    return { a: null, resposta: NextResponse.json(
      { error: "Só a diretoria altera planos.", solucao: "Peça a alguém da diretoria." }, { status: a ? 403 : 401 }) };
  }
  return { a, resposta: null };
}

/** Cria um plano novo. */
export async function POST(request: Request) {
  const { a, resposta } = await exigirDiretoria(request);
  if (!a) return resposta;

  const body = (await request.json().catch(() => ({}))) as Corpo;
  const { id, patch, erros } = validar(body, { novo: true });
  if (erros.length) return NextResponse.json({ error: erros.join(" ") }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: existe } = await admin.from("plans").select("id").eq("id", id).maybeSingle();
  if (existe) return NextResponse.json({ error: `Já existe um plano com o identificador “${id}”.`, solucao: "Escolha outro identificador ou edite o plano existente." }, { status: 400 });

  const novo = {
    id, nome: patch.nome!, descricao: patch.descricao ?? "", nichos_padrao: patch.nichos_padrao ?? [], recursos: patch.recursos ?? [],
    cotas: patch.cotas ?? {}, preco_mensal: patch.preco_mensal ?? 0, periodicidade: patch.periodicidade ?? "mensal",
    preco_anual_centavos: patch.preco_anual_centavos ?? null, primeiro_mes_centavos: patch.primeiro_mes_centavos ?? null,
    escopo: patch.escopo ?? "conta", destaque: patch.destaque ?? false, ativo: patch.ativo ?? true, ordem: patch.ordem ?? 100,
  };
  const { error } = await admin.from("plans").insert(novo);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({ user_id: a.userId, acao: "plano_criado", entidade: "plans", entidade_id: null, dados_depois: novo });
  return NextResponse.json({ ok: true, id });
}

/** Altera um plano existente. */
export async function PATCH(request: Request) {
  const { a, resposta } = await exigirDiretoria(request);
  if (!a) return resposta;

  const body = (await request.json().catch(() => ({}))) as Corpo;
  const { id, patch, erros } = validar(body, { novo: false });
  if (erros.length) return NextResponse.json({ error: erros.join(" ") }, { status: 400 });
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: antes } = await admin.from("plans").select("*").eq("id", id).maybeSingle();
  if (!antes) return NextResponse.json({ error: "Plano não encontrado." }, { status: 404 });

  const { data: depois, error } = await admin.from("plans").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    user_id: a.userId, acao: "plano_alterado", entidade: "plans", entidade_id: null,
    dados_antes: { slug: id, ...(antes as Plano) }, dados_depois: { slug: id, ...(depois as Plano) },
  });
  return NextResponse.json({ ok: true });
}
