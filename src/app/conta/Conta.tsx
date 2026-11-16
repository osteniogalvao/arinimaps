"use client";
import CamposProfissao from "@/components/conta/CamposProfissao";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/shell/Avatar";
import { aplicarTemaPreferido } from "@/components/shell/BotaoTema";
import { recarregarPreferencias, usePreferencias } from "@/lib/usePreferencias";
import type { Preferencias } from "@/lib/preferencias";
import {
  MailOpen, Camera, Upload, UserRound, SlidersHorizontal, Sun, Moon, Monitor, Satellite, Map as MapIcon, type LucideIcon,
} from "lucide-react";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";

const input = CAMPO;
const rotulo = ROTULO;

const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];
const MAX_FOTO = 3 * 1024 * 1024;
const LADO = 512;

type Convite = { id: string; org: string; tipo: string; papel: string; emOutra: boolean };

/**
 * Reduz a foto no navegador: recorte quadrado central, 512 px, WebP. Assim o
 * envio é pequeno (dezenas de KB) e a foto já sai no formato do círculo.
 */
async function reduzir(arquivo: File): Promise<Blob> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, erro) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => erro(new Error("Não foi possível ler a imagem."));
      i.src = url;
    });
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    const destino = Math.min(LADO, lado);
    const canvas = document.createElement("canvas");
    canvas.width = destino; canvas.height = destino;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Seu navegador não conseguiu preparar a imagem.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, destino, destino);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.86));
    if (!blob) throw new Error("Não foi possível converter a imagem.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Conta({
  inicial, convites,
}: {
  inicial: { nome: string; telefone: string; avatar: string | null; profissao_declarada:string; especialidade:string; avisos_email:boolean; preferencias: Preferencias };
  convites: Convite[];
}) {
  const router = useRouter();

  // ---------- foto ----------
  const [avatar, setAvatar] = useState(inicial.avatar);
  const [fotoMsg, setFotoMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  async function trocarFoto(arquivo: File) {
    setFotoMsg(null);
    if (!TIPOS_FOTO.includes(arquivo.type)) { setFotoMsg({ ok: false, texto: "Use uma foto JPG, PNG ou WebP." }); return; }
    if (arquivo.size > MAX_FOTO) { setFotoMsg({ ok: false, texto: "A foto passa de 3 MB. Escolha uma menor." }); return; }
    setEnviandoFoto(true);
    try {
      const blob = await reduzir(arquivo);
      const fd = new FormData();
      fd.set("foto", blob, blob.type === "image/webp" ? "foto.webp" : "foto.png");
      const res = await fetch("/api/conta/avatar", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setFotoMsg({ ok: false, texto: [d.error, d.solucao].filter(Boolean).join(" ") || "Não foi possível enviar." }); return; }
      setAvatar(d.avatar_url);
      setFotoMsg({ ok: true, texto: "Foto atualizada." });
      void recarregarPreferencias();
      router.refresh();
    } catch (e) {
      setFotoMsg({ ok: false, texto: e instanceof Error ? e.message : "Não foi possível enviar." });
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function removerFoto() {
    setEnviandoFoto(true); setFotoMsg(null);
    const res = await fetch("/api/conta/avatar", { method: "DELETE" });
    setEnviandoFoto(false);
    if (res.ok) { setAvatar(null); setFotoMsg({ ok: true, texto: "Foto removida." }); void recarregarPreferencias(); router.refresh(); }
  }

  // ---------- dados ----------
  const [nome, setNome] = useState(inicial.nome);
  const [telefone, setTelefone] = useState(inicial.telefone);
  const [profissional,setProfissional]=useState({profissao_declarada:inicial.profissao_declarada,especialidade:inicial.especialidade});
  const [avisosEmail,setAvisosEmail]=useState(inicial.avisos_email);
  const [dadosMsg, setDadosMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvandoDados, setSalvandoDados] = useState(false);

  async function salvarDados(e: React.FormEvent) {
    e.preventDefault();
    setSalvandoDados(true); setDadosMsg(null);
    const res = await fetch("/api/conta", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, telefone, ...profissional, avisos_email:avisosEmail }),
    });
    const d = await res.json().catch(() => ({}));
    setSalvandoDados(false);
    if (!res.ok) { setDadosMsg({ ok: false, texto: [d.error, d.solucao].filter(Boolean).join(" ") || "Não foi possível salvar." }); return; }
    setDadosMsg({ ok: true, texto: "Dados salvos." });
    void recarregarPreferencias();
    router.refresh();
  }

  // ---------- preferências ----------
  const { salvar } = usePreferencias();
  const [prefs, setPrefs] = useState<Preferencias>(inicial.preferencias);
  const [prefMsg, setPrefMsg] = useState("");

  async function mudar(parcial: Partial<Preferencias>) {
    setPrefs((p) => ({ ...p, ...parcial }));
    if (parcial.tema) aplicarTemaPreferido(parcial.tema);
    setPrefMsg("Salvando…");
    setPrefMsg((await salvar(parcial)) ? "Salvo na sua conta — vale em qualquer aparelho." : "Não foi possível salvar agora.");
  }

  // ---------- convites ----------
  const [conviteMsg, setConviteMsg] = useState("");
  async function responderConvite(id: string, acao: "aceitar" | "recusar") {
    setConviteMsg("");
    const res = await fetch("/api/conta/organizacao", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao, convite_id: id }),
    });
    const d = await res.json().catch(() => ({}));
    setConviteMsg(res.ok ? d.mensagem ?? "Pronto." : d.error ?? "Não foi possível responder.");
    if (res.ok) router.refresh();
  }

  const opcao = (ativo: boolean) =>
    "inline-flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-colors " +
    (ativo ? "border-verde bg-verde/10 text-verde" : "border-linha text-texto-2 hover:border-linha-forte hover:text-texto");

  return (
    <div className="space-y-6">
      {convites.length > 0 && (
        <Bloco icone={MailOpen} titulo="Convites de organização" destaque>
          <div className="divide-y divide-linha rounded-xl border border-linha">
            {convites.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <span className="min-w-48 flex-1 text-base text-texto">
                  <strong className="font-semibold">{c.org}</strong> <span className="text-texto-2">· {c.tipo} · como {c.papel.toLowerCase()}</span>
                </span>
                <button type="button" disabled={c.emOutra} onClick={() => responderConvite(c.id, "aceitar")}
                  title={c.emOutra ? "Saia da organização atual antes de aceitar outra." : undefined}
                  className="btn-verde px-4 py-2 text-sm disabled:opacity-50">Aceitar</button>
                <button type="button" onClick={() => responderConvite(c.id, "recusar")} className="btn-contorno px-4 py-2 text-sm">Recusar</button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-texto-2">Quem entra numa organização passa a usar o plano dela (se o seu plano pessoal não foi definido pela Arini).</p>
          {conviteMsg && <p className="mt-2 text-sm font-semibold text-verde">{conviteMsg}</p>}
        </Bloco>
      )}

      <Bloco icone={Camera} titulo="Foto do perfil">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar nome={nome} url={avatar} tamanho={88} />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={enviandoFoto} onClick={() => arquivoRef.current?.click()}
                className="btn-verde inline-flex items-center gap-2 px-5 py-2.5 text-sm disabled:opacity-60">
                <Upload className="size-4" />
                {enviandoFoto ? "Enviando…" : avatar ? "Trocar foto" : "Enviar foto"}
              </button>
              {avatar && (
                <button type="button" disabled={enviandoFoto} onClick={removerFoto} className="btn-contorno px-5 py-2.5 text-sm">Remover</button>
              )}
            </div>
            <p className="text-sm text-texto-2">JPG, PNG ou WebP até 3 MB. A foto é recortada em quadrado e aparece no topo do site. Não substitui a selfie da exclusividade.</p>
            <input ref={arquivoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) trocarFoto(f); }} />
          </div>
        </div>
        {fotoMsg && <p className={"mt-4 text-sm font-semibold " + (fotoMsg.ok ? "text-verde" : "text-critico")}>{fotoMsg.texto}</p>}
      </Bloco>

      <form onSubmit={salvarDados}>
        <Bloco icone={UserRound} titulo="Seus dados">
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className={rotulo} htmlFor="c-nome">Nome</label>
                <input id="c-nome" required minLength={2} maxLength={120} className={input} value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div>
                <label className={rotulo} htmlFor="c-tel">Telefone / WhatsApp</label>
                <input id="c-tel" className={input} placeholder="(34) 90000-0000" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
              </div>
            </div>
            <CamposProfissao classe={input} profissao={profissional.profissao_declarada} especialidade={profissional.especialidade}
              mudar={(campo,valor)=>setProfissional(p=>({...p,[campo]:valor}))} />
            <label className="flex items-center gap-3"><input type="checkbox" checked={avisosEmail} onChange={e=>setAvisosEmail(e.target.checked)}/>
              Receber por e-mail os avisos operacionais da Matriz disponíveis na minha conta</label>
            {dadosMsg && <p className={"text-sm font-semibold " + (dadosMsg.ok ? "text-verde" : "text-critico")}>{dadosMsg.texto}</p>}
            <button disabled={salvandoDados} className="btn-verde px-6 py-3 text-sm disabled:opacity-60">{salvandoDados ? "Salvando…" : "Salvar dados"}</button>
          </div>
        </Bloco>
      </form>

      <Bloco icone={SlidersHorizontal} titulo="Preferências" texto="Ficam guardadas na conta e acompanham você no celular e no computador.">
        <div className="space-y-6">
          <div>
            <p className={rotulo}>Tema</p>
            <div className="flex flex-wrap gap-2.5">
              {([["claro", "Claro", Sun], ["escuro", "Escuro", Moon], ["sistema", "Igual ao aparelho", Monitor]] as const).map(([v, l, Icone]) => (
                <button key={v} type="button" className={opcao(prefs.tema === v)} onClick={() => mudar({ tema: v })}><Icone className="size-4" />{l}</button>
              ))}
            </div>
          </div>
          <div>
            <p className={rotulo}>Mapa abre em</p>
            <div className="flex flex-wrap gap-2.5">
              {([["satelite", "Satélite", Satellite], ["mapa", "Mapa de ruas", MapIcon]] as const).map(([v, l, Icone]) => (
                <button key={v} type="button" className={opcao(prefs.mapa_base === v)} onClick={() => mudar({ mapa_base: v })}><Icone className="size-4" />{l}</button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-linha rounded-xl border border-linha">
            <label className="flex cursor-pointer items-start gap-3 px-4 py-4 text-base text-texto">
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--verde)]" checked={prefs.camada_car} onChange={(e) => mudar({ camada_car: e.target.checked })} />
              <span>Abrir o mapa com a camada do CAR ligada<span className="mt-0.5 block text-sm text-texto-2">Divisas dos imóveis rurais declaradas no Cadastro Ambiental Rural.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 px-4 py-4 text-base text-texto">
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--verde)]" checked={prefs.emails_novidades} onChange={(e) => mudar({ emails_novidades: e.target.checked })} />
              <span>Quero receber e-mails de novidades da ARINI<span className="mt-0.5 block text-sm text-texto-2">Imóveis novos e recursos do sistema. Você pode desmarcar quando quiser. Avisos da sua conta e dos seus anúncios continuam chegando.</span></span>
            </label>
          </div>
          {prefMsg && <p className="text-sm text-texto-2">{prefMsg}</p>}
        </div>
      </Bloco>
    </div>
  );
}

function Bloco({ icone: Icone, titulo, texto, destaque = false, children }: {
  icone: LucideIcon; titulo: string; texto?: string; destaque?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={`cartao p-5 md:p-7 ${destaque ? "border-l-4 border-l-ouro" : ""}`}>
      <header className="mb-5 flex items-start gap-4">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${destaque ? "bg-ouro/15 text-ouro" : "bg-verde/12 text-verde"}`}>
          <Icone className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="lp-display text-xl md:text-2xl text-texto">{titulo}</h2>
          {texto && <p className="mt-1 text-sm text-texto-2 md:text-base">{texto}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}
