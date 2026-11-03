"use client";

import { useState } from "react";
import { CircleCheck, Send } from "lucide-react";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import { BTN_ACAO } from "@/components/landing/Titulo";

const PERFIS = [
  "Investidor",
  "Imobiliária ou corretor",
  "Empresa do agronegócio",
  "Loteadora ou incorporadora",
  "Prefeitura ou órgão público",
  "Profissional técnico (engenharia, topografia, georreferenciamento)",
  "Outro",
] as const;

const INTERESSES = [
  "Levar a Arini para a minha cidade ou região",
  "Investir na Arini",
  "Parceria comercial",
  "Parceria tecnológica ou de dados",
  "Outro",
] as const;

const PRAZOS = ["Imediato", "Nos próximos 3 meses", "Nos próximos 6 meses", "Ainda estou avaliando"] as const;

export default function FormExpansao({ nome, email, logado }: { nome: string; email: string; logado: boolean }) {
  const [form, setForm] = useState({
    nome, email, telefone: "", cidade: "", empresa: "",
    perfil: PERFIS[0] as string, interesse: INTERESSES[0] as string, prazo: PRAZOS[3] as string, mensagem: "",
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const muda = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(""); setOk("");
    if (form.telefone.replace(/\D/g, "").length < 10) { setErro("Informe um WhatsApp com DDD para a equipe retornar."); return; }
    setEnviando(true);
    // cai na fila de suporte da equipe, marcado como Expansão Arini
    const mensagem = [
      `Perfil: ${form.perfil}`,
      `Interesse: ${form.interesse}`,
      `Cidade/região: ${form.cidade}`,
      form.empresa ? `Empresa: ${form.empresa}` : "",
      `Prazo: ${form.prazo}`,
      "",
      form.mensagem || "(sem mensagem)",
    ].filter((l, k, a) => l !== "" || (k > 0 && a[k - 1] !== "")).join("\n");
    const res = await fetch("/api/suporte", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: form.nome, email: form.email, telefone: form.telefone, categoria: "outro",
        assunto: `Expansão Arini · ${form.perfil} · ${form.cidade}`.slice(0, 160),
        mensagem,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setEnviando(false);
    if (!res.ok) { setErro(data.error ?? "Não foi possível enviar. Tente de novo."); return; }
    setOk("Recebemos o seu interesse. A equipe Arini vai analisar e entrar em contato pelo WhatsApp ou e-mail.");
    setForm({ ...form, mensagem: "" });
  }

  return (
    <form onSubmit={enviar} className="cartao space-y-5 p-6 md:p-8">
      <div>
        <p className="lp-eyebrow !text-xs">Faça parte da Arini</p>
        <h2 className="lp-display mt-2 text-2xl text-texto md:text-[1.75rem]">Conte sobre você</h2>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={ROTULO} htmlFor="x-nome">Nome *</label>
          <input id="x-nome" required minLength={2} className={CAMPO} value={form.nome} onChange={muda("nome")} />
        </div>
        <div>
          <label className={ROTULO} htmlFor="x-email">E-mail *</label>
          <input id="x-email" required type="email" className={CAMPO} value={form.email} readOnly={logado} onChange={muda("email")} />
        </div>
        <div>
          <label className={ROTULO} htmlFor="x-tel">WhatsApp *</label>
          <input id="x-tel" required className={CAMPO} placeholder="(34) 90000-0000" value={form.telefone} onChange={muda("telefone")} />
        </div>
        <div>
          <label className={ROTULO} htmlFor="x-cid">Cidade e UF *</label>
          <input id="x-cid" required minLength={3} className={CAMPO} placeholder="Ex.: Iturama/MG" value={form.cidade} onChange={muda("cidade")} />
        </div>
        <div>
          <label className={ROTULO} htmlFor="x-perfil">Você é *</label>
          <select id="x-perfil" className={CAMPO} value={form.perfil} onChange={muda("perfil")}>
            {PERFIS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={ROTULO} htmlFor="x-emp">Empresa (opcional)</label>
          <input id="x-emp" className={CAMPO} value={form.empresa} onChange={muda("empresa")} />
        </div>
        <div>
          <label className={ROTULO} htmlFor="x-int">Seu interesse *</label>
          <select id="x-int" className={CAMPO} value={form.interesse} onChange={muda("interesse")}>
            {INTERESSES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={ROTULO} htmlFor="x-prazo">Quando pretende começar</label>
          <select id="x-prazo" className={CAMPO} value={form.prazo} onChange={muda("prazo")}>
            {PRAZOS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={ROTULO} htmlFor="x-msg">Conte um pouco do seu projeto *</label>
        <textarea id="x-msg" required minLength={10} rows={5} className={CAMPO}
          placeholder="O que você imagina fazer com a Arini, sua experiência no setor, região de atuação…"
          value={form.mensagem} onChange={muda("mensagem")} />
      </div>
      {erro && <p className="rounded-xl border border-critico/30 bg-critico/10 px-4 py-3 text-sm text-critico">{erro}</p>}
      {ok && (
        <p className="flex items-start gap-2 rounded-xl border border-verde/30 bg-verde/10 px-4 py-3 text-sm text-verde">
          <CircleCheck className="mt-0.5 size-4 shrink-0" /> {ok}
        </p>
      )}
      <button disabled={enviando} className={`${BTN_ACAO} disabled:opacity-60`}>
        {enviando ? "Enviando…" : <>Enviar interesse <Send /></>}
      </button>
    </form>
  );
}
