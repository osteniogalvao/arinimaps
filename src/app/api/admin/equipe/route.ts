import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor, type Ator } from "@/lib/authz";
import { SETOR_IDS, setorPorId, type SetorId } from "@/lib/setores";
import { validarSenha } from "@/lib/seguranca/senha";
import { falta0161, limparCargo } from "@/lib/equipe";

/**
 * Funções e acessos por setor (migration 0161; áudios do Carlos, 23/11/2026
 * 17h58). A Diretoria mexe em tudo; o gestor de um setor libera e retira o
 * acesso DAQUELE setor, define a função de quem está nele e cria login de
 * equipe só com os setores que gere. Ninguém ganha papel de Diretoria por aqui
 * (isso continua em Equipe e usuários).
 */
class Erro extends Error { constructor(public msg: string, public status = 400) { super(msg); } }
const UUID = /^[0-9a-f-]{36}$/i;
const SETORES_EQUIPE: SetorId[] = SETOR_IDS.filter((s) => s !== "diretoria");

type Perfil = { user_id: string; nome: string | null; role: string; ativo: boolean; setores: string[] | null; setores_gestor: string[] | null; cargo: string | null; equipe_acesso?: string };

function checar(r: { error: { code?: string; message: string } | null }) {
  if (!r.error) return;
  if (falta0161(r.error.message) || r.error.code === "42703") throw new Erro("Falta rodar a migration 0161 (funções e gestores) no Supabase.", 503);
  if (r.error.code === "23514") throw new Erro("A função pode ter até 40 caracteres.");
  throw new Erro("Falha ao gravar no banco.", 503);
}

async function perfil(userId: unknown): Promise<Perfil> {
  if (typeof userId !== "string" || !UUID.test(userId)) throw new Erro("Pessoa inválida.");
  let r = await supabaseAdmin().from("profiles")
    .select("user_id, nome, role, ativo, setores, setores_gestor, cargo, equipe_acesso").eq("user_id", userId).maybeSingle();
  // sem a 0161 ainda dá para liberar/retirar setor
  if (r.error && falta0161(r.error.message)) {
    r = await supabaseAdmin().from("profiles").select("user_id, nome, role, ativo, setores").eq("user_id", userId).maybeSingle() as typeof r;
  }
  checar(r);
  if (!r.data) throw new Erro("Pessoa não encontrada.", 404);
  if (!["admin_central", "analista_arini"].includes(String(r.data.role))) throw new Erro("Essa conta não é da equipe.");
  return r.data as Perfil;
}

/** Setores que o ator gere: Diretoria, todos; gestor, os marcados. */
async function setoresQueGere(a: Ator): Promise<SetorId[]> {
  if (temSetor(a, "diretoria")) return SETORES_EQUIPE;
  const r = await supabaseAdmin().from("profiles").select("setores_gestor").eq("user_id", a.userId).maybeSingle();
  if (r.error) return []; // sem a 0161 ninguém é gestor
  const meus = (r.data?.setores_gestor ?? []) as string[];
  return SETORES_EQUIPE.filter((s) => meus.includes(s) && a.setores.includes(s));
}

const setorValido = (v: unknown): SetorId => {
  const s = String(v ?? "") as SetorId;
  if (!SETORES_EQUIPE.includes(s)) throw new Erro("Setor inválido.");
  return s;
};

