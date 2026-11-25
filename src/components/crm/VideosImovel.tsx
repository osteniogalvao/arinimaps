"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarVideo, VIDEO_ACEITA, VIDEO_MAX_MB } from "@/lib/midia/enviarVideo";
import { Upload, Trash2 } from "lucide-react";

type Video = { id: string; url: string };

/** Vídeos do imóvel: o anunciante envia e remove; aparecem na galeria do anúncio. */
export default function VideosImovel({ propertyId, videos }: { propertyId: string; videos: Video[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");

  async function enviar(arquivos: FileList | null) {
    setErro("");
    for (const f of Array.from(arquivos ?? [])) {
      setOcupado(`Enviando ${f.name}…`);
      const problema = await enviarVideo(propertyId, f);
      if (problema) { setErro(problema); break; }
    }
    setOcupado("");
    router.refresh();
  }

  async function remover(id: string) {
    if (!window.confirm("Remover este vídeo do anúncio?")) return;
    setOcupado("Removendo…");
    const res = await fetch(`/api/imoveis/${propertyId}/midia`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_id: id }),
    });
    setOcupado("");
    if (!res.ok) setErro((await res.json().catch(() => ({}))).error ?? "Não foi possível remover.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {videos.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          {videos.map((v) => (
            <div key={v.id} className="space-y-2">
              <video src={v.url} controls preload="metadata" className="w-full rounded-xl border border-linha bg-black aspect-video" />
              <button onClick={() => remover(v.id)} disabled={!!ocupado}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-critico hover:underline disabled:opacity-50">
                <Trash2 className="size-4" /> Remover
              </button>
            </div>
          ))}
        </div>
      )}
      {videos.length < 3 && (
        <label className={`inline-flex cursor-pointer items-center gap-2 px-5 py-3 text-sm ${ocupado ? "rounded-[10px] bg-superficie-2 font-semibold text-texto-2" : "btn-contorno"}`}>
          <Upload className="size-4" />
          {ocupado || "Enviar vídeo"}
          <input type="file" accept={VIDEO_ACEITA} multiple className="hidden" disabled={!!ocupado}
            onChange={(e) => { enviar(e.target.files); e.target.value = ""; }} />
        </label>
      )}
      <p className="text-sm text-texto-2">
        Até 3 vídeos por imóvel, {VIDEO_MAX_MB} MB cada (MP4, MOV ou WebM).
      </p>
      {erro && <p className="text-sm text-critico">{erro}</p>}
    </div>
  );
}
