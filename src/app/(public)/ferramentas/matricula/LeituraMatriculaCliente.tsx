"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangle, Download, FileSearch, LoaderCircle, Upload } from "lucide-react";
import { enviarArquivo } from "@/lib/api/enviar";
import { resumoMatriculaDoc, type LeituraMatricula } from "@/lib/ia/matricula";

const ACEITOS = ".pdf,.jpg,.jpeg,.png,.webp";

export default function LeituraMatriculaCliente({ logado }: { logado: boolean }) {
  const [estado, setEstado] = useState<"livre" | "lendo" | "pronto">("livre");
  const [pct, setPct] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [leitura, setLeitura] = useState<LeituraMatricula | null>(null);
  const [nome, setNome] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function ler(arquivo: File) {
    setErro(null); setLeitura(null); setNome(arquivo.name); setEstado("lendo"); setPct(0);
    const r = await enviarArquivo<{ leitura: LeituraMatricula }>("/api/ia/matricula", arquivo, {}, (p) => setPct(p));
    if (!r.ok) {
      setErro([r.erro.mensagem, r.erro.solucao].filter(Boolean).join(" "));
      setEstado("livre");
      return;
    }
    setLeitura(r.dados.leitura);
    setEstado("pronto");
  }

  function baixar() {
    if (!leitura) return;
    const blob = new Blob(["﻿" + resumoMatriculaDoc(leitura, nome)], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `resumo-matricula-${(leitura.matricula ?? "arini").replace(/[^\w.-]+/g, "-")}.doc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  if (!logado) {
    return (
      <div className="rounded-3xl border border-linha p-8 text-center space-y-3">
        <FileSearch className="mx-auto size-8 text-verde" />
        <p className="text-texto">Entre na sua conta para usar a leitura de matrícula.</p>
        <Link href="/entrar?volta=/ferramentas/matricula" className="btn-verde inline-flex px-5 py-2.5 text-sm">Entrar</Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && estado !== "lendo") void ler(f); }}
        className="rounded-3xl border-2 border-dashed border-linha-forte p-8 text-center space-y-3">
        {estado === "lendo" ? (
          <>
            <LoaderCircle className="mx-auto size-8 animate-spin text-verde" />
            <p className="text-texto">{pct < 100 ? `Enviando ${nome}… ${pct}%` : "A Ari está lendo os atos da matrícula. Leva de 20 segundos a 2 minutos."}</p>
          </>
        ) : (
          <>
            <Upload className="mx-auto size-8 text-verde" />
            <p className="text-texto">Arraste a certidão aqui ou</p>
            <button type="button" onClick={() => input.current?.click()} className="btn-verde inline-flex px-5 py-2.5 text-sm">Escolher arquivo</button>
            <p className="text-xs text-texto-2">PDF, JPG, PNG ou WEBP, até 15 MB. O arquivo não fica guardado.</p>
          </>
        )}
        <input ref={input} type="file" accept={ACEITOS} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void ler(f); }} />
      </div>

      {erro && <p className="rounded-2xl border border-alerta/40 px-4 py-3 text-sm text-alerta">{erro}</p>}

      {leitura && <Resultado l={leitura} onBaixar={baixar} />}
    </div>
  );
}

function Resultado({ l, onBaixar }: { l: LeituraMatricula; onBaixar: () => void }) {
  const im = l.imovel;
  const dados: [string, string | null][] = [
    ["Cartório", l.cartorio], ["Imóvel", im.denominacao],
    ["Município", [im.municipio, im.uf].filter(Boolean).join(" / ") || null], ["Área", im.area],
    ["CCIR", im.ccir], ["CAR", im.car], ["ITR / NIRF", im.itr_nirf],
    ["Georreferenciado", im.georreferenciado == null ? null : im.georreferenciado ? `Sim${im.codigo_sigef ? ` (SIGEF ${im.codigo_sigef})` : ""}` : "Não consta"],
  ];
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="lp-eyebrow">Matrícula</p>
          <h2 className="lp-display text-3xl text-texto">{l.matricula ?? "sem número legível"}</h2>
          <p className="text-xs text-texto-2 mt-1">Leitura com confiança {l.confianca}{l.observacao_leitura ? ` · ${l.observacao_leitura}` : ""}</p>
        </div>
        <button type="button" onClick={onBaixar} className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-linha-forte px-5 py-2.5 text-sm font-bold text-texto hover:border-verde hover:text-verde">
          <Download className="size-4" /> Baixar resumo (Word)
        </button>
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {dados.filter(([, v]) => v).map(([r, v]) => (
          <div key={r}><dt className="text-xs uppercase tracking-[0.15em] text-texto-2">{r}</dt><dd className="text-texto">{v}</dd></div>
        ))}
      </dl>
      {im.descricao_resumida && <p className="text-sm text-texto-2 leading-relaxed">{im.descricao_resumida}</p>}

      <section className="space-y-3">
        <h3 className="lp-display text-xl text-texto">Ônus vigentes</h3>
        {l.onus_vigentes.length ? l.onus_vigentes.map((o, i) => (
          <div key={i} className="rounded-2xl border border-alerta/40 px-4 py-3 text-sm">
            <p className="font-semibold text-alerta">{o.tipo} · {o.ato}{o.valor ? ` · ${o.valor}` : ""}</p>
            <p className="text-texto">{o.resumo}{o.favorecido ? ` Favorecido: ${o.favorecido}.` : ""}</p>
          </div>
        )) : <p className="text-sm text-texto-2">Nenhum ônus vigente identificado na leitura.</p>}
      </section>

      {l.alertas.length > 0 && (
        <section className="space-y-2">
          <h3 className="lp-display text-xl text-texto">Pontos de atenção</h3>
          <ul className="space-y-1.5">
            {l.alertas.map((a, i) => <li key={i} className="flex gap-2 text-sm text-texto"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-ouro" />{a}</li>)}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="lp-display text-xl text-texto">Proprietários atuais</h3>
        {l.proprietarios_atuais.length ? (
          <ul className="space-y-1 text-sm text-texto">
            {l.proprietarios_atuais.map((p, i) => (
              <li key={i}>{p.nome}{p.documento ? ` · ${p.documento}` : ""}{p.fracao ? ` · ${p.fracao}` : ""}{p.ato ? ` (${p.ato})` : ""}</li>
            ))}
          </ul>
        ) : <p className="text-sm text-texto-2">Não identificados.</p>}
      </section>

      <section className="space-y-3">
        <h3 className="lp-display text-xl text-texto">Atos ({l.atos.length})</h3>
        <ol className="space-y-2 text-sm">
          {l.atos.map((a, i) => (
            <li key={i} className={a.cancelado_por ? "text-texto-2 line-through" : "text-texto"}>
              <span className="font-semibold">{a.numero}</span>{a.data ? ` · ${a.data}` : ""} · {a.natureza}: {a.resumo}
              {a.cancelado_por && <span className="no-underline"> (cancelado por {a.cancelado_por})</span>}
            </li>
          ))}
        </ol>
      </section>

      <p className="text-xs text-texto-2 border-t border-linha pt-4">
        Resumo feito por inteligência artificial. Pode errar em certidões manuscritas ou mal digitalizadas e não substitui a análise da certidão por advogado ou corretor.
      </p>
    </div>
  );
}
