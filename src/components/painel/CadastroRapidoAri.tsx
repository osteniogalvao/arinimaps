"use client";

/**
 * Cadastro rápido com a Ari (2ª etapa do cliente, item 4; referência neutto.com.br).
 *
 * Fica no topo de /painel/novo. O anunciante escreve ou cola a descrição,
 * anexa fotos, documentos (matrícula, CAR, escritura) e, se quiser, um áudio
 * ou vídeo curto. A Ari (POST /api/ia/cadastro-rapido) devolve os campos do
 * anúncio; o formulário em etapas, logo abaixo, abre preenchido e com os
 * campos vindos da IA destacados para conferir. O envio continua o mesmo
 * (POST /api/imoveis → análise da Central).
 *
 * As fotos vão para a Ari reduzidas aqui no navegador (1024 px) e não são
 * guardadas por ela: os arquivos originais passam para o formulário e só são
 * gravados quando o anunciante enviar o anúncio, no fluxo de sempre.
 *
 * Vídeo: só anexa (vai para a etapa "Fotos e vídeos"). Áudio: transcrito se
 * houver serviço configurado (src/lib/ia/transcricao.ts); senão é aceito e a
 * tela avisa.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, FileText, ImageOff, LoaderCircle, Mic, RotateCcw, Sparkles, Video,
} from "lucide-react";
import MarcaArini from "@/components/marca/MarcaArini";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import { VIDEO_ACEITA, VIDEO_MAX_MB } from "@/lib/midia/enviarVideo";
import type { ExtracaoAnuncio, ProblemaFoto, TipoDocIa } from "@/lib/ia/cadastroRapidoNucleo";

export type ResultadoAri = {
  extracao: ExtracaoAnuncio;
  /** fotos originais na ordem sugerida, já sem as que o anunciante retirou */
  fotos: File[];
  /** documentos já separados nas caixas do formulário */
  docs: { matricula: File[]; outro: File[] };
  videos: File[];
};

type Estado = {
  ligado: boolean; motivo?: string; transcricao: boolean;
  limites?: { fotos: number; documentos: number; descricao: number; docPdfMb: number; docImagemMb: number; audioMb: number; porHora: number; porDia: number };
};

const ROTULO_DOC: Record<TipoDocIa, string> = {
  matricula: "Matrícula", car: "CAR", escritura: "Escritura / contrato", outro: "Outro documento",
};
const ROTULO_PROBLEMA: Record<ProblemaFoto, string> = {
  escura: "Escura", borrada: "Borrada", repetida: "Repetida", fora_de_contexto: "Fora de contexto",
};
const ACEITA_DOC = ".pdf,.jpg,.jpeg,.png,.webp";
const ACEITA_AUDIO = "audio/*,.m4a,.mp3,.ogg,.opus,.wav,.aac";

