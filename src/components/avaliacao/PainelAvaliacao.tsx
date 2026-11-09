"use client";

/**
 * Pré-avaliação de valor + aptidão territorial (PENDÊNCIAS 5.3 e 5.4).
 * Mesma peça na ficha da Central (modo "admin": mostra os comparáveis um a um)
 * e na ficha pública (modo "publico": só o agregado + "falar com um avaliador").
 */

import { useState } from "react";
import { enviarJson, type ErroApi } from "@/lib/api/enviar";
import { AvisoErro } from "@/components/ui/Aviso";
import { formatBRL } from "@/lib/format";
import { CAMPO } from "@/components/ui/Pagina";
import { Calculator, ChevronDown, CircleAlert, Info, LoaderCircle, MessageSquare, RefreshCw, ShieldAlert, Sprout } from "lucide-react";
import {
  AVISO_OBRIGATORIO, INDICACAO_LABEL,
  type ResultadoAptidao, type ResultadoPreAvaliacao,
} from "@/lib/avaliacao/metodologia";

type Resposta = {
  pre_avaliacao?: ResultadoPreAvaliacao & { id: string };
  aptidao?: (ResultadoAptidao & { id: string }) | { indisponivel: string };
};

const CONFIANCA: Record<string, { label: string; cor: string }> = {
  alta: { label: "Confiança alta", cor: "bg-verde/14 text-verde border-verde/25" },
  media: { label: "Confiança média", cor: "bg-alerta/14 text-alerta border-alerta/30" },
  baixa: { label: "Confiança baixa", cor: "bg-critico/12 text-critico border-critico/30" },
};
const EFEITO: Record<string, string> = {
  favorece_lavoura: "favorece lavoura", favorece_pecuaria: "favorece pecuária", restringe: "restringe", neutro: "informativo",
};
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const unit = (v: number, u: "ha" | "m2") =>
  `${v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: u === "ha" ? 0 : 2 })}/${u === "ha" ? "ha" : "m²"}`;

