"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SENHA_MIN, validarSenha } from "@/lib/seguranca/senha";
import {
  ShieldAlert, Smartphone, QrCode, KeyRound, MonitorSmartphone, LogOut, Activity, type LucideIcon,
} from "lucide-react";
import { CAMPO, ROTULO, Etiqueta } from "@/components/ui/Pagina";
import { formatDataHora } from "@/lib/format";

type Evento = { id: string; evento: string; ip: string | null; agente: string | null; created_at: string };
type Fator = { id: string; status: string; friendly_name?: string | null; created_at: string };

const input = CAMPO;

const EVENTO: Record<string, string> = {
  login_ok: "Entrada na conta", login_falhou: "Tentativa com senha errada", login_bloqueado: "Tentativas bloqueadas",
  logout: "Saída", recuperacao_pedida: "Pedido de recuperação de senha", senha_redefinida: "Senha redefinida pelo link",
  senha_alterada: "Senha trocada", mfa_ativado: "Segundo fator ativado", mfa_desativado: "Segundo fator desativado",
  mfa_ok: "Segundo fator confirmado", mfa_falhou: "Código do segundo fator errado", sessoes_encerradas: "Outras sessões encerradas",
};

const registrar = (evento: string) =>
  fetch("/api/auth/evento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evento }) })
    .catch(() => undefined);

export default function Seguranca({
  eventos, obrigatorio, exigidoDaEquipe,
}: { eventos: Evento[]; obrigatorio: boolean; exigidoDaEquipe: boolean }) {
  const router = useRouter();
  const supabase = supabaseBrowser();

  // ---------- segundo fator ----------
  const [fatores, setFatores] = useState<Fator[] | null>(null);
  const [cadastro, setCadastro] = useState<{ id: string; qr: string; segredo: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erroMfa, setErroMfa] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregarFatores = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFatores((data?.all ?? []) as Fator[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { carregarFatores(); }, [carregarFatores]);

  const ativo = fatores?.find((f) => f.status === "verified") ?? null;

  async function iniciarCadastro() {
    setOcupado(true); setErroMfa("");
    // sobras de um cadastro que não foi concluído impedem um novo com o mesmo nome
    for (const f of fatores ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `ARINI ${Date.now()}` });
    setOcupado(false);
    if (error || !data) { setErroMfa(error?.message ?? "Não foi possível iniciar."); return; }
    setCadastro({ id: data.id, qr: data.totp.qr_code, segredo: data.totp.secret });
  }

  async function confirmarCadastro(e: React.FormEvent) {
    e.preventDefault();
    if (!cadastro) return;
    setOcupado(true); setErroMfa("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: cadastro.id, code: codigo.replace(/[^0-9]/g, "") });
    setOcupado(false);
    if (error) { setErroMfa("Código incorreto. Confira o aplicativo e o horário do celular."); return; }
    await registrar("mfa_ativado");
    setCadastro(null); setCodigo("");
    await carregarFatores();
    router.refresh();
  }

  async function desativar() {
    if (!ativo) return;
    if (!window.confirm("Desativar o segundo fator? A conta volta a depender só da senha.")) return;
    setOcupado(true); setErroMfa("");
    const { error } = await supabase.auth.mfa.unenroll({ factorId: ativo.id });
    setOcupado(false);
    if (error) {
      setErroMfa(/aal2/i.test(error.message)
        ? "Para desativar, saia e entre de novo confirmando o código do aplicativo."
        : error.message);
      return;
    }
    await registrar("mfa_desativado");
    await carregarFatores();
    router.refresh();
  }

  // ---------- senha ----------
  const [senha, setSenha] = useState({ atual: "", nova: "", confirma: "" });
  const [msgSenha, setMsgSenha] = useState<{ ok: boolean; texto: string } | null>(null);

  async function trocarSenha(e: React.FormEvent) {
    e.preventDefault();
    setMsgSenha(null);
    const problema = validarSenha(senha.nova);
    if (problema) { setMsgSenha({ ok: false, texto: problema }); return; }
    if (senha.nova !== senha.confirma) { setMsgSenha({ ok: false, texto: "As duas senhas novas não são iguais." }); return; }
    setOcupado(true);
    const res = await fetch("/api/auth/redefinir", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: senha.nova, senha_atual: senha.atual }),
    });
    setOcupado(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsgSenha({ ok: false, texto: data.error ?? "Não foi possível trocar a senha." }); return; }
    setSenha({ atual: "", nova: "", confirma: "" });
    setMsgSenha({ ok: true, texto: "Senha trocada. Os outros aparelhos foram desconectados." });
    router.refresh();
  }

  // ---------- sessões ----------
  const [msgSessao, setMsgSessao] = useState("");
  async function encerrarOutras() {
    setOcupado(true);
    await supabase.auth.signOut({ scope: "others" });
    await registrar("sessoes_encerradas");
    setOcupado(false);
    setMsgSessao("Pronto: só este aparelho continua conectado.");
    router.refresh();
  }
  async function sair() {
    await registrar("logout");
    await supabase.auth.signOut();
    router.push("/entrar");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {(obrigatorio || (exigidoDaEquipe && fatores && !ativo)) && (
        <p className="flex items-start gap-3 rounded-2xl border border-ouro/50 bg-ouro/10 px-5 py-4 text-base text-texto">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-ouro" />
          A diretoria exige o segundo fator para as contas da equipe. Ative-o abaixo para voltar à Central.
        </p>
      )}

      <Bloco icone={Smartphone} titulo="Verificação em duas etapas"
        texto="Além da senha, o login pede um código de 6 dígitos gerado no seu celular. Quem descobrir a senha não entra sem o aparelho."
        etiqueta={fatores ? <Etiqueta tom={ativo ? "verde" : "alerta"}>{ativo ? "ativa" : "desativada"}</Etiqueta> : null}>
        <div className="space-y-5">
          {!fatores && <p className="text-base text-texto-2">Carregando…</p>}

          {fatores && !ativo && !cadastro && (
            <button onClick={iniciarCadastro} disabled={ocupado} className="btn-verde inline-flex items-center gap-2 px-5 py-3 text-sm disabled:opacity-60">
              <QrCode className="size-4" /> Ativar com aplicativo autenticador
            </button>
          )}

          {cadastro && (
            <form onSubmit={confirmarCadastro} className="space-y-5">
              <ol className="list-decimal space-y-1.5 pl-5 text-base text-texto-2">
                <li>Instale um autenticador no celular (Google Authenticator, Microsoft Authenticator ou Authy).</li>
                <li>No aplicativo, escolha adicionar conta e aponte a câmera para o código abaixo.</li>
                <li>Digite aqui o código de 6 dígitos que o aplicativo mostrar.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-5 rounded-xl bg-superficie-2 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cadastro.qr} alt="Código QR para o aplicativo autenticador" className="h-44 w-44 rounded-xl bg-white p-2" />
                <div className="space-y-1 text-sm text-texto-2">
                  <p>Sem câmera? Digite esta chave no aplicativo:</p>
                  <p className="max-w-56 select-all break-all font-mono text-texto">{cadastro.segredo}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={ROTULO} htmlFor="cod">Código do aplicativo</label>
                  <input id="cod" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000 000"
                    className={input + " !w-44 text-center tracking-[0.35em]"} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
                </div>
                <button disabled={ocupado} className="btn-verde px-5 py-3 text-sm disabled:opacity-60">Confirmar e ativar</button>
                <button type="button" onClick={() => { setCadastro(null); setCodigo(""); }} className="px-2 py-3 text-sm font-semibold text-texto-2 hover:text-texto">Cancelar</button>
              </div>
            </form>
          )}

          {ativo && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-base text-texto-2">
                Ativa desde {formatDataHora(ativo.created_at, false)}. Trocou de celular? Desative e ative de novo no aparelho novo.
              </p>
              <button onClick={desativar} disabled={ocupado} className="btn-perigo px-4 py-2 text-sm">
                Desativar
              </button>
            </div>
          )}
          {erroMfa && <p className="text-sm font-semibold text-critico">{erroMfa}</p>}
        </div>
      </Bloco>

      <Bloco icone={KeyRound} titulo="Trocar a senha">
        <form onSubmit={trocarSenha} className="grid gap-4 sm:grid-cols-3">
          <input required type="password" autoComplete="current-password" className={input} placeholder="Senha atual"
            value={senha.atual} onChange={(e) => setSenha({ ...senha, atual: e.target.value })} />
          <input required type="password" autoComplete="new-password" className={input} placeholder={`Nova (mín. ${SENHA_MIN})`}
            value={senha.nova} onChange={(e) => setSenha({ ...senha, nova: e.target.value })} />
          <input required type="password" autoComplete="new-password" className={input} placeholder="Repita a nova"
            value={senha.confirma} onChange={(e) => setSenha({ ...senha, confirma: e.target.value })} />
          <button disabled={ocupado} className="btn-contorno justify-self-start px-5 py-3 text-sm disabled:opacity-60 sm:col-span-3">
            Trocar senha
          </button>
        </form>
        {msgSenha && <p className={"mt-4 text-sm font-semibold " + (msgSenha.ok ? "text-verde" : "text-critico")}>{msgSenha.texto}</p>}
      </Bloco>

      <Bloco icone={MonitorSmartphone} titulo="Sessões"
        texto="Se você entrou num computador que não é seu e esqueceu de sair, encerre as outras sessões daqui.">
        <div className="flex flex-wrap gap-3">
          <button onClick={encerrarOutras} disabled={ocupado} className="btn-contorno px-5 py-3 text-sm disabled:opacity-60">
            Encerrar as outras sessões
          </button>
          <button onClick={sair} className="inline-flex items-center gap-2 rounded-[10px] border border-linha px-5 py-3 text-sm font-semibold text-texto-2 transition-colors hover:text-texto">
            <LogOut className="size-4" /> Sair deste aparelho
          </button>
        </div>
        {msgSessao && <p className="mt-4 text-sm font-semibold text-verde">{msgSessao}</p>}
      </Bloco>

      <Bloco icone={Activity} titulo="Atividade recente">
        <div className="divide-y divide-linha rounded-xl border border-linha">
          {eventos.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-superficie-2/60">
              <span className="text-[0.95rem] text-texto">{EVENTO[e.evento] ?? e.evento}</span>
              <span className="text-xs text-texto-2 tabular-nums">
                {formatDataHora(e.created_at)}{e.ip && ` · ${e.ip}`}
              </span>
            </div>
          ))}
          {!eventos.length && <p className="px-4 py-4 text-base text-texto-2">Nenhuma atividade registrada ainda.</p>}
        </div>
        <p className="mt-3 text-sm text-texto-2">Viu um acesso que não reconhece? Troque a senha e encerre as outras sessões.</p>
      </Bloco>
    </div>
  );
}

function Bloco({ icone: Icone, titulo, texto, etiqueta, children }: {
  icone: LucideIcon; titulo: string; texto?: string; etiqueta?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="cartao p-5 md:p-7">
      <header className="mb-5 flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde">
          <Icone className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="lp-display text-xl md:text-2xl text-texto">{titulo}</h2>
          {texto && <p className="mt-1 text-sm leading-relaxed text-texto-2 md:text-base">{texto}</p>}
        </div>
        {etiqueta}
      </header>
      {children}
    </section>
  );
}
