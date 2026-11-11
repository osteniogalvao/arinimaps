"use client";

import { useState } from "react";
import { CircleCheck, MessageCircle, Send } from "lucide-react";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";

/** UTM da campanha que trouxe o visitante (anúncio pago): vai junto com o lead. */
function lerUtm() {
  const utm: Record<string, string> = {};
  try {
    const guardado = JSON.parse(sessionStorage.getItem("arini-utm") ?? "{}") as Record<string, string>;
    Object.assign(utm, guardado);
    const p = new URLSearchParams(window.location.search);
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      const v = p.get(k);
      if (v) utm[k] = v;
    }
    if (Object.keys(utm).length) sessionStorage.setItem("arini-utm", JSON.stringify(utm));
  } catch { /* armazenamento bloqueado */ }
  return utm;
}

export default function InteresseForm({
  codigo, titulo, whatsapp,
}: { codigo: string; titulo: string; whatsapp: string | null }) {
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok" | "erro">("idle");
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({ nome: "", telefone: "", email: "", mensagem: "", consentimento: false });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    setErro("");
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, ...form, utm: lerUtm() }),
    });
    const data = await res.json();
    if (res.ok) setEstado("ok");
    else {
      setEstado("erro");
      setErro(data.error ?? "Não foi possível enviar. Tente novamente.");
    }
  }

  const linkWhats = whatsapp
    ? `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Olá! Tenho interesse no imóvel ${codigo} — ${titulo}.`
      )}`
    : null;

  return (
    <div id="interesse" className="scroll-mt-24 space-y-3">
      {estado === "ok" ? (
        <div className="lp-escuro lp-malha-escura relative overflow-hidden rounded-[20px] p-7 text-center">
          <div className="lp-grade pointer-events-none absolute inset-0 opacity-60" aria-hidden />
          <div className="relative">
            <span className="mx-auto grid size-14 place-items-center rounded-full border border-[#D9BD6F]/60 text-[#D9BD6F]">
              <CircleCheck className="size-7" />
            </span>
            <p className="lp-display mt-4 text-2xl text-texto">Interesse registrado!</p>
            <p className="mt-2 text-base text-texto-2">A equipe da Arini vai falar com você em breve.</p>
          </div>
        </div>
      ) : (
        <form onSubmit={enviar} className="cartao space-y-4 p-6 md:p-7">
          <div>
            <p className="lp-eyebrow !text-xs">Tenho interesse</p>
            <p className="lp-display mt-3 text-[1.9rem] text-texto">Receba todos os detalhes</p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-texto-2">
              Preencha seus dados e falaremos com você pelo WhatsApp.
            </p>
          </div>

          <div>
            <label className={ROTULO} htmlFor="nome">Nome completo *</label>
            <input id="nome" required placeholder="Seu nome" className={CAMPO}
              value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div>
            <label className={ROTULO} htmlFor="tel">Telefone / WhatsApp *</label>
            <input id="tel" required placeholder="(00) 00000-0000" className={CAMPO} inputMode="tel"
              value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
          </div>
          <div>
            <label className={ROTULO} htmlFor="email">E-mail</label>
            <input id="email" type="email" placeholder="seu@email.com" className={CAMPO}
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className={ROTULO} htmlFor="msg">Mensagem</label>
            <textarea id="msg" rows={2} placeholder="Quero agendar uma visita…" className={CAMPO}
              value={form.mensagem} onChange={(e) => setForm({ ...form, mensagem: e.target.value })} />
          </div>

          <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-texto-2">
            <input type="checkbox" required checked={form.consentimento}
              onChange={(e) => setForm({ ...form, consentimento: e.target.checked })} className="mt-1 size-4 shrink-0 accent-[var(--verde)]" />
            <span>
              Autorizo a Arini a entrar em contato sobre este imóvel, conforme a{" "}
              <a href="/termos/privacidade" target="_blank" className="font-semibold text-verde hover:underline">Política de Privacidade</a>.
            </span>
          </label>

          {erro && <p className="rounded-xl border border-critico/30 bg-critico/10 px-4 py-3 text-sm text-critico">{erro}</p>}

          <button disabled={estado === "enviando"} className="lp-btn lp-btn-verde w-full disabled:opacity-60">
            {estado === "enviando" ? "Enviando…" : <>Quero saber mais <Send /></>}
          </button>
        </form>
      )}

      {linkWhats && (
        <a href={linkWhats} target="_blank" rel="noreferrer"
          className="lp-btn lp-btn-contorno w-full">
          <MessageCircle /> Chamar no WhatsApp
        </a>
      )}
    </div>
  );
}