export default function PainelAvaliacao({
  propertyId, tipoImovel, modo, mostrarPre = true, mostrarAptidao = true, podeContatar = false,
}: {
  propertyId: string;
  tipoImovel: "rural" | "urbano";
  modo: "admin" | "publico";
  mostrarPre?: boolean;
  mostrarAptidao?: boolean;
  podeContatar?: boolean;
}) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<ErroApi | null>(null);
  const [r, setR] = useState<Resposta | null>(null);
  const [contato, setContato] = useState<{ aberto: boolean; telefone: string; mensagem: string; aceite: boolean; enviado: string | null; erro: ErroApi | null }>(
    { aberto: false, telefone: "", mensagem: "", aceite: false, enviado: null, erro: null });

  // trava o "Enviar pedido" enquanto o primeiro está em voo: clique duplo criava duas oportunidades
  const [enviando, setEnviando] = useState(false);

  const aptidaoPossivel = mostrarAptidao && tipoImovel === "rural";
  const tipo = mostrarPre && aptidaoPossivel ? "ambos" : mostrarPre ? "pre_avaliacao" : "aptidao";

  async function calcular() {
    setCarregando(true); setErro(null);
    const res = await enviarJson<Resposta>(`/api/avaliacao/${propertyId}`, "POST", { tipo });
    setCarregando(false);
    if (!res.ok) return setErro(res.erro);
    setR(res.dados);
  }

  async function pedirAvaliador() {
    if (enviando) return;
    setEnviando(true);
    const res = await enviarJson<{ oportunidade: string }>(`/api/avaliacao/${propertyId}/avaliador`, "POST", {
      telefone: contato.telefone, mensagem: contato.mensagem, consentimento: contato.aceite,
      avaliacaoId: r?.pre_avaliacao?.id,
    });
    setEnviando(false);
    if (!res.ok) return setContato((c) => ({ ...c, erro: res.erro }));
    setContato((c) => ({ ...c, enviado: res.dados.oportunidade, erro: null }));
  }

  const pre = r?.pre_avaliacao;
  const apt = r?.aptidao;

  return (
    <div className="space-y-5">
      {!r && (
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={calcular} disabled={carregando} className="btn-verde inline-flex items-center gap-2 px-5 py-3 text-sm">
            {carregando ? <LoaderCircle className="size-4 animate-spin" /> : mostrarPre ? <Calculator className="size-4" /> : <Sprout className="size-4" />}
            {carregando ? "Calculando…" : mostrarPre ? "Calcular estimativa" : "Ver aptidão da área"}
          </button>
          <p className="text-sm leading-relaxed text-texto-2 max-w-md">
            {mostrarPre && "Compara com imóveis do mesmo tipo na região. "}
            {aptidaoPossivel && "Lê o relevo no modelo de elevação e as consultas territoriais já feitas. "}
            Leva alguns segundos.
          </p>
        </div>
      )}
      {erro && <AvisoErro erro={erro} aoFechar={() => setErro(null)} />}

      {/* ---------------- pré-avaliação ---------------- */}
      {pre && pre.situacao === "dados_insuficientes" && (
        <div className="rounded-2xl border border-linha bg-superficie-2 p-5 text-sm space-y-1.5">
          <p className="flex items-center gap-2 font-display text-base font-bold text-texto"><Info className="size-4 text-texto-2" /> Dados insuficientes para estimar o valor</p>
          <p className="text-texto-2">{pre.motivo}</p>
          <p className="text-xs text-texto-2">Em vez de inventar um número, a pré-avaliação só estima quando há comparáveis suficientes.</p>
        </div>
      )}
      {pre && pre.situacao === "estimado" && (
        <div className="rounded-2xl border border-linha border-l-4 border-l-verde bg-superficie-2/40 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ouro">Faixa estimada</p>
              <p className="lp-display mt-1.5 text-3xl text-texto tabular-nums">
                {formatBRL(Math.round(pre.valor_min))} – {formatBRL(Math.round(pre.valor_max))}
              </p>
              <p className="mt-1.5 text-sm text-texto-2">
                Mediana {formatBRL(Math.round(pre.valor_mediana))} · {unit(pre.unitario_mediana, pre.unidade)} ·{" "}
                {pre.area_avaliada.toLocaleString("pt-BR")} {pre.unidade === "ha" ? "ha" : "m²"} ({pre.area_origem === "medida" ? "área medida" : "área declarada"})
              </p>
            </div>
            <span className={"whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold " + CONFIANCA[pre.confianca].cor} title={pre.confianca_motivo}>
              {CONFIANCA[pre.confianca].label}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-texto-2">
            {pre.comparaveis} comparáveis {pre.escopo === "mesmo_municipio" ? "do mesmo município" : "do município e vizinhos"} ·
            faixa por {pre.faixa_criterio === "quartis" ? "1º e 3º quartis" : "mínimo e máximo"} · {pre.confianca_motivo}.
          </p>
          <div>
            <p className="text-sm font-semibold text-texto mb-1.5">Fatores aplicados</p>
            <ul className="text-sm leading-relaxed text-texto-2 space-y-1.5">
              {pre.fatores.map((f) => (
                <li key={f.id}><span className="text-texto">{f.nome}</span> — efeito médio {pct(f.efeito_medio_pct)} em {f.aplicado_em} comparável(is). {f.explicacao}</li>
              ))}
            </ul>
          </div>
          {modo === "admin" && pre.detalhe.length > 0 && (
            <details className="group text-xs">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-texto-2 hover:text-texto">
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" /> Comparáveis um a um (só a equipe vê)
              </summary>
              <div className="mt-3 overflow-x-auto rounded-xl border border-linha">
              <table className="w-full min-w-[560px]">
                <thead className="bg-superficie-2 text-left text-[11px] uppercase tracking-[0.08em] text-texto-2">
                  <tr><th className="px-3 py-2.5">Código</th><th className="px-3">Base</th><th className="px-3 text-right">Bruto</th><th className="px-3 text-right">Fatores</th><th className="px-3 text-right">Homogeneizado</th></tr>
                </thead>
                <tbody>
                  {pre.detalhe.map((d) => (
                    <tr key={d.codigo} className="border-t border-linha transition hover:bg-superficie-2/60 [&>td]:px-3">
                      <td className="py-3 font-mono">{d.codigo}</td>
                      <td>{d.base}</td>
                      <td className="text-right tabular-nums">{unit(d.unitario_bruto, pre.unidade)}</td>
                      <td className="text-right tabular-nums">{Object.entries(d.fatores).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(" · ")}</td>
                      <td className="text-right tabular-nums">{unit(d.unitario, pre.unidade)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </details>
          )}
        </div>
      )}
      {pre && pre.alertas.length > 0 && (
        <ul className="text-sm space-y-1.5">
          {pre.alertas.map((a, i) => (
            <li key={i} className={"flex items-start gap-2 " + (a.gravidade === "restricao" ? "text-critico" : a.gravidade === "atencao" ? "text-alerta" : "text-texto-2")}>
              {a.gravidade === "restricao"
                ? <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                : <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 opacity-80" />}
              <span>{a.texto}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ---------------- aptidão ---------------- */}
      {apt && "indisponivel" in apt && <p className="text-sm text-texto-2">{apt.indisponivel}</p>}
      {apt && "indicacao" in apt && (
        <div className="rounded-2xl border border-linha bg-superficie-2/40 p-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ouro">Aptidão territorial (qualitativa)</p>
            <p className={"lp-display mt-1.5 text-xl " + (apt.indicacao === "restricoes" ? "text-critico" : apt.indicacao === "indeterminado" ? "text-texto-2" : "text-verde")}>
              {INDICACAO_LABEL[apt.indicacao]}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-texto-2">{apt.resumo}</p>
          </div>
          {apt.fatores.length > 0 && (
            <ul className="text-sm leading-relaxed space-y-1.5">
              {apt.fatores.map((f, i) => (
                <li key={i} className="text-texto-2">
                  <span className="text-texto">{f.fator}:</span> {f.valor} <span className="opacity-70">({EFEITO[f.efeito]} · {f.fonte})</span>
                </li>
              ))}
            </ul>
          )}
          {apt.limitacoes.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-texto mb-1.5">Limitações</p>
              <ul className="text-sm leading-relaxed text-texto-2 list-disc pl-5 space-y-1">{apt.limitacoes.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-texto mb-1.5">Dados que faltam</p>
            <ul className="text-sm leading-relaxed text-texto-2 list-disc pl-5 space-y-1">{apt.dados_faltantes.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
        </div>
      )}

      {r && (
        <div className="rounded-2xl bg-ouro/10 border border-ouro/30 p-5 text-sm space-y-3">
          <p className="flex items-start gap-2 font-semibold text-texto"><Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ouro" /> {AVISO_OBRIGATORIO}</p>
          <p className="text-xs leading-relaxed text-texto-2">
            Metodologia {pre?.metodologia_versao ?? (apt && "metodologia_versao" in apt ? apt.metodologia_versao : "")}: comparáveis do próprio sistema,
            fatores documentados e nenhuma rentabilidade sem dado que a sustente. Para negociar, financiar ou partilhar, peça um laudo a um avaliador habilitado.
          </p>
          {modo === "publico" && podeContatar && !contato.enviado && (
            contato.aberto ? (
              <div className="space-y-3 pt-1">
                <input value={contato.telefone} onChange={(e) => setContato({ ...contato, telefone: e.target.value })}
                  placeholder="Telefone (opcional)" maxLength={30}
                  className={CAMPO} />
                <textarea value={contato.mensagem} onChange={(e) => setContato({ ...contato, mensagem: e.target.value })}
                  placeholder="Algo que o avaliador deva saber? (opcional)" rows={2} maxLength={1000}
                  className={CAMPO} />
                <label className="flex items-start gap-2.5 text-sm leading-relaxed text-texto-2">
                  <input type="checkbox" checked={contato.aceite} onChange={(e) => setContato({ ...contato, aceite: e.target.checked })} className="mt-1 size-4 shrink-0 accent-verde" />
                  Autorizo a Arini a me contatar sobre a avaliação deste imóvel, conforme a Política de Privacidade.
                </label>
                {contato.erro && <AvisoErro erro={contato.erro} aoFechar={() => setContato({ ...contato, erro: null })} />}
                <button type="button" onClick={pedirAvaliador} disabled={!contato.aceite || enviando} className="btn-ouro px-5 py-3 text-sm disabled:opacity-50">
                  {enviando ? "Enviando..." : "Enviar pedido"}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setContato({ ...contato, aberto: true })} className="btn-ouro inline-flex items-center gap-2 px-5 py-3 text-sm">
                <MessageSquare className="size-4" /> Falar com um avaliador
              </button>
            )
          )}
          {contato.enviado && <p className="text-sm text-verde">Pedido registrado ({contato.enviado}). A equipe da Arini vai entrar em contato.</p>}
          {modo === "admin" && (
            <button type="button" onClick={calcular} disabled={carregando} className="btn-contorno inline-flex items-center gap-1.5 px-4 py-2 text-xs">
              <RefreshCw className={"size-3.5 " + (carregando ? "animate-spin" : "")} />
              {carregando ? "Calculando…" : "Calcular de novo"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
