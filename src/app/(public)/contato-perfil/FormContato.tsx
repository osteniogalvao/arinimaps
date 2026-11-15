"use client";

import { useState, type FormEvent } from "react";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";

type Props = { perfil: string; proposta: boolean; oferta: string; complementos: string; nome: string; email: string };

export default function FormContato(p: Props) {
  const [protocolo, setProtocolo] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setErro("");
    const campos = new FormData(evento.currentTarget);
    const assunto = (p.proposta ? "Proposta" : "Avise-me") + " · " + p.perfil;
    const mensagem = [assunto, p.oferta, p.complementos, campos.get("organizacao"), campos.get("municipio"), campos.get("mensagem")].filter(Boolean).join("\n");
    try {
      const resposta = await fetch("/api/suporte", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: campos.get("nome"), email: campos.get("email"), telefone: campos.get("telefone"),
          assunto, categoria: "outro", mensagem }) });
      const dados = await resposta.json();
      if (!resposta.ok) throw Error(dados.error ?? "Não foi possível registrar.");
      setProtocolo(dados.codigo);
    } catch (e) { setErro(e instanceof Error ? e.message : "Verifique sua conexão."); }
    finally { setEnviando(false); }
  }
  if (protocolo) return <p className="cartao p-6" role="status">Contato registrado. Seu protocolo é <strong>{protocolo}</strong>.</p>;
  return <form onSubmit={enviar} className="cartao space-y-4 p-6">
    {p.oferta && <p><strong>{p.oferta}</strong></p>}{p.complementos && <p>{p.complementos}</p>}
    <label className={ROTULO}>Nome<input className={CAMPO} name="nome" autoComplete="name" defaultValue={p.nome} minLength={2} maxLength={150} required /></label>
    <label className={ROTULO}>E-mail<input className={CAMPO} name="email" type="email" autoComplete="email" defaultValue={p.email} required /></label>
    <label className={ROTULO}>Telefone (opcional)<input className={CAMPO} name="telefone" type="tel" maxLength={30} /></label>
    <label className={ROTULO}>Organização{p.proposta ? "" : " (opcional)"}<input className={CAMPO} name="organizacao" maxLength={160} required={p.proposta} /></label>
    <label className={ROTULO}>Município e UF<input className={CAMPO} name="municipio" maxLength={120} required /></label>
    <label className={ROTULO}>O que precisa? (opcional)<textarea className={CAMPO} name="mensagem" maxLength={2000} rows={3} /></label>
    {erro && <p role="alert" className="text-critico">{erro}</p>}
    <button className="btn-primario px-5 py-3" disabled={enviando}>{enviando ? "Enviando…" : p.proposta ? "Solicitar proposta" : "Avise-me"}</button>
  </form>;
}

