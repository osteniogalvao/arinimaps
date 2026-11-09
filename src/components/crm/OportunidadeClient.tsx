"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONTRATO_LABEL, ETAPAS, ETAPA_LABEL, humanizarEvento } from "@/lib/funil";
import { Workflow, CalendarDays, HandCoins, FileSignature, BadgeDollarSign, MessagesSquare, Paperclip, Download, type LucideIcon } from "lucide-react";
import { CAMPO, Etiqueta } from "@/components/ui/Pagina";
import { enviarJson } from "@/lib/api/enviar";
import { lerNumeroBR, numeroParaCampo } from "@/lib/simulador";

type Parceiro = { id: string; razao_social: string; tipo: string };
type Evento = { id: string; tipo: string; descricao: string; created_at: string; autor: string | null };
type Visita = { id: string; data_hora: string; status: string; feedback: string | null };
type Proposta = { id: string; numero_rodada: number; autor_lado: string; valor: number; entrada: number | null; prazo: string | null; condicoes: string | null; observacoes: string | null; status: string; created_at: string };

type Props = {
  modo: "arini" | "parceiro";
  oportunidade: {
    id: string; etapa: string; responsavel_tipo: string;
    responsavel_partner_id: string | null; partner_comprador_id: string | null;
    motivo_perda: string | null; valor_imovel: number | null;
  };
  parceiros: Parceiro[];
  eventos: Evento[];
  visitas: Visita[];
  propostas: Proposta[];
  contrato: { status: string; documento_path: string | null; assinado_at: string | null } | null;
  venda: { valor_final: number; data_venda: string; comissao: { valor: number; percentual: number; status: string } | null } | null;
  percentualPadrao: number;
};

const input = CAMPO;
const btn = "inline-flex shrink-0 items-center justify-center gap-2 px-5 py-3 text-sm disabled:opacity-50";

