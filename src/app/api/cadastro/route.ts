import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { validarDocumento } from "@/lib/br/documentos";
import { assinatura, ipDe } from "@/lib/juridico";
import { validarSenha } from "@/lib/seguranca/senha";
import { PAPEIS_CADASTRO, ehParceiro as papelEhParceiro } from "@/lib/perfis";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";
import { nichoPorId } from "@/lib/planos";
import { colunasCpf, hashesDeBusca } from "@/lib/seguranca/cripto";

const ROLES_PERMITIDOS: readonly string[] = PAPEIS_CADASTRO;

/**
 * Cria a conta. CPF (ou CNPJ, para imobiliária) é obrigatório e único:
 * é o que amarra a conta a uma pessoa real. O e-mail fica como canal de
 * contato e trilha de auditoria.
 */
export async function POST(request: Request) {
  // criação de conta em massa é o primeiro passo de quase todo abuso
  const limite = await limitar(`cadastro:ip:${ipDoPedido(request)}`, 6, 3600);
  if (!limite.permitido) return respostaLimite(limite, "cadastro");

  const body = await request.json().catch(() => null);
  const { email, senha, nome, telefone, role, nicho, cpf, razao_social, registro_profissional, aceite_termos } = body ?? {};

  if (!email?.trim() || !senha || !nome?.trim()) {
    return NextResponse.json({ error: "Preencha nome, e-mail e senha." }, { status: 400 });
  }
  const erroSenha = validarSenha(String(senha));
  if (erroSenha) return NextResponse.json({ error: erroSenha }, { status: 400 });
  if (!ROLES_PERMITIDOS.includes(role)) {
    return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  }
  // nicho (perfil de uso) é opcional: ausente, o gatilho do banco põe o padrão do papel
  let nichoEscolhido: string | null = null;
  if (nicho) {
    const n = nichoPorId(String(nicho));
    if (!n || !n.escolhivel || !n.papeis.includes(role)) {
      return NextResponse.json({ error: "Perfil de uso inválido para este tipo de conta." }, { status: 400 });
    }
    nichoEscolhido = n.id;
  }

  if (aceite_termos !== true) {
    return NextResponse.json(
      { error: "Para criar a conta é preciso aceitar os Termos de Uso e a Política de Privacidade." },
      { status: 400 }
    );
  }
  const ehParceiro = papelEhParceiro(role);
  const versao = ehParceiro
    ? assinatura("termos-de-uso", "privacidade", "parceiros")
    : assinatura("termos-de-uso", "privacidade");
  const agora = new Date().toISOString();
  const ip = ipDe(request);

  const doc = validarDocumento(cpf ?? "");
  if (!doc.ok) return NextResponse.json({ error: doc.erro }, { status: 400 });
  if (doc.tipo === "cnpj" && role !== "imobiliaria") {
    return NextResponse.json(
      { error: "CNPJ só para imobiliária. Pessoa física cadastra com CPF." },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  // documento já usado? erro claro antes de criar o usuário no Auth.
  // Com CAMPO_CRIPTO_CHAVE o CPF fica cifrado e a busca é pelo hash (item 6.5);
  // a busca em claro continua para as contas antigas.
  const hashes = hashesDeBusca(doc.valor);
  const [{ data: jaEmClaro }, { data: jaPorHash }] = await Promise.all([
    admin.from("profiles").select("user_id").eq("cpf_cnpj", doc.valor).limit(1).maybeSingle(),
    hashes.length
      ? admin.from("profiles").select("user_id").in("cpf_hash", hashes).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (jaEmClaro || jaPorHash) {
    return NextResponse.json(
      { error: "Já existe uma conta com este CPF. Faça login ou recupere a senha." },
      { status: 400 }
    );
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password: senha,
    email_confirm: true,
    // o CPF NÃO vai para o user_metadata: ele viaja dentro do token de sessão
    user_metadata: { nome: nome.trim(), role },
  });
  if (error) {
    const msg = /already/i.test(error.message) ? "Este e-mail já tem cadastro. Faça login." : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const userId = created.user.id;

  const { error: perfilErro } = await admin.from("profiles").update({
    telefone: telefone?.trim() || null,
    ...colunasCpf(doc.valor),
    aceite_termos_at: agora,
    aceite_termos_versao: versao,
    aceite_termos_ip: ip,
    ...(nichoEscolhido ? { nicho: nichoEscolhido } : {}),
  }).eq("user_id", userId).select("user_id").single();
  if (perfilErro) {
    // corrida no índice único: desfaz o usuário para não deixar conta órfã
    const { error: desfazer } = await admin.auth.admin.deleteUser(userId);
    return NextResponse.json(
      { error: desfazer ? "A conta requer conferência da Central antes de tentar novamente." :
        perfilErro.code === "23505" ? "Este CPF acabou de ser cadastrado em outra conta." : "Falha ao concluir o cadastro. Tente novamente." },
      { status: perfilErro.code === "23505" && !desfazer ? 409 : 503 }
    );
  }

  let erroVinculo;
  if (role === "proprietario") {
    ({ error: erroVinculo } = await admin.from("owners").insert({ profile_id: userId, aceite_termos_at: agora, aceite_termos_versao: versao }));
  } else if (ehParceiro) {
    ({ error: erroVinculo } = await admin.from("partners").insert({
      profile_id: userId,
      tipo: role,
      razao_social: razao_social?.trim() || nome.trim(),
      registro_profissional: registro_profissional?.trim() || null,
      aceite_termos_at: agora,
      aceite_termos_versao: versao,
    }));
  }
  if (erroVinculo) {
    const { error: desfazer } = await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: desfazer ? "A conta requer conferência da Central antes de tentar novamente." :
      "Falha ao vincular o perfil ao cadastro. Tente novamente." }, { status: 503 });
  }

  await logAudit({
    user_id: userId,
    acao: "cadastro_criado",
    entidade: "profiles",
    entidade_id: userId,
    dados_depois: { role, nicho: nichoEscolhido, email, documento: doc.tipo, aceite: versao, ip },
  });

  return NextResponse.json({ ok: true });
}
