"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SENHA_MIN, validarSenha } from "@/lib/seguranca/senha";
import { ArrowRight, CircleCheck, KeyRound, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import TelaDividida from "@/components/publico/TelaDividida";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import { BTN_ACAO } from "@/components/landing/Titulo";
import CampoSenha from "@/components/ui/CampoSenha";

const INPUT = CAMPO;

const BENEFICIOS = [
  { icone: KeyRound, titulo: "Link de uso único", texto: "Cada link vale por 1 hora e funciona uma única vez." },
  { icone: ShieldCheck, titulo: "Senha forte", texto: `Mínimo de ${SENHA_MIN} caracteres, com letras e números.` },
  { icone: LogOut, titulo: "Outros aparelhos saem", texto: "Ao salvar, as outras sessões abertas desta conta são desconectadas." },
];

/**
 * Chegada do link de recuperação. O link traz um token de uso único
 * (`token_hash`, no e-mail enviado por nós) ou um `code` (e-mail padrão do
 * Supabase). Trocado o token por sessão, a pessoa escolhe a senha nova.
 */
export default function RedefinirSenha() {
  const router = useRouter();
  const [estado, setEstado] = useState<"validando" | "pronto" | "invalido" | "feito">("validando");
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  // contas da equipe (item 6.7): etapa extra pedida pelo servidor
  const [etapa, setEtapa] = useState<null | "mfa" | "codigo">(null);
  const [codigo, setCodigo] = useState("");

  useEffect(() => {
    const supabase = supabaseBrowser();
    const q = new URLSearchParams(window.location.search);
    const tokenHash = q.get("token_hash");
    const code = q.get("code");
    (async () => {
      let ok = false;
      if (tokenHash) {
        ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })).error;
      } else if (code) {
        ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
      } else {
        ok = !!(await supabase.auth.getUser()).data.user;
      }
      // tira o token da barra de endereço: ele não deve ficar no histórico
      window.history.replaceState(null, "", "/redefinir-senha");
      setEstado(ok ? "pronto" : "invalido");
    })();
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    const problema = validarSenha(senha);
    if (problema) { setErro(problema); return; }
    if (senha !== confirma) { setErro("As duas senhas não são iguais."); return; }
    setOcupado(true);
    // conta da equipe com segundo fator: confirma o código do aplicativo antes (sessão aal2)
    if (etapa === "mfa") {
      const supabase = supabaseBrowser();
      const { data: fatores } = await supabase.auth.mfa.listFactors();
      const fator = fatores?.totp?.find((f) => f.status === "verified");
      const { error } = fator
        ? await supabase.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo.replace(/[^0-9]/g, "") })
        : { error: new Error("sem fator") };
      await fetch("/api/auth/evento", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evento: error ? "mfa_falhou" : "mfa_ok" }),
      }).catch(() => undefined);
      if (error) { setOcupado(false); setErro("Código incorreto ou vencido. Confira o aplicativo e tente de novo."); return; }
    }
    const res = await fetch("/api/auth/redefinir", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha, ...(etapa === "codigo" && codigo ? { codigo } : {}) }),
    });
    setOcupado(false);
    if (!res.ok) {
      const corpo = await res.json().catch(() => ({}));
      if (corpo.codigo === "mfa_necessario") { setEtapa("mfa"); setCodigo(""); setAviso(corpo.error); return; }
      if (corpo.codigo === "codigo_email_necessario") { setEtapa("codigo"); setCodigo(""); setAviso(corpo.error); return; }
      setErro(corpo.error ?? "Não foi possível salvar a senha.");
      return;
    }
    setEstado("feito");
    setTimeout(() => { router.push("/entrar"); router.refresh(); }, 2500);
  }

  return (
    <TelaDividida eyebrow="Segurança da conta" titulo="Uma senha nova," destaque="em um minuto"
      subtitulo="Escolha a senha nova da sua conta. Depois é só entrar de novo." beneficios={BENEFICIOS}>
        <div className="space-y-5">
          <div>
            <p className="lp-eyebrow !text-xs">Recuperação de senha</p>
            <h1 className="lp-display mt-2 text-3xl text-texto md:text-[2.25rem]">Criar senha nova</h1>
          </div>

          {estado === "validando" && (
            <p className="flex items-center gap-2 text-[15px] text-texto-2">
              <LoaderCircle className="size-4 animate-spin" /> Conferindo o link…
            </p>
          )}

          {estado === "invalido" && (
            <>
              <p className="text-[15px] leading-relaxed text-texto-2">
                Este link expirou ou já foi usado. Cada link vale por 1 hora e funciona uma única vez.
              </p>
              <Link href="/entrar?recuperar=1" className={`${BTN_ACAO} w-full`}>Pedir um link novo <ArrowRight /></Link>
            </>
          )}

          {estado === "pronto" && (
            <form onSubmit={salvar} className="space-y-5">
              <div>
                <label className={ROTULO} htmlFor="nova">Senha nova</label>
                <CampoSenha id="nova" required autoComplete="new-password" className={INPUT}
                  placeholder={`Mínimo ${SENHA_MIN} caracteres, com letras e números`}
                  value={senha} onChange={(e) => setSenha(e.target.value)} />
              </div>
              <div>
                <label className={ROTULO} htmlFor="conf">Repita a senha</label>
                <CampoSenha id="conf" required autoComplete="new-password" className={INPUT}
                  value={confirma} onChange={(e) => setConfirma(e.target.value)} />
              </div>
              {etapa && (
                <div>
                  <label className={ROTULO} htmlFor="codigo">
                    {etapa === "mfa" ? "Código do aplicativo autenticador" : "Código enviado ao seu e-mail"}
                  </label>
                  <input id="codigo" required inputMode="numeric" autoComplete="one-time-code" maxLength={8} className={INPUT}
                    placeholder="000000" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
                  {aviso && <p className="mt-1.5 text-xs text-texto-2">{aviso}</p>}
                </div>
              )}
              {erro && <p className="rounded-xl border border-critico/30 bg-critico/10 px-4 py-3 text-sm text-critico">{erro}</p>}
              <button disabled={ocupado} className={`${BTN_ACAO} w-full disabled:opacity-60`}>
                {ocupado ? "Salvando…" : <>Salvar senha nova <ArrowRight /></>}
              </button>
              <p className="text-sm text-texto-2">
                Ao salvar, os outros aparelhos em que esta conta estiver aberta são desconectados.
              </p>
            </form>
          )}

          {estado === "feito" && (
            <p className="flex items-start gap-2 rounded-xl border border-verde/30 bg-verde/10 px-4 py-3 text-[15px] text-verde">
              <CircleCheck className="mt-0.5 size-5 shrink-0" /> Senha alterada. Levando você para a tela de entrada…
            </p>
          )}
        </div>
    </TelaDividida>
  );
}
