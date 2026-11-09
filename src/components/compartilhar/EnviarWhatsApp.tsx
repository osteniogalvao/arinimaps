"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Copy, Info, MessageCircle, Share2, UserRound, Users } from "lucide-react";
import { linkWhatsApp } from "@/lib/compartilhar";

type Props = {
  /** caminho no site (/i/AIB-000001, /consulta/car/…) ou URL completa */
  caminho: string;
  /** começo da mensagem; o link vai no fim */
  texto: string;
  /** título do navigator.share (celular) */
  titulo: string;
  /** aviso para quem recebe (ex.: parte do conteúdo pede conta) */
  aviso?: string;
  rotulo?: string;
  /** classes do botão; o padrão é o contorno verde da ficha */
  className?: string;
  /** o menu abre para cima (botão no rodapé de um cartão) */
  paraCima?: boolean;
};

type Perfil = { logado: boolean; numero: string | null };

const BOTAO_PADRAO =
  "flex w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-verde bg-transparent py-3 text-sm font-bold text-verde transition hover:bg-verde hover:text-fundo";
const ITEM =
  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-texto transition hover:bg-superficie-2 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * "Enviar pelo WhatsApp" (segunda etapa, item 6): para outra pessoa (wa.me sem
 * número), para mim mesmo (número do perfil), pelos apps do celular
 * (navigator.share) ou copiar o link. A URL é montada no clique, com a origem
 * de quem está usando: window não existe no SSR.
 */
export default function EnviarWhatsApp({ caminho, texto, titulo, aviso, rotulo = "Enviar pelo WhatsApp", className, paraCima }: Props) {
  const [aberto, setAberto] = useState(false);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [podeShare, setPodeShare] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  // o número do perfil só é buscado quando o menu abre pela primeira vez
  useEffect(() => {
    if (!aberto || perfil) return;
    let vivo = true;
    fetch("/api/conta/whatsapp", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { logado: false, numero: null }))
      .then((p: Perfil) => { if (vivo) setPerfil(p); })
      .catch(() => { if (vivo) setPerfil({ logado: false, numero: null }); });
    return () => { vivo = false; };
  }, [aberto, perfil]);

  // fecha ao clicar fora ou com Esc
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  const url = () => (/^https?:\/\//.test(caminho) ? caminho : `${window.location.origin}${caminho}`);
  const mensagem = () => `${texto}\n${url()}`;
  const abrir = (numero?: string | null) => {
    window.open(linkWhatsApp(mensagem(), numero), "_blank", "noopener,noreferrer");
    setAberto(false);
  };

  return (
    <div ref={caixa} className="relative print:hidden">
      <button type="button" aria-haspopup="menu" aria-expanded={aberto}
        onClick={() => {
          // navigator.share só existe no navegador (e quase só no celular): checado no clique
          setPodeShare(typeof navigator.share === "function");
          setAberto((v) => !v);
        }} className={className ?? BOTAO_PADRAO}>
        <MessageCircle className="size-4" /> {rotulo}
        <ChevronDown className={`size-4 transition ${aberto ? "rotate-180" : ""}`} />
      </button>

      {aberto && (
        <div role="menu"
          className={`absolute left-0 z-50 w-full min-w-[17rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-linha-forte bg-fundo p-1.5 shadow-xl ${paraCima ? "bottom-full mb-2" : "top-full mt-2"}`}>
          <button type="button" role="menuitem" className={ITEM} onClick={() => abrir(null)}>
            <Users className="mt-0.5 size-4 shrink-0 text-verde" />
            <span><span className="block font-semibold">Para outra pessoa</span>
              <span className="block text-xs text-texto-2">Você escolhe o contato no WhatsApp.</span></span>
          </button>

          <button type="button" role="menuitem" className={ITEM}
            disabled={!perfil?.numero} onClick={() => abrir(perfil?.numero)}>
            <UserRound className="mt-0.5 size-4 shrink-0 text-verde" />
            <span><span className="block font-semibold">Para mim mesmo</span>
              <span className="block text-xs text-texto-2">
                {!perfil ? "Buscando o seu número…"
                  : perfil.numero ? "Vai para o WhatsApp do seu perfil."
                  : perfil.logado ? "Cadastre seu WhatsApp em Minha conta."
                  : "Entre na sua conta para usar."}
              </span></span>
          </button>
          {perfil && !perfil.numero && (
            <Link href={perfil.logado ? "/conta" : "/entrar"} className="block px-3 pb-1 pl-10 text-xs font-semibold text-verde hover:underline">
              {perfil.logado ? "Abrir Minha conta" : "Entrar"}
            </Link>
          )}

          {podeShare && (
            <button type="button" role="menuitem" className={ITEM}
              onClick={async () => {
                setAberto(false);
                try { await navigator.share({ title: titulo, text: texto, url: url() }); } catch { /* cancelado */ }
              }}>
              <Share2 className="mt-0.5 size-4 shrink-0 text-verde" />
              <span className="font-semibold">Outros apps do celular</span>
            </button>
          )}

          <button type="button" role="menuitem" className={ITEM}
            onClick={async () => {
              try { await navigator.clipboard.writeText(url()); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sem permissão */ }
            }}>
            {copiado ? <Check className="mt-0.5 size-4 shrink-0 text-verde" /> : <Copy className="mt-0.5 size-4 shrink-0 text-verde" />}
            <span className="font-semibold">{copiado ? "Link copiado" : "Copiar link"}</span>
          </button>

          {aviso && (
            <p className="mt-1 flex gap-2 border-t border-linha px-3 pb-1.5 pt-2.5 text-xs leading-relaxed text-texto-2">
              <Info className="mt-0.5 size-3.5 shrink-0" /> {aviso}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
