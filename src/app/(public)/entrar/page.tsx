"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatarCPF, validarDocumento } from "@/lib/br/documentos";
import { lerCarPendente } from "@/lib/map/carPendente";
import { SENHA_MIN, validarSenha } from "@/lib/seguranca/senha";
import { destinoSeguro } from "@/lib/seguranca/destino";
import { REGISTRO_LABEL, ehParceiro as papelEhParceiro, podeAnunciar } from "@/lib/perfis";
import { nichoPadrao, nichosDoPapel } from "@/lib/planos";
import { ArrowLeft, ArrowRight } from "lucide-react";
import TelaDividida from "@/components/publico/TelaDividida";
import { CAMPO, ROTULO as ROTULO_KIT } from "@/components/ui/Pagina";
import { BTN_ACAO } from "@/components/landing/Titulo";

const PERFIS = [
  { value: "comprador", label: "Quero comprar / procurar imóvel" },
  { value: "consulta", label: "Quero apenas consultar áreas e dados" },
  { value: "proprietario", label: "Sou proprietário" },
  { value: "imobiliaria", label: "Sou imobiliária" },
  { value: "corretor", label: "Sou corretor autônomo" },
  { value: "engenheiro", label: "Sou engenheiro / profissional" },
  { value: "leiloeiro", label: "Sou leiloeiro" },
];

const INPUT = CAMPO;
const ROTULO = ROTULO_KIT;

