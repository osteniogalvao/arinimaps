"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3, CheckCircle2, CloudRain, Download, Eye, FileText, Landmark, Loader2, Lock, Map as MapaIcone,
  ScrollText, ShieldCheck, Trees, type LucideIcon,
} from "lucide-react";

type Modelo = "simples" | "completo";
type Opcao = { id: string; titulo: string; descricao: string; icone: LucideIcon; so?: "completo" };

/**
 * Página de geração do relatório em PDF (áudio do Carlos, 17/11/2026: "melhorar
 * o visual dos PDFs e da página de geração"). Substitui os botões soltos e o
 * "Personalizar relatório" de caixas de seleção por um gerador só: escolhe o
 * modelo, liga e desliga as seções em cartões, e visualiza ou baixa o PDF com
 * aviso de progresso e de erro. Os parâmetros são os mesmos da rota.
 */
export default function GeradorRelatorio({ caminho, raioM, completo, desenho = false, nomeArquivo }: {
  caminho: string; raioM: number; completo: boolean; desenho?: boolean; nomeArquivo: string;
}) {
  const opcoes: Opcao[] = useMemo(() => [
    { id: "cadastro", titulo: desenho ? "Dados da área" : "Dados do cadastro", descricao: desenho ? "Área, município e data" : "Situação, área e município no SICAR", icone: ScrollText },
    { id: "mapa", titulo: "Mapa de satélite", descricao: "Divisa sobre imagem, com escala e norte", icone: MapaIcone },
    { id: "matricula", titulo: "Matrículas (SIGEF)", descricao: "Parcelas certificadas que cobrem a área", icone: Landmark },
    { id: "uso", titulo: "Uso do solo", descricao: "Vegetação, lavoura e água em gráfico", icone: Trees },
    ...(!desenho ? [{ id: "ambiente", titulo: "Ambiente no perímetro", descricao: "Reserva legal, APP e nascentes", icone: ShieldCheck, so: "completo" as const }] : []),
    { id: "clima", titulo: "Chuva dos últimos 30 dias", descricao: "Série diária da NASA POWER", icone: CloudRain, so: "completo" },
    { id: "fontes", titulo: "Fontes oficiais", descricao: "Painel com IBAMA, INPE, FUNAI, ANM...", icone: BarChart3, so: "completo" },
  ], [desenho]);
  const [modelo, setModelo] = useState<Modelo>(completo ? "completo" : "simples");
  const disponiveis = opcoes.filter((o) => !o.so || modelo === "completo");
  const [desligadas, setDesligadas] = useState<Set<string>>(new Set());
  const ligadas = disponiveis.filter((o) => !desligadas.has(o.id));
  const [estado, setEstado] = useState<{ tipo: "ocioso" | "gerando" | "pronto" | "erro"; texto?: string }>({ tipo: "ocioso" });

  const url = (visualizar: boolean) => {
    const p = new URLSearchParams({ modelo, raio_m: String(raioM) });
    if (ligadas.length !== disponiveis.length) {
      p.set("personalizar", "1");
      for (const o of ligadas) p.append("secao", o.id);
    }
    if (visualizar) p.set("visualizar", "1");
    return caminho + "?" + p;
  };

  async function baixar() {
    setEstado({ tipo: "gerando" });
    try {
      const r = await fetch(url(false), { headers: { accept: "application/json" } });
      if (!r.ok) {
        const erro = await r.json().catch(() => null);
        throw new Error(erro?.error ?? "Não foi possível gerar o PDF agora. Tente de novo em instantes.");
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ARINI-${nomeArquivo}-${modelo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      setEstado({ tipo: "pronto", texto: `PDF ${modelo} baixado (${Math.max(1, Math.round(blob.size / 1024)).toLocaleString("pt-BR")} KB).` });
    } catch (e) {
      setEstado({ tipo: "erro", texto: e instanceof Error ? e.message : "Falha ao gerar o PDF." });
    }
  }

  const alternar = (id: string) => {
    const novo = new Set(desligadas);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    setDesligadas(novo);
    setEstado({ tipo: "ocioso" });
  };
  const gerando = estado.tipo === "gerando";

  return (
    <section aria-labelledby="gerar-relatorio" className="overflow-hidden rounded-[20px] border border-verde/25 bg-superficie shadow-sm">
      <header className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-verde to-[#0a2119] px-5 py-4 text-white md:px-6">
        <span className="grid size-10 place-items-center rounded-xl bg-white/12"><FileText className="size-5" aria-hidden /></span>
        <div className="mr-auto">
          <h3 id="gerar-relatorio" className="lp-display text-xl leading-tight">Relatório em PDF</h3>
          <p className="text-xs text-white/75">Com a marca ARINI, mapa de satélite e a data de cada fonte.</p>
        </div>
        <span className="rounded-full border border-[#D9BD6F]/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#D9BD6F]">
          Raio das fontes: {raioM >= 1000 ? `${(raioM / 1000).toLocaleString("pt-BR")} km` : `${raioM} m`}
        </span>
      </header>

      <div className="space-y-6 p-5 md:p-6">
        <fieldset>
          <legend className="mb-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">1 · Modelo</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["simples", "completo"] as const).map((m) => {
              const bloqueado = m === "completo" && !completo;
              const ativo = modelo === m;
              return (
                <label key={m} className={"relative flex cursor-pointer gap-3 rounded-2xl border-2 p-4 transition " +
                  (ativo ? "border-verde bg-verde/[0.06]" : "border-linha hover:border-verde/40") + (bloqueado ? " cursor-not-allowed opacity-70" : "")}>
                  <input type="radio" name="modelo" value={m} checked={ativo} disabled={bloqueado} className="sr-only"
                    onChange={() => { setModelo(m); setEstado({ tipo: "ocioso" }); }} />
                  <span className={"mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 " + (ativo ? "border-verde" : "border-linha")}>
                    {ativo && <span className="size-2.5 rounded-full bg-verde" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-semibold text-texto">
                      Relatório {m}
                      {bloqueado && <Lock className="size-3.5 text-texto-2" aria-label="Não incluso no seu plano" />}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-texto-2">
                      {m === "simples"
                        ? "Dados, mapa de satélite, matrículas e uso do solo. Uma a duas páginas."
                        : "Tudo do simples, mais painel das fontes oficiais, ambiente e chuva."}
                    </span>
                    {bloqueado && <Link href="/planos?recurso=relatorio_territorial" className="mt-1.5 inline-block text-xs font-semibold text-verde underline">Ver planos com o completo</Link>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2.5 flex w-full items-center justify-between text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-texto-2">
            <span>2 · O que entra no PDF</span>
            <span className="normal-case tracking-normal">
              {ligadas.length} de {disponiveis.length}
              {desligadas.size > 0 && <button type="button" className="ml-2 font-semibold text-verde underline" onClick={() => setDesligadas(new Set())}>marcar todas</button>}
            </span>
          </legend>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {disponiveis.map((o) => {
              const ligada = !desligadas.has(o.id);
              const Icone = o.icone;
              return (
                <button key={o.id} type="button" role="checkbox" aria-checked={ligada} onClick={() => alternar(o.id)}
                  className={"flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition " +
                    (ligada ? "border-verde/50 bg-verde/[0.05]" : "border-linha bg-superficie-2/40 opacity-60 hover:opacity-90")}>
                  <span className={"grid size-9 shrink-0 place-items-center rounded-lg " + (ligada ? "bg-verde text-white" : "bg-linha text-texto-2")}>
                    <Icone className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-tight text-texto">{o.titulo}</span>
                    <span className="block truncate text-xs text-texto-2">{o.descricao}</span>
                  </span>
                  <CheckCircle2 className={"size-5 shrink-0 " + (ligada ? "text-verde" : "text-linha")} aria-hidden />
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-linha pt-5 sm:flex-row sm:items-center">
          <a href={ligadas.length ? url(true) : undefined} target="_blank" rel="noreferrer" aria-disabled={!ligadas.length}
            className={"btn-contorno inline-flex items-center justify-center gap-2 px-5 py-3 text-sm" + (ligadas.length ? "" : " pointer-events-none opacity-50")}>
            <Eye className="size-4" aria-hidden /> Visualizar
          </a>
          <button type="button" onClick={baixar} disabled={!ligadas.length || gerando}
            className="btn-verde inline-flex items-center justify-center gap-2 px-5 py-3 text-sm disabled:opacity-60">
            {gerando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            {gerando ? "Gerando o PDF..." : `Baixar PDF ${modelo}`}
          </button>
          <p role="status" aria-live="polite" className={"text-xs leading-relaxed sm:ml-2 " +
            (estado.tipo === "erro" ? "font-semibold text-red-700" : estado.tipo === "pronto" ? "font-semibold text-verde" : "text-texto-2")}>
            {estado.tipo === "gerando" ? "Montando o mapa e consultando as fontes. Pode levar até 30 segundos."
              : estado.texto ?? (ligadas.length ? "" : "Ligue ao menos uma seção.")}
          </p>
        </div>
      </div>
    </section>
  );
}