export async function POST(request: Request) {
  try {
    const a = await ator();
    if (!a?.ehArini) throw new Erro("Restrito à equipe.", 403);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const admin = supabaseAdmin();
    const diretoria = temSetor(a, "diretoria");
    const gere = await setoresQueGere(a);
    if (!gere.length) throw new Erro("Só a Diretoria e os gestores de setor organizam acessos.", 403);

    switch (String(b.acao ?? "")) {
      case "acesso": {
        if (!diretoria) throw new Erro("Só a Diretoria define o perfil de leitura.", 403);
        const p = await perfil(b.user_id);
        if (!["operador", "leitura"].includes(String(b.acesso))) throw new Erro("Perfil de acesso inválido.");
        if (b.acesso === "leitura" && (p.role === "admin_central" || p.setores_gestor?.length)) throw new Erro("Diretoria e gestores precisam de acesso de operação. Retire a gestão antes de conceder leitura.");
        checar(await admin.from("profiles").update({ equipe_acesso: b.acesso }).eq("user_id", p.user_id));
        await logAudit({ user_id: a.userId, acao: "equipe_acesso_alterado", entidade: "profiles", entidade_id: p.user_id,
          dados_antes: { equipe_acesso: p.equipe_acesso }, dados_depois: { equipe_acesso: b.acesso } });
        break;
      }
      // libera ou retira o acesso de UM setor (não mexe nos outros)
      case "setor": {
        const setor = setorValido(b.setor);
        if (!gere.includes(setor)) throw new Erro(`Você não gere o setor ${setorPorId(setor)?.nome}.`, 403);
        const p = await perfil(b.user_id);
        if (p.role === "admin_central") throw new Erro("A Diretoria já entra em todos os setores.");
        if (p.user_id === a.userId && !diretoria) throw new Erro("Peça à Diretoria para mudar o seu próprio acesso.", 403);
        const atuais = (p.setores ?? []).filter((s) => s !== "diretoria");
        const ligado = b.ligado === true;
        const setores = ligado ? [...new Set([...atuais, setor])] : atuais.filter((s) => s !== setor);
        const patch: Record<string, unknown> = { setores };
        if (!ligado && p.setores_gestor !== undefined) patch.setores_gestor = (p.setores_gestor ?? []).filter((s) => s !== setor);
        checar(await admin.from("profiles").update(patch).eq("user_id", p.user_id));
        await logAudit({ user_id: a.userId, acao: ligado ? "equipe_setor_liberado" : "equipe_setor_retirado", entidade: "profiles",
          entidade_id: p.user_id, dados_antes: { setores: p.setores }, dados_depois: patch });
        break;
      }
      // nomeia ou tira o gestor de um setor (só Diretoria)
      case "gestor": {
        if (!diretoria) throw new Erro("Só a Diretoria nomeia gestores.", 403);
        const setor = setorValido(b.setor);
        const p = await perfil(b.user_id);
        if (p.role === "admin_central") throw new Erro("A Diretoria já gere todos os setores.");
        const ligado = b.ligado === true;
        if (ligado && p.equipe_acesso === "leitura") throw new Erro("Mude o acesso de leitura para operador antes de nomear gestor.");
        const atuais = (p.setores_gestor ?? []).filter((s) => s !== setor);
        const patch: Record<string, unknown> = { setores_gestor: ligado ? [...atuais, setor] : atuais };
        // gestor precisa atuar no setor
        if (ligado && !(p.setores ?? []).includes(setor)) patch.setores = [...(p.setores ?? []), setor];
        checar(await admin.from("profiles").update(patch).eq("user_id", p.user_id));
        await logAudit({ user_id: a.userId, acao: ligado ? "equipe_gestor_nomeado" : "equipe_gestor_retirado", entidade: "profiles",
          entidade_id: p.user_id, dados_antes: { setores_gestor: p.setores_gestor }, dados_depois: { ...patch, setor } });
        break;
      }
      // função (cargo) da pessoa
      case "cargo": {
        const p = await perfil(b.user_id);
        const alcanca = diretoria || (p.role === "analista_arini" && (p.setores ?? []).some((s) => gere.includes(s as SetorId)));
        if (!alcanca) throw new Erro("Você só define a função de quem trabalha num setor que você gere.", 403);
        const cargo = limparCargo(b.cargo);
        checar(await admin.from("profiles").update({ cargo }).eq("user_id", p.user_id));
        await logAudit({ user_id: a.userId, acao: "equipe_cargo_alterado", entidade: "profiles", entidade_id: p.user_id,
          dados_antes: { cargo: p.cargo }, dados_depois: { cargo } });
        break;
      }
      // login novo da equipe, só nos setores que o ator gere
      case "criar": {
        const nome = String(b.nome ?? "").trim().slice(0, 120);
        const email = String(b.email ?? "").trim().toLowerCase();
        const senha = String(b.senha ?? "");
        if (!nome || !email || !senha) throw new Erro("Preencha nome, e-mail e senha.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Erro("E-mail inválido.");
        const erroSenha = validarSenha(senha);
        if (erroSenha) throw new Erro(erroSenha);
        const pedidos = Array.isArray(b.setores) ? b.setores.map(String) : [];
        const setores = SETORES_EQUIPE.filter((s) => pedidos.includes(s));
        if (!setores.length) throw new Erro("Marque ao menos um setor.");
        const fora = setores.filter((s) => !gere.includes(s));
        if (fora.length) throw new Erro(`Você não gere: ${fora.map((s) => setorPorId(s)?.nome).join(", ")}.`, 403);
        const cargo = limparCargo(b.cargo);

        const { data, error } = await admin.auth.admin.createUser({
          email, password: senha, email_confirm: true, user_metadata: { nome, role: "analista_arini" },
        });
        if (error) throw new Erro(/already/i.test(error.message) ? "Já existe conta com este e-mail." : error.message);
        const r = await admin.from("profiles").update({ role: "analista_arini", nome, setores, cargo })
          .eq("user_id", data.user.id).select("user_id").single();
        if (r.error) {
          // sem a 0161 (cargo) ainda dá para criar o acesso
          const semCargo = falta0161(r.error.message)
            ? await admin.from("profiles").update({ role: "analista_arini", nome, setores }).eq("user_id", data.user.id).select("user_id").single()
            : r;
          if (semCargo.error) {
            await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
            throw new Erro("Não foi possível salvar o perfil. Tente de novo.", 500);
          }
        }
        await logAudit({ user_id: a.userId, acao: "usuario_equipe_criado", entidade: "profiles", entidade_id: data.user.id,
          dados_depois: { email, role: "analista_arini", setores, cargo, por: diretoria ? "diretoria" : "gestor" } });
        return NextResponse.json({ ok: true, user_id: data.user.id });
      }
      default:
        throw new Erro("Ação desconhecida.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Erro) return NextResponse.json({ error: e.msg }, { status: e.status });
    console.error("[api/admin/equipe]", e);
    return NextResponse.json({ error: "Falha inesperada." }, { status: 500 });
  }
}