export default function Entrar() {
  const router = useRouter();
  const [modo, setModo] = useState<"login" | "cadastro" | "recuperar" | "mfa">("login");
  const [aviso, setAviso] = useState("");
  const [codigoMfa, setCodigoMfa] = useState("");
  const [destino, setDestino] = useState("/painel");
  // ?volta=/imovel/... (ex.: "Entre para salvar favoritos"): depois do login, volta para a página
  const [volta, setVolta] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [form, setForm] = useState({
    nome: "", email: "", senha: "", telefone: "", cpf: "", role: "comprador",
    nicho: nichoPadrao("comprador") ?? "",
    razao_social: "", registro_profissional: "",
  });
  const [aceite, setAceite] = useState(false);
  // o nicho (perfil de uso) acompanha o papel; só vira pergunta quando há mais de uma opção
  const mudarPapel = (role: string) => setForm((f) => ({ ...f, role, nicho: nichoPadrao(role) ?? "" }));
  const nichosOpcoes = nichosDoPapel(form.role);
  // veio de "Esta área é minha": quem cria conta nesse caminho é proprietário
  useEffect(() => {
    if (lerCarPendente()) mudarPapel("proprietario");
    const q = new URLSearchParams(window.location.search);
    // veio do "Cadastre-se" (home ou /planos): abre a criação de conta já no perfil escolhido
    if (q.get("cadastro")) {
      setModo("cadastro");
      const papel = q.get("papel");
      if (papel && PERFIS.some((p) => p.value === papel) && !lerCarPendente()) {
        const nicho = q.get("nicho");
        setForm((f) => ({
          ...f, role: papel,
          nicho: nicho && nichosDoPapel(papel).some((n) => n.id === nicho) ? nicho : nichoPadrao(papel) ?? "",
        }));
      }
    }
    if (q.get("recuperar")) setModo("recuperar");
    if (q.get("volta")) {
      const v = destinoSeguro(q.get("volta"));
      if (v !== "/" && !v.startsWith("/entrar")) setVolta(v);
    }
    // a Central mandou de volta: a sessão existe, falta confirmar o segundo fator
    if (q.get("mfa")) { setDestino("/admin"); setModo("mfa"); }
    if (q.get("expirou")) {
      supabaseBrowser().auth.signOut();
      setAviso("Sua sessão na Central expirou. Entre de novo.");
    }
  }, []);

  const ehParceiro = papelEhParceiro(form.role);
  const docInvalido = form.cpf.length > 0 && !validarDocumento(form.cpf).ok;

  function destinoDe(role: string) {
    // clicou numa área do CAR antes de entrar: volta direto para anunciá-la
    const carPendente = lerCarPendente();
    const anuncia = podeAnunciar(role);
    if (volta && !carPendente) return volta;
    return role === "admin_central" || role === "analista_arini" ? "/admin"
      : carPendente && anuncia ? `/painel/novo?car=${encodeURIComponent(carPendente)}`
      : ["comprador", "consulta"].includes(role) ? "/mapa"
      : "/painel";
  }

  // O login passa pelo servidor: é lá que as tentativas são contadas e registradas.
  async function entrar() {
    const res = await fetch("/api/auth/entrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email, senha: form.senha }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Não foi possível entrar.");
    const para = destinoDe(data.role);
    if (data.mfa) {
      // conta com segundo fator: a sessão só vale depois do código
      setDestino(para);
      setModo("mfa");
      setCarregando(false);
      return;
    }
    router.push(para);
    router.refresh();
  }

  async function confirmarMfa() {
    const supabase = supabaseBrowser();
    const { data: fatores } = await supabase.auth.mfa.listFactors();
    const fator = fatores?.totp?.find((f) => f.status === "verified");
    if (!fator) throw new Error("Nenhum segundo fator ativo nesta conta.");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigoMfa.replace(/[^0-9]/g, "") });
    await fetch("/api/auth/evento", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evento: error ? "mfa_falhou" : "mfa_ok" }),
    }).catch(() => undefined);
    if (error) throw new Error("Código incorreto ou vencido. Confira o aplicativo e tente de novo.");
    router.push(destino);
    router.refresh();
  }

  async function pedirRecuperacao() {
    const res = await fetch("/api/auth/recuperar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Não foi possível enviar o link.");
    setAviso(data.mensagem);
    setCarregando(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCarregando(true);
    setAviso("");
    try {
      if (modo === "recuperar") { await pedirRecuperacao(); return; }
      if (modo === "mfa") { await confirmarMfa(); return; }
      if (modo === "cadastro") {
        const problema = validarSenha(form.senha);
        if (problema) throw new Error(problema);
        const res = await fetch("/api/cadastro", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, aceite_termos: aceite }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Falha no cadastro.");
      }
      await entrar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Algo deu errado.");
      setCarregando(false);
    }
  }

  return (
    <TelaDividida>
        <form onSubmit={submit} className="space-y-5">
          <div>
            <p className="lp-eyebrow !text-xs">
              {modo === "cadastro" ? "Nova conta" : modo === "login" ? "Bem-vindo de volta" : "Segurança da conta"}
            </p>
            <h1 className="lp-display mt-2 text-3xl text-texto md:text-[2.25rem]">
              {modo === "login" ? "Entrar na sua conta"
                : modo === "cadastro" ? "Criar conta"
                : modo === "recuperar" ? "Recuperar a senha"
                : "Confirme que é você"}
            </h1>
            {(modo === "recuperar" || modo === "mfa") && (
              <p className="mt-2 text-[15px] leading-relaxed text-texto-2">
                {modo === "recuperar"
                  ? "Informe o e-mail da conta. Enviamos um link de uso único para criar uma senha nova."
                  : "Digite o código de 6 dígitos do seu aplicativo autenticador."}
              </p>
            )}
          </div>

          <div className={"grid-cols-2 gap-1 rounded-xl border border-linha bg-superficie-2 p-1 text-sm font-bold " + (modo === "login" || modo === "cadastro" ? "grid" : "hidden")}>
            {(["login", "cadastro"] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setModo(m); setErro(""); setAviso(""); }}
                aria-pressed={modo === m}
                className={
                  "rounded-[10px] py-2.5 transition " +
                  (modo === m ? "bg-superficie text-texto shadow-sm ring-1 ring-linha" : "text-texto-2 hover:text-texto")
                }>
                {m === "login" ? "Entrar" : "Criar conta"}
              </button>
            ))}
          </div>

          {modo === "cadastro" && (
            <>
              <div>
                <label className={ROTULO} htmlFor="perfil">Como você usa o sistema</label>
                <select id="perfil" className={INPUT} value={form.role}
                  onChange={(e) => mudarPapel(e.target.value)}>
                  {PERFIS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              {nichosOpcoes.length > 1 && (
                <div>
                  <label className={ROTULO} htmlFor="nicho">Qual é o seu perfil de uso?</label>
                  <select id="nicho" className={INPUT} value={form.nicho}
                    onChange={(e) => setForm({ ...form, nicho: e.target.value })}>
                    {nichosOpcoes.map((n) => <option key={n.id} value={n.id}>{n.nome} — {n.descricao}</option>)}
                  </select>
                  <p className="mt-1.5 text-xs text-texto-2">Define o plano com que a conta começa. A Arini pode ajustar depois.</p>
                </div>
              )}

              <div>
                <label className={ROTULO} htmlFor="nome">Nome completo *</label>
                <input id="nome" required placeholder="Como no documento" className={INPUT}
                  value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              </div>

              <div>
                <label className={ROTULO} htmlFor="cpf">
                  {form.role === "imobiliaria" ? "CPF ou CNPJ *" : "CPF *"}
                </label>
                <input id="cpf" required inputMode="numeric" placeholder="000.000.000-00"
                  className={INPUT + (docInvalido ? " border-critico focus:ring-critico" : "")}
                  value={formatarCPF(form.cpf)}
                  onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
                <p className={"mt-1.5 text-xs " + (docInvalido ? "text-critico" : "text-texto-2")}>
                  {docInvalido
                    ? "Documento inválido — confira os números."
                    : "Identifica a conta e mantém cada negociação rastreável."}
                </p>
              </div>

              <div>
                <label className={ROTULO} htmlFor="tel">WhatsApp / telefone</label>
                <input id="tel" placeholder="(34) 90000-0000" className={INPUT}
                  value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
              </div>

              {ehParceiro && (
                <>
                  <div>
                    <label className={ROTULO} htmlFor="razao">
                      {form.role === "imobiliaria" ? "Razão social" : "Nome profissional"}
                    </label>
                    <input id="razao" className={INPUT}
                      value={form.razao_social}
                      onChange={(e) => setForm({ ...form, razao_social: e.target.value })} />
                  </div>
                  <div>
                    <label className={ROTULO} htmlFor="registro">
                      {REGISTRO_LABEL[form.role] ?? "Registro profissional"}
                    </label>
                    <input id="registro" className={INPUT}
                      value={form.registro_profissional}
                      onChange={(e) => setForm({ ...form, registro_profissional: e.target.value })} />
                  </div>
                </>
              )}
            </>
          )}

          {modo === "mfa" && (
            <div>
              <label className={ROTULO} htmlFor="mfa">Código de verificação</label>
              <input id="mfa" required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7}
                placeholder="000 000" className={INPUT + " tracking-[0.4em] text-center text-lg"}
                value={codigoMfa} onChange={(e) => setCodigoMfa(e.target.value)} />
            </div>
          )}

          <div className={modo === "mfa" ? "hidden" : ""}>
            <label className={ROTULO} htmlFor="email">E-mail *</label>
            <input id="email" required={modo !== "mfa"} type="email" placeholder="seu@email.com" className={INPUT}
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>

          {(modo === "login" || modo === "cadastro") && (
            <div>
              <label className={ROTULO} htmlFor="senha">Senha *</label>
              <input id="senha" required type="password" className={INPUT}
                autoComplete={modo === "login" ? "current-password" : "new-password"}
                placeholder={modo === "login" ? "Sua senha" : `Mínimo ${SENHA_MIN} caracteres, com letras e números`}
                value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
              {modo === "login" && (
                <button type="button" onClick={() => { setModo("recuperar"); setErro(""); setAviso(""); }}
                  className="mt-2 text-sm font-semibold text-verde hover:underline">
                  Esqueci minha senha
                </button>
              )}
            </div>
          )}

          {modo === "cadastro" && (
            <div className="space-y-2">
              <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-texto-2">
                <input type="checkbox" required checked={aceite}
                  onChange={(e) => setAceite(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--verde)]" />
                <span>
                  Li e aceito os{" "}
                  <Link href="/termos/termos-de-uso" target="_blank" className="font-semibold text-verde hover:underline">Termos de Uso</Link>
                  {ehParceiro && <>, o{" "}
                    <Link href="/termos/parceiros" target="_blank" className="font-semibold text-verde hover:underline">Termo de Parceria</Link>
                  </>}
                  {" "}e a{" "}
                  <Link href="/termos/privacidade" target="_blank" className="font-semibold text-verde hover:underline">Política de Privacidade</Link>.
                </span>
              </label>
              {!["comprador", "consulta"].includes(form.role) && (
                <p className="text-xs text-texto-2">
                  Cadastros de proprietário e parceiro passam pela análise da Arini antes de anunciar.
                </p>
              )}
            </div>
          )}
          {erro && <p className="rounded-xl border border-critico/30 bg-critico/10 px-4 py-3 text-sm text-critico">{erro}</p>}
          {aviso && <p className="rounded-xl border border-verde/30 bg-verde/10 px-4 py-3 text-sm text-verde">{aviso}</p>}

          <button disabled={carregando} className={`${BTN_ACAO} w-full disabled:opacity-60`}>
            {carregando ? "Aguarde…"
              : <>{modo === "login" ? "Entrar"
                : modo === "cadastro" ? "Criar conta"
                : modo === "recuperar" ? "Enviar link"
                : "Confirmar código"} <ArrowRight /></>}
          </button>

          {(modo === "recuperar" || modo === "mfa") && (
            <button type="button" className="flex w-full items-center justify-center gap-1.5 text-sm font-semibold text-texto-2 hover:text-texto"
              onClick={async () => {
                if (modo === "mfa") await supabaseBrowser().auth.signOut();
                setModo("login"); setErro(""); setAviso(""); setCodigoMfa("");
              }}>
              <ArrowLeft className="size-4" /> Voltar para o login
            </button>
          )}
        </form>
    </TelaDividida>
  );
}
