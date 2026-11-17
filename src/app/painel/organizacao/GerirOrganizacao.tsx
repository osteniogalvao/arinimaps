"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Lock, LogOut } from "lucide-react";
import { CAMPO } from "@/components/ui/Pagina";

const input = CAMPO;

async function enviar(corpo: Record<string, unknown>) {
  const res = await fetch("/api/conta/organizacao", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
  const d = await res.json().catch(() => ({}));
  return { ok: res.ok, texto: res.ok ? d.mensagem ?? "Pronto." : [d.error, d.solucao].filter(Boolean).join(" ") || "Não foi possível." };
}

/** Convidar (administrador) e sair da organização (qualquer membro). */
export default function GerirOrganizacao({ souAdmin, podeConvidar }: { souAdmin: boolean; podeConvidar: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<"membro" | "admin">("membro");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function convidar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true); setMsg(null);
    const r = await enviar({ acao: "convidar", email, papel_org: papel });
    setOcupado(false); setMsg(r);
    if (r.ok) { setEmail(""); router.refresh(); }
  }

  async function sair() {
    if (!confirm("Sair da organização? Sua conta volta ao plano pessoal.")) return;
    setOcupado(true);
    const r = await enviar({ acao: "sair" });
    setOcupado(false); setMsg(r);
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      {souAdmin && (
        podeConvidar ? (
          <form onSubmit={convidar} className="cartao space-y-5 p-5 md:p-7">
            <h2 className="lp-display flex items-center gap-3 text-xl md:text-2xl text-texto">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><UserPlus className="size-5" /></span>
              Convidar pessoa
            </h2>
            <div className="flex flex-wrap gap-3">
              <input type="email" required placeholder="e-mail da pessoa" className={input + " min-w-56 flex-1"}
                value={email} onChange={(e) => setEmail(e.target.value)} />
              <select className={input + " !w-auto"} value={papel} onChange={(e) => setPapel(e.target.value as "membro" | "admin")}>
                <option value="membro">Membro</option>
                <option value="admin">Administrador</option>
              </select>
              <button disabled={ocupado} className="btn-verde px-6 py-3 text-sm disabled:opacity-60">Convidar</button>
            </div>
            <p className="text-sm text-texto-2">
              A pessoa recebe um e-mail. Ao entrar (ou criar a conta) com esse mesmo e-mail, ela passa a fazer parte da
              organização e a usar o plano dela.
            </p>
          </form>
        ) : (
          <p className="cartao flex items-start gap-3 p-5 text-base text-texto-2">
            <Lock className="mt-1 size-4 shrink-0 text-ouro" />
            <span>
              O plano atual da organização não inclui “Vários usuários”. Para convidar pessoas,{" "}
              <a href="/planos" className="text-verde hover:underline">escolha um plano com vários usuários</a>; o convite libera assim que o plano é ativado.
            </span>
          </p>
        )
      )}
      {msg && <p className={"text-sm font-semibold " + (msg.ok ? "text-verde" : "text-critico")}>{msg.texto}</p>}
      <button type="button" onClick={sair} disabled={ocupado}
        className="inline-flex items-center gap-1.5 text-sm text-texto-2 hover:text-critico transition-colors">
        <LogOut className="size-4" /> Sair da organização
      </button>
    </div>
  );
}

/** Ações do administrador sobre um membro ou convite. */
export function AcoesMembro({ id, papel, pendente }: { id: string; papel: string; pendente: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function agir(corpo: Record<string, unknown>, confirmar?: string) {
    if (confirmar && !confirm(confirmar)) return;
    setOcupado(true); setErro("");
    const r = await enviar({ ...corpo, membro_id: id });
    setOcupado(false);
    if (r.ok) router.refresh(); else setErro(r.texto);
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      {!pendente && (
        <button type="button" disabled={ocupado} className="btn-contorno px-3 py-1.5 text-xs"
          onClick={() => agir({ acao: "papel", papel_org: papel === "admin" ? "membro" : "admin" })}>
          {papel === "admin" ? "Tornar membro" : "Tornar administrador"}
        </button>
      )}
      <button type="button" disabled={ocupado} className="btn-perigo px-3 py-1.5 text-xs"
        onClick={() => agir({ acao: "remover" }, pendente ? "Cancelar este convite?" : "Remover esta pessoa da organização?")}>
        {pendente ? "Cancelar convite" : "Remover"}
      </button>
      {erro && <span className="text-critico">{erro}</span>}
    </span>
  );
}