/** Reduz a imagem para a Ari ler (lado maior `lado`, JPEG). null = o navegador não abre o formato. */
async function reduzir(arquivo: File, lado: number, qualidade: number): Promise<File | null> {
  if (!arquivo.type.startsWith("image/")) return null;
  let img: ImageBitmap;
  try {
    img = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const escala = Math.min(1, lado / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", qualidade));
    return blob ? new File([blob], arquivo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : null;
  } finally {
    img.close();
  }
}

export default function CadastroRapidoAri({ onAplicar, onFotos }: {
  /** preenche o formulário com o resultado */
  onAplicar: (r: ResultadoAri) => void;
  /** o anunciante retirou ou devolveu uma foto na revisão */
  onFotos: (fotos: File[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [texto, setTexto] = useState("");
  const [fotos, setFotos] = useState<File[]>([]);
  const [docs, setDocs] = useState<File[]>([]);
  const [audio, setAudio] = useState<File | null>(null);
  const [videos, setVideos] = useState<File[]>([]);
  const [lendo, setLendo] = useState("");
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<{ extracao: ExtracaoAnuncio; avisos: string[] } | null>(null);
  const [retiradas, setRetiradas] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!aberto || estado) return;
    fetch("/api/ia/cadastro-rapido")
      .then((r) => r.json())
      .then((d: Estado) => setEstado(d))
      .catch(() => setEstado({ ligado: false, transcricao: false, motivo: "Não foi possível falar com a Ari agora." }));
  }, [aberto, estado]);

  // miniaturas para a revisão das fotos
  const previas = useMemo(() => fotos.map((f) => URL.createObjectURL(f)), [fotos]);
  useEffect(() => () => previas.forEach((u) => URL.revokeObjectURL(u)), [previas]);

  const lim = estado?.limites;
  const maxFotos = lim?.fotos ?? 20;
  const maxDocs = lim?.documentos ?? 6;

  async function ler() {
    setErro("");
    if (!texto.trim() && !fotos.length && !docs.length) {
      setErro("Escreva sobre o imóvel ou anexe fotos e documentos.");
      return;
    }
    if (videos.some((v) => v.size > VIDEO_MAX_MB * 1024 * 1024)) {
      setErro(`Cada vídeo pode ter até ${VIDEO_MAX_MB} MB.`);
      return;
    }
    const fd = new FormData();
    fd.set("descricao", texto.slice(0, lim?.descricao ?? 8000));
    for (const [i, f] of fotos.entries()) {
      setLendo(`Preparando fotos (${i + 1} de ${fotos.length})…`);
      // foto que o navegador não abre (HEIC no Chrome) vai assim mesmo: o servidor avisa
      fd.append("fotos", (await reduzir(f, 1024, 0.8)) ?? f);
    }
    for (const d of docs) {
      // documento em foto precisa continuar legível: reduz menos
      fd.append("docs", d.type === "application/pdf" ? d : (await reduzir(d, 2000, 0.85)) ?? d);
    }
    if (audio && estado?.transcricao) fd.set("audio", audio);
    setLendo("A Ari está lendo o material…");
    try {
      const r = await fetch("/api/ia/cadastro-rapido", { method: "POST", body: fd });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.extracao) {
        setErro([d?.error ?? `Falha ao falar com a Ari (erro ${r.status}).`, d?.solucao].filter(Boolean).join(" "));
        return;
      }
      const extracao = d.extracao as ExtracaoAnuncio;
      const avisos: string[] = [...(d.avisos ?? [])];
      if (audio && !estado?.transcricao) {
        avisos.unshift("O áudio foi aceito, mas a transcrição ainda não está ligada: ele será transcrito quando o serviço for ativado. Por enquanto, a Ari usou o texto e os arquivos.");
      }
      // fotos marcadas como ruins já começam retiradas; o anunciante devolve com um clique
      const ruins = new Set(extracao.fotos.problemas.map((p) => p.indice));
      setRetiradas(ruins);
      setResultado({ extracao, avisos });
      const porTipo = (t: TipoDocIa) => extracao.documentos.filter((x) => x.tipo === t).map((x) => docs[x.indice]).filter(Boolean);
      const classificados = new Set(extracao.documentos.map((x) => x.indice));
      onAplicar({
        extracao,
        fotos: extracao.fotos.ordem.filter((i) => !ruins.has(i)).map((i) => fotos[i]).filter(Boolean),
        docs: {
          // escritura e contrato registrado valem na caixa da matrícula (comprovação de propriedade)
          matricula: [...porTipo("matricula"), ...porTipo("escritura")],
          outro: [...porTipo("car"), ...porTipo("outro"), ...docs.filter((_, i) => !classificados.has(i))],
        },
        videos,
      });
      requestAnimationFrame(() => document.getElementById("cadastro-ari-resultado")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setErro("Sem conexão com a Ari agora. Tente de novo ou preencha o formulário normalmente.");
    } finally {
      setLendo("");
    }
  }

  function alternarFoto(i: number) {
    if (!resultado) return;
    const nova = new Set(retiradas);
    if (nova.has(i)) nova.delete(i); else nova.add(i);
    setRetiradas(nova);
    onFotos(resultado.extracao.fotos.ordem.filter((j) => !nova.has(j)).map((j) => fotos[j]).filter(Boolean));
  }

  function recomecar() {
    setResultado(null);
    setRetiradas(new Set());
  }

  const problemaDe = (i: number) => resultado?.extracao.fotos.problemas.find((p) => p.indice === i);

  return (
    <section className="cartao overflow-hidden" aria-labelledby="cadastro-ari-titulo">
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto}
        className="flex w-full items-center gap-4 p-5 text-left md:p-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#124431] ring-2 ring-[#D9BD6F]/60" aria-hidden>
          <MarcaArini variante="radar" titulo="" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span id="cadastro-ari-titulo" className="lp-display block text-lg text-texto md:text-xl">Cadastro rápido com a Ari</span>
          <span className="mt-0.5 block text-sm text-texto-2">
            Cole a descrição, anexe fotos e documentos. A Ari preenche o formulário e você só confere.
          </span>
        </span>
        <ChevronDown className={"size-5 shrink-0 text-texto-2 transition-transform " + (aberto ? "rotate-180" : "")} />
      </button>

      {aberto && (
        <div className="space-y-5 border-t border-linha p-5 md:p-6">
          {estado && !estado.ligado ? (
            <p className="flex items-start gap-2 text-sm text-texto-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alerta" />
              {estado.motivo ?? "A Ari não está disponível agora."} Preencha o formulário abaixo normalmente.
            </p>
          ) : resultado ? (
            <Revisao resultado={resultado} fotos={fotos} previas={previas} docs={docs}
              retiradas={retiradas} problemaDe={problemaDe} onAlternar={alternarFoto} onRecomecar={recomecar} />
          ) : (
            <>
              <div>
                <label className={ROTULO} htmlFor="ari-descricao">Conte sobre o imóvel</label>
                <textarea id="ari-descricao" rows={6} className={CAMPO} maxLength={lim?.descricao ?? 8000}
                  placeholder="Ex.: Fazenda de 40 alqueires em Iturama, a 12 km da cidade pela MG-497, com casa sede, curral, represa e pasto formado. Matrícula 12.345 no cartório de Iturama. Valor R$ 4,2 milhões, aceita parte em permuta."
                  value={texto} onChange={(e) => setTexto(e.target.value)} />
                <p className="mt-1.5 text-sm text-texto-2">Pode colar o texto de um anúncio que você já tem, de um WhatsApp ou de um e-mail.</p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label className={ROTULO} htmlFor="ari-fotos">Fotos (até {maxFotos})</label>
                  <input id="ari-fotos" type="file" accept="image/*" multiple className={CAMPO}
                    onChange={(e) => setFotos(Array.from(e.target.files ?? []).slice(0, maxFotos))} />
                  <p className="mt-1.5 text-sm text-texto-2">
                    {fotos.length ? `${fotos.length} foto(s).` : "A Ari sugere a ordem, a capa e aponta as fotos ruins."}
                  </p>
                </div>
                <div>
                  <label className={ROTULO} htmlFor="ari-docs">Documentos (até {maxDocs})</label>
                  <input id="ari-docs" type="file" accept={ACEITA_DOC} multiple className={CAMPO}
                    onChange={(e) => setDocs(Array.from(e.target.files ?? []).slice(0, maxDocs))} />
                  <p className="mt-1.5 text-sm text-texto-2">
                    {docs.length ? docs.map((d) => d.name).join(", ") : `Matrícula, CAR, escritura. PDF até ${lim?.docPdfMb ?? 10} MB ou foto.`}
                  </p>
                </div>
                <div>
                  <label className={ROTULO} htmlFor="ari-audio">
                    <span className="inline-flex items-center gap-1.5"><Mic className="size-4 text-texto-2" /> Áudio (opcional)</span>
                  </label>
                  <input id="ari-audio" type="file" accept={ACEITA_AUDIO} className={CAMPO}
                    onChange={(e) => {
                      const a = e.target.files?.[0] ?? null;
                      setAudio(a && a.size <= (lim?.audioMb ?? 20) * 1048576 ? a : null);
                      if (a && a.size > (lim?.audioMb ?? 20) * 1048576) setErro(`O áudio pode ter até ${lim?.audioMb ?? 20} MB.`);
                    }} />
                  <p className="mt-1.5 text-sm text-texto-2">
                    {estado && !estado.transcricao
                      ? "A transcrição de áudio ainda não está ligada: o áudio é aceito e será transcrito quando o serviço for ativado."
                      : "Fale sobre o imóvel como falaria com um comprador."}
                  </p>
                </div>
                <div>
                  <label className={ROTULO} htmlFor="ari-video">
                    <span className="inline-flex items-center gap-1.5"><Video className="size-4 text-texto-2" /> Vídeo curto (opcional)</span>
                  </label>
                  <input id="ari-video" type="file" accept={VIDEO_ACEITA} multiple className={CAMPO}
                    onChange={(e) => setVideos(Array.from(e.target.files ?? []).slice(0, 3))} />
                  <p className="mt-1.5 text-sm text-texto-2">Vai direto para a etapa de vídeos do anúncio; a Ari não assiste.</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {erro
                  ? <p role="alert" className="flex items-start gap-2 text-sm text-critico"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{erro}</p>
                  : <p className="text-sm text-texto-2">
                      {lim ? `Até ${lim.porHora} leituras por hora e ${lim.porDia} por dia. ` : ""}Nada é publicado sem a sua revisão e a análise da Arini.
                    </p>}
                <button type="button" onClick={ler} disabled={!!lendo || !estado}
                  className="lp-btn lp-btn-ouro shrink-0 !px-5 !py-3 text-[0.95rem] disabled:opacity-60">
                  {lendo ? <><LoaderCircle className="size-4 animate-spin" /> {lendo}</> : <><Sparkles className="size-4" /> Preencher com a Ari</>}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Revisao({ resultado, fotos, previas, docs, retiradas, problemaDe, onAlternar, onRecomecar }: {
  resultado: { extracao: ExtracaoAnuncio; avisos: string[] };
  fotos: File[]; previas: string[]; docs: File[];
  retiradas: Set<number>;
  problemaDe: (i: number) => ExtracaoAnuncio["fotos"]["problemas"][number] | undefined;
  onAlternar: (i: number) => void;
  onRecomecar: () => void;
}) {
  const { extracao: ex, avisos } = resultado;
  return (
    <div id="cadastro-ari-resultado" className="scroll-mt-24 space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-ouro/40 bg-ouro/10 px-4 py-3 text-sm text-texto">
        <Check className="mt-0.5 size-4 shrink-0 text-ouro" />
        <span>
          Pronto. Os campos que a Ari preencheu estão com <strong className="font-semibold">contorno dourado</strong> no
          formulário abaixo: confira cada um antes de enviar. Confiança da leitura: <strong className="font-semibold">{ex.confianca}</strong>.
        </span>
      </div>

      {(ex.pendencias.length > 0 || avisos.length > 0) && (
        <div>
          <p className={ROTULO}>Para conferir</p>
          <ul className="space-y-1.5 text-sm text-texto-2">
            {[...avisos, ...ex.pendencias].map((p, i) => (
              <li key={i} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-alerta" />{p}</li>
            ))}
          </ul>
        </div>
      )}

      {ex.documentos.length > 0 && (
        <div>
          <p className={ROTULO}>Documentos</p>
          <ul className="divide-y divide-linha rounded-xl border border-linha">
            {ex.documentos.map((d) => (
              <li key={d.indice} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <FileText className="mt-0.5 size-4 shrink-0 text-texto-2" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-texto">{docs[d.indice]?.name ?? `Documento ${d.indice + 1}`}</span>
                  {d.resumo && <span className="block text-texto-2">{d.resumo}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-superficie-2 px-2.5 py-0.5 text-xs font-semibold text-texto">{ROTULO_DOC[d.tipo]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-sm text-texto-2">
            Matrícula e escritura foram para a caixa da matrícula; CAR e os demais, para “Outros documentos”.
          </p>
        </div>
      )}

      {fotos.length > 0 && (
        <div>
          <p className={ROTULO}>Fotos na ordem sugerida</p>
          <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {ex.fotos.ordem.map((i, pos) => {
              const p = problemaDe(i);
              const fora = retiradas.has(i);
              return (
                <li key={i} className="relative">
                  <button type="button" onClick={() => onAlternar(i)}
                    title={fora ? "Devolver ao anúncio" : "Retirar do anúncio"}
                    className={"block aspect-[4/3] w-full overflow-hidden rounded-lg border-2 transition " +
                      (fora ? "border-linha opacity-40" : pos === 0 ? "border-ouro" : "border-transparent")}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:), não passa pelo otimizador */}
                    <img src={previas[i]} alt={`Foto ${i + 1}`} className="size-full object-cover" />
                  </button>
                  <span className="pointer-events-none absolute left-1 top-1 rounded bg-fundo/85 px-1.5 text-[11px] font-semibold text-texto">
                    {pos === 0 && !fora ? "Capa" : pos + 1}
                  </span>
                  {fora && <ImageOff className="pointer-events-none absolute right-1 top-1 size-4 text-texto" />}
                  {p && (
                    <span className="mt-1 block text-[11px] leading-tight text-alerta" title={p.obs}>
                      {ROTULO_PROBLEMA[p.motivo]}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-1.5 text-sm text-texto-2">
            Toque numa foto para retirar ou devolver. As marcadas como ruins já começam fora; a primeira vira capa.
          </p>
        </div>
      )}

      {Object.keys(ex.caracteristicas).length > 0 && (
        <div>
          <p className={ROTULO}>Características identificadas</p>
          <p className="text-sm text-texto-2">
            {[
              ex.caracteristicas.quartos && `${ex.caracteristicas.quartos} quarto(s)`,
              ex.caracteristicas.suites && `${ex.caracteristicas.suites} suíte(s)`,
              ex.caracteristicas.banheiros && `${ex.caracteristicas.banheiros} banheiro(s)`,
              ex.caracteristicas.vagas && `${ex.caracteristicas.vagas} vaga(s)`,
              ex.caracteristicas.solo && `solo ${ex.caracteristicas.solo}`,
              ex.caracteristicas.zoneamento && `zoneamento ${ex.caracteristicas.zoneamento}`,
              ...(ex.caracteristicas.benfeitorias ?? []),
            ].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-sm text-texto-2">Vão junto com o anúncio para a ficha técnica; a Arini confere na análise.</p>
        </div>
      )}

      <button type="button" onClick={onRecomecar}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-texto-2 underline-offset-2 hover:text-texto hover:underline">
        <RotateCcw className="size-4" /> Ler outro material
      </button>
    </div>
  );
}