export default function OportunidadeClient(props: Props) {
  const { modo, oportunidade: o, parceiros } = props;
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const base = `/api/oportunidades/${o.id}`;

  async function chamar(method: "PATCH" | "POST", body: unknown) {
    setOcupado(true);
    setErro("");
    // enviarJson nunca lança: queda de rede ou resposta sem JSON viram erro com motivo
    const r = await enviarJson(base, method, body);
    setOcupado(false);
    if (!r.ok) { setErro(r.erro.mensagem); return false; }
    router.refresh();
    return true;
  }

  // ---------- estados de formulários ----------
  const [nota, setNota] = useState("");
  const [visitaData, setVisitaData] = useState("");
  const [prop, setProp] = useState({ autor_lado: "comprador", valor: "", entrada: "", prazo: "", condicoes: "", observacoes: "" });
  const [venda, setVenda] = useState({
    // formato brasileiro no campo: "350000.5".toString() lido como milhar gravava a venda 10× maior
    valor_final: numeroParaCampo(props.propostas.find((p) => p.status === "aceita")?.valor ?? o.valor_imovel),
    percentual: String(props.percentualPadrao),
    regra: "",
  });

  const brl = (v: number | null | undefined) =>
    v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {erro && <p className="lg:col-span-2 rounded-xl border border-critico/30 bg-critico/10 px-4 py-3 text-sm text-critico">{erro}</p>}

      {/* ---------- etapa + encaminhamento ---------- */}
      <section className="cartao space-y-4 p-5 md:p-6">
        <Titulo icone={Workflow}>Etapa do funil</Titulo>
        <div className="flex flex-wrap gap-3">
          <select className={input + " max-w-56"} value={o.etapa}
            onChange={(e) => chamar("PATCH", { acao: "etapa", etapa: e.target.value })} disabled={ocupado}>
            {[...ETAPAS, "perdido"].map((e) => <option key={e} value={e}>{ETAPA_LABEL[e]}</option>)}
          </select>
          <button disabled={ocupado} className={`${btn} btn-perigo`}
            onClick={() => {
              const motivo = prompt("Motivo da perda:");
              if (motivo !== null) chamar("PATCH", { acao: "etapa", etapa: "perdido", motivo });
            }}>
            Marcar perdido
          </button>
        </div>
        {o.motivo_perda && <p className="text-xs text-critico">Perdido: {o.motivo_perda}</p>}

        {modo === "arini" && (
          <div className="space-y-3 border-t border-linha pt-4">
            <h3 className="text-base font-semibold text-texto">Encaminhamento (intermediação Arini)</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <select className={input} value={o.responsavel_tipo} disabled={ocupado}
                onChange={(e) => chamar("PATCH", { acao: "encaminhar", responsavel_tipo: e.target.value, responsavel_partner_id: o.responsavel_partner_id, partner_comprador_id: o.partner_comprador_id })}>
                <option value="arini">Arini atende</option>
                <option value="proprietario">Proprietário atende</option>
                <option value="parceiro">Parceiro atende</option>
              </select>
              <select className={input} value={o.responsavel_partner_id ?? ""} disabled={ocupado}
                onChange={(e) => chamar("PATCH", { acao: "encaminhar", responsavel_tipo: "parceiro", responsavel_partner_id: e.target.value || null, partner_comprador_id: o.partner_comprador_id })}>
                <option value="">Parceiro do imóvel (A)…</option>
                {parceiros.map((p) => <option key={p.id} value={p.id}>{p.razao_social} ({p.tipo})</option>)}
              </select>
            </div>
            <select className={input} value={o.partner_comprador_id ?? ""} disabled={ocupado}
              onChange={(e) => chamar("PATCH", { acao: "encaminhar", responsavel_tipo: o.responsavel_tipo, responsavel_partner_id: o.responsavel_partner_id, partner_comprador_id: e.target.value || null })}>
              <option value="">Parceiro do comprador (B) — opcional</option>
              {parceiros.map((p) => <option key={p.id} value={p.id}>{p.razao_social} ({p.tipo})</option>)}
            </select>
          </div>
        )}
      </section>

      {/* ---------- visitas ---------- */}
      <section className="cartao space-y-4 p-5 md:p-6">
        <Titulo icone={CalendarDays}>Visitas</Titulo>
        <div className="flex gap-3">
          <input type="datetime-local" className={input} value={visitaData} onChange={(e) => setVisitaData(e.target.value)} />
          <button disabled={ocupado || !visitaData} className={`${btn} btn-verde`}
            onClick={async () => {
              // datetime-local não tem fuso: converte no navegador (horário de quem agenda) para ISO com fuso
              const quando = new Date(visitaData);
              if (Number.isNaN(quando.getTime())) { setErro("Data e hora inválidas."); return; }
              if (await chamar("POST", { tipo: "visita", data_hora: quando.toISOString() })) setVisitaData("");
            }}>
            Agendar
          </button>
        </div>
        <div className="space-y-2">
          {props.visitas.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-superficie-2 px-4 py-3 text-[0.95rem]">
              <span className="flex-1">{new Date(v.data_hora).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} — <strong>{v.status}</strong>{v.feedback ? ` · ${v.feedback}` : ""}</span>
              {v.status === "agendada" && (
                <span className="flex gap-1">
                  {(["realizada", "remarcada", "nao_compareceu"] as const).map((s) => (
                    <button key={s} disabled={ocupado}
                      className="btn-contorno px-2.5 py-1.5 text-xs"
                      onClick={() => {
                        const feedback = s === "realizada" ? prompt("Como foi a visita? (opcional)") ?? "" : "";
                        chamar("POST", { tipo: "visita_status", visita_id: v.id, status: s, feedback });
                      }}>
                      {s === "nao_compareceu" ? "não veio" : s}
                    </button>
                  ))}
                </span>
              )}
            </div>
          ))}
          {!props.visitas.length && <p className="text-xs text-texto-2">Nenhuma visita ainda.</p>}
        </div>
      </section>

      {/* ---------- propostas ---------- */}
      <section className="cartao space-y-4 p-5 md:p-6">
        <Titulo icone={HandCoins}>Propostas e contrapropostas</Titulo>
        <div className="grid gap-3 sm:grid-cols-2">
          <select className={input} value={prop.autor_lado} onChange={(e) => setProp({ ...prop, autor_lado: e.target.value })}>
            <option value="comprador">Proposta do comprador</option>
            <option value="vendedor">Contraproposta do vendedor</option>
          </select>
          <input className={input} placeholder="Valor (R$)" inputMode="numeric" value={prop.valor}
            onChange={(e) => setProp({ ...prop, valor: e.target.value })} />
          <input className={input} placeholder="Entrada (R$, opcional)" inputMode="numeric" value={prop.entrada}
            onChange={(e) => setProp({ ...prop, entrada: e.target.value })} />
          <input className={input} placeholder="Prazo (ex.: 4 parcelas semestrais)" value={prop.prazo}
            onChange={(e) => setProp({ ...prop, prazo: e.target.value })} />
        </div>
        <textarea rows={2} className={input} placeholder="Condições e observações"
          value={prop.condicoes} onChange={(e) => setProp({ ...prop, condicoes: e.target.value })} />
        <button disabled={ocupado || !prop.valor} className={`${btn} btn-verde`}
          onClick={async () => {
            const ok = await chamar("POST", {
              tipo: "proposta", autor_lado: prop.autor_lado,
              valor: lerNumeroBR(prop.valor),
              entrada: prop.entrada ? lerNumeroBR(prop.entrada) : null,
              prazo: prop.prazo || null, condicoes: prop.condicoes || null,
            });
            if (ok) setProp({ autor_lado: "comprador", valor: "", entrada: "", prazo: "", condicoes: "", observacoes: "" });
          }}>
          Registrar rodada
        </button>
        <div className="space-y-2">
          {props.propostas.map((p) => (
            <div key={p.id} className="space-y-1.5 rounded-xl bg-superficie-2 px-4 py-3 text-[0.95rem]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">R{p.numero_rodada}</span>
                <span className="flex-1">{p.autor_lado === "comprador" ? "Comprador" : "Vendedor"}: <strong>{brl(p.valor)}</strong>{p.entrada ? ` (entrada ${brl(p.entrada)})` : ""}{p.prazo ? ` · ${p.prazo}` : ""}</span>
                <Etiqueta tom={p.status === "aceita" ? "verde" : p.status === "recusada" ? "critico" : "neutro"}>{p.status}</Etiqueta>
                {p.status === "enviada" && (
                  <span className="flex gap-1">
                    <button disabled={ocupado} className="btn-verde px-2.5 py-1.5 text-xs"
                      onClick={() => chamar("POST", { tipo: "proposta_status", proposta_id: p.id, status: "aceita" })}>aceitar</button>
                    <button disabled={ocupado} className="btn-perigo px-2.5 py-1.5 text-xs"
                      onClick={() => chamar("POST", { tipo: "proposta_status", proposta_id: p.id, status: "recusada" })}>recusar</button>
                  </span>
                )}
              </div>
              {p.condicoes && <p className="text-xs text-texto-2">{p.condicoes}</p>}
            </div>
          ))}
          {!props.propostas.length && <p className="text-xs text-texto-2">Nenhuma proposta registrada.</p>}
        </div>
      </section>

      {/* ---------- contrato + venda (só Arini) ---------- */}
      {modo === "arini" && (
        <section className="cartao space-y-5 p-5 md:p-6">
          <div className="space-y-2">
            <Titulo icone={FileSignature}>Contrato</Titulo>
            <div className="flex flex-wrap gap-2 items-center text-sm">
              <span>Status: <strong>{props.contrato ? CONTRATO_LABEL[props.contrato.status] ?? props.contrato.status : "sem contrato"}</strong></span>
              {(["em_elaboracao", "assinado", "registrado"] as const).map((s) => (
                <button key={s} disabled={ocupado}
                  className="btn-contorno px-2.5 py-1.5 text-xs"
                  onClick={() => chamar("POST", { tipo: "contrato_status", status: s })}>
                  {CONTRATO_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="btn-contorno inline-flex cursor-pointer items-center gap-1.5 px-3.5 py-2 text-sm">
                <Paperclip className="size-4" /> Anexar documento
                <input type="file" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setOcupado(true);
                  setErro("");
                  const fd = new FormData();
                  fd.set("arquivo", f);
                  try {
                    const res = await fetch(`${base}/contrato`, { method: "POST", body: fd });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok) router.refresh();
                    else setErro(data.error ?? `Falha no upload do contrato (${res.status}).`);
                  } catch {
                    setErro("O servidor não respondeu. Confira a internet e tente de novo.");
                  } finally {
                    setOcupado(false);
                    e.target.value = "";
                  }
                }} />
              </label>
              {props.contrato?.documento_path && (
                <button className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline"
                  onClick={async () => {
                    setErro("");
                    try {
                      const res = await fetch(`${base}/contrato`);
                      const data = await res.json().catch(() => ({}));
                      if (res.ok && data.url) window.open(data.url, "_blank");
                      else setErro(data.error ?? "Não foi possível baixar o contrato.");
                    } catch {
                      setErro("O servidor não respondeu. Confira a internet e tente de novo.");
                    }
                  }}>
                  <Download className="size-4" /> Baixar contrato
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3 border-t border-linha pt-5">
            <Titulo icone={BadgeDollarSign}>Registrar venda</Titulo>
            {props.venda ? (
              <div className="rounded-xl border border-verde/40 bg-verde/10 px-4 py-3 text-[0.95rem] text-texto">
                Venda registrada: <strong>{brl(props.venda.valor_final)}</strong> em {new Date(props.venda.data_venda + "T12:00:00").toLocaleDateString("pt-BR")}
                {props.venda.comissao && <> · comissão {props.venda.comissao.percentual}% = <strong>{brl(props.venda.comissao.valor)}</strong> ({props.venda.comissao.status})</>}
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className={input} placeholder="Valor final (R$)" inputMode="numeric"
                    value={venda.valor_final} onChange={(e) => setVenda({ ...venda, valor_final: e.target.value })} />
                  <input className={input} placeholder="Comissão %" inputMode="decimal"
                    value={venda.percentual} onChange={(e) => setVenda({ ...venda, percentual: e.target.value })} />
                </div>
                <input className={input} placeholder="Regra contratual da comissão (opcional)"
                  value={venda.regra} onChange={(e) => setVenda({ ...venda, regra: e.target.value })} />
                <button disabled={ocupado || !venda.valor_final}
                  className={`${btn} btn-ouro`}
                  onClick={() => {
                    const valorFinal = lerNumeroBR(venda.valor_final);
                    const percentual = lerNumeroBR(venda.percentual);
                    if (!(valorFinal > 0)) { setErro("Valor final inválido."); return; }
                    if (!(percentual >= 0)) { setErro("Percentual de comissão inválido."); return; }
                    if (!confirm(`Registrar a venda de ${brl(valorFinal)}? O imóvel vira VENDIDO e sai da oferta.`)) return;
                    chamar("POST", {
                      tipo: "venda",
                      valor_final: valorFinal,
                      percentual,
                      regra: venda.regra || null,
                    });
                  }}>
                  Registrar venda + comissão
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* ---------- timeline ---------- */}
      <section className="cartao space-y-4 p-5 md:p-6 lg:col-span-2">
        <Titulo icone={MessagesSquare}>Timeline do atendimento</Titulo>
        <div className="flex gap-3">
          <input className={input} placeholder="Registrar contato / anotação…" value={nota}
            onChange={(e) => setNota(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && nota.trim()) {
                if (await chamar("POST", { tipo: "evento", categoria: "contato", descricao: nota })) setNota("");
              }
            }} />
          <button disabled={ocupado || !nota.trim()} className={`${btn} btn-verde`}
            onClick={async () => { if (await chamar("POST", { tipo: "evento", categoria: "contato", descricao: nota })) setNota(""); }}>
            Registrar
          </button>
        </div>
        <ol className="space-y-0 border-l-2 border-linha pl-5 text-[0.95rem]">
          {props.eventos.map((e) => (
            <li key={e.id} className="relative flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3 before:absolute before:-left-[27px] before:top-3.5 before:size-3 before:rounded-full before:border-2 before:border-verde before:bg-superficie">
              <span className="text-xs text-texto-2 tabular-nums shrink-0 w-32">
                {new Date(e.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="flex-1">{humanizarEvento(e.descricao)}{e.autor ? <span className="text-texto-2"> — {e.autor}</span> : null}</span>
            </li>
          ))}
          {!props.eventos.length && <p className="text-xs text-texto-2">Sem eventos ainda.</p>}
        </ol>
      </section>
    </div>
  );
}

function Titulo({ icone: Icone, children }: { icone: LucideIcon; children: React.ReactNode }) {
  return (
    <h2 className="lp-display flex items-center gap-3 text-xl text-texto">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-verde/12 text-verde">
        <Icone className="size-[18px]" />
      </span>
      {children}
    </h2>
  );
}
