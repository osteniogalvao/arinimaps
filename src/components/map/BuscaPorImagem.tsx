"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ImageUp, LoaderCircle, MapPin } from "lucide-react";
import { gpsDaFoto } from "@/lib/map/exifGps";
import { enviarArquivo } from "@/lib/api/enviar";
import { VIDRO, BotaoFechar } from "@/components/map/UiMapa";

type Pista = {
  lat: number | null; lng: number | null;
  municipio: string | null; uf: string | null;
  codigo_car: string | null; codigo_anuncio: string | null;
  referencias: string[]; descricao: string; confianca: "alta" | "media" | "baixa";
};

/**
 * Busca por imagem (Revisão.pdf do Carlos, 29/10/2026).
 *
 * 1. Foto com GPS (celular no local): a coordenada sai do próprio arquivo, no
 *    navegador, sem enviar nada.
 * 2. Print de mapa, croqui, planta ou documento: a Ari lê a imagem e devolve
 *    pistas (coordenada, município, código do CAR ou do anúncio). O mapa vai
 *    até a melhor pista e a lista lateral filtra pelo resto.
 */
export default function BuscaPorImagem({
  logado, onFechar, onIr, onBuscarTexto,
}: {
  logado: boolean;
  onFechar: () => void;
  onIr: (lng: number, lat: number, zoom: number) => void;
  onBuscarTexto: (termo: string) => void;
}) {
  const [estado, setEstado] = useState<"livre" | "lendo" | "pronto">("livre");
  const [resumo, setResumo] = useState<string>("");
  const [erro, setErro] = useState<{ msg: string; entrar?: boolean } | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function escolher(arquivo: File) {
    setErro(null); setResumo("");
    if (previa) URL.revokeObjectURL(previa);
    setPrevia(URL.createObjectURL(arquivo));
    setEstado("lendo");

    // 1) GPS da foto: grátis e exato
    const gps = await gpsDaFoto(arquivo).catch(() => null);
    if (gps) {
      onIr(gps.lng, gps.lat, 16);
      setResumo(`A foto tem GPS: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}. O mapa foi até o local.`);
      setEstado("pronto");
      return;
    }

    // 2) sem GPS: a Ari procura pistas escritas ou desenhadas na imagem
    if (!logado) {
      setErro({ msg: "Essa imagem não tem GPS. Para a Ari ler pistas no print, croqui ou documento, entre na sua conta.", entrar: true });
      setEstado("livre");
      return;
    }
    const r = await enviarArquivo<{ pista: Pista }>("/api/ia/imagem", arquivo, {});
    if (!r.ok) {
      setErro({ msg: r.erro.mensagem + (r.erro.solucao ? ` ${r.erro.solucao}` : "") });
      setEstado("livre");
      return;
    }
    const p = r.dados.pista;
    const partes: string[] = [];
    if (p.lat !== null && p.lng !== null) {
      onIr(p.lng, p.lat, 15);
      partes.push(`Coordenada encontrada (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}).`);
    }
    // a lista lateral filtra por código ou município (e voa até o município)
    const termo = p.codigo_anuncio || p.codigo_car || p.municipio;
    if (termo) {
      onBuscarTexto(termo);
      partes.push(`Buscando por “${termo}”.`);
    }
    if (!partes.length) partes.push("Não achei coordenada, código nem município na imagem.");
    if (p.referencias.length) partes.push(`Referências na imagem: ${p.referencias.join(", ")}.`);
    if (p.descricao) partes.unshift(p.descricao);
    if (p.confianca === "baixa" && (p.lat !== null || termo)) partes.push("Confiança baixa: confira no mapa.");
    setResumo(partes.join(" "));
    setEstado("pronto");
  }

  return (
    <div className={`absolute top-14 left-3 z-20 w-96 max-w-[calc(100%-1.5rem)] p-5 space-y-3.5 ${VIDRO}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-verde/12 text-verde"><ImageUp className="size-[18px]" /></span>
          <p className="lp-display text-2xl text-verde">Buscar por imagem</p>
        </div>
        <BotaoFechar onClick={onFechar} />
      </div>
      <p className="text-sm leading-relaxed text-texto-2">
        Envie uma foto tirada no imóvel (com GPS), um print de mapa ou satélite, um croqui ou um documento.
        O mapa vai até o local mais provável.
      </p>

      <button type="button" onClick={() => inputRef.current?.click()} disabled={estado === "lendo"}
        className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-linha-forte bg-superficie-2/60 px-4 py-5 text-sm text-texto-2 transition hover:border-verde/60 hover:text-texto disabled:opacity-60">
        {previa
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={previa} alt="Imagem enviada" className="max-h-32 rounded-lg object-contain" />
          : <ImageUp className="size-7 text-verde" />}
        {estado === "lendo"
          ? <span className="inline-flex items-center gap-2 font-semibold text-texto"><LoaderCircle className="size-4 animate-spin" /> Lendo a imagem…</span>
          : <span className="font-semibold text-texto">{previa ? "Escolher outra imagem" : "Escolher imagem"}</span>}
        <span className="text-xs">JPG, PNG, WEBP ou GIF, até 4 MB</span>
      </button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void escolher(f); }} />

      {resumo && (
        <p className="flex items-start gap-2 rounded-xl border border-verde/25 bg-verde/10 px-3.5 py-2.5 text-sm text-texto">
          <MapPin className="mt-0.5 size-4 shrink-0 text-verde" /> {resumo}
        </p>
      )}
      {erro && (
        <p className="rounded-xl border border-ouro/30 bg-ouro/8 px-3.5 py-2.5 text-sm text-texto">
          {erro.msg}{" "}
          {erro.entrar && <Link href="/entrar" className="font-semibold text-verde underline">Entrar</Link>}
        </p>
      )}
      <p className="text-[11px] text-texto-2">A imagem não fica guardada. Fotos com GPS são lidas no seu aparelho.</p>
    </div>
  );
}
