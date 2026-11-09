"use client";

import { useState } from "react";
import { ArrowRight, Lock } from "lucide-react";
import { CAMPO } from "@/components/ui/Pagina";
import { BTN_ACAO } from "@/components/landing/Titulo";
import { destinoSeguro } from "@/lib/seguranca/destino";

const INPUT = CAMPO;

export default function FormAcesso() {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setOcupado(true);
    const volta = new URLSearchParams(window.location.search).get("volta");
    const res = await fetch("/api/acesso", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha, volta }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setOcupado(false);
      setErro(j.error ?? "Não foi possível entrar.");
      return;
    }
    // recarga completa: o cookie novo precisa ir no próximo pedido ao servidor
    // confere de novo aqui: o destino nunca sai do próprio site
    window.location.href = destinoSeguro(j.volta);
  }

  return (
    <form onSubmit={entrar} className="space-y-5">
      <div>
        <span className="grid size-12 place-items-center rounded-2xl bg-verde/12 text-verde">
          <Lock className="size-6" />
        </span>
        <h1 className="lp-display mt-5 text-3xl text-texto md:text-[2.25rem]">Acesso restrito</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-texto-2">
          O Arini Imóveis Brasil está em fase de testes. Digite a senha de acesso para continuar.
        </p>
      </div>
      <input type="password" autoFocus required autoComplete="current-password"
        aria-label="Senha de acesso" placeholder="Senha de acesso" className={INPUT}
        value={senha} onChange={(e) => setSenha(e.target.value)} />
      {erro && <p className="rounded-xl border border-critico/30 bg-critico/10 px-4 py-3 text-sm text-critico" role="alert">{erro}</p>}
      <button type="submit" disabled={ocupado} className={`${BTN_ACAO} w-full disabled:opacity-60`}>
        {ocupado ? "Conferindo…" : <>Entrar <ArrowRight /></>}
      </button>
    </form>
  );
}
