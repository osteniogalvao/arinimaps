"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { recursoPorId, type Campo } from "@/lib/registros";
import { Etiqueta } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO, LISTA_VAZIA, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "./estilos";

export type Linha = Record<string, unknown> & { id: string };
export type Opcoes = Record<string, { id: string; rotulo: string }[]>;

const brl = (v: unknown) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (v: unknown) => (v ? new Date(String(v).length === 10 ? `${v}T12:00:00` : String(v)).toLocaleDateString("pt-BR") : "—");

function mostrar(c: Campo, v: unknown, opcoes: Opcoes) {
  if (v === null || v === undefined || v === "") return "—";
  switch (c.tipo) {
    case "dinheiro": return brl(v);
    case "data": return dataBR(v);
    case "datahora": return new Date(String(v)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    case "bool": return v ? "Sim" : "Não";
    case "select": return c.opcoes?.find(([k]) => k === String(v))?.[1] ?? String(v);
    case "ref": case "membro": return opcoes[c.nome]?.find((o) => o.id === v)?.rotulo ?? "—";
    default: return String(v);
  }
}

const TOM_STATUS: Record<string, "verde" | "ouro" | "critico" | "neutro" | "alerta"> = {
  aprovada: "verde", paga: "verde", emitida: "verde", publicada: "verde", aprovado: "verde", entrada: "verde", concluido: "verde",
  pendente: "ouro", enviada: "ouro", rascunho: "neutro", agendada: "ouro", aguardando: "ouro",
  reprovada: "critico", erro: "critico", cancelada: "neutro", saida: "alerta", reprovado: "critico",
};

/**
 * Lista e formulário de um cadastro da Central (src/lib/registros.ts):
 * criar, editar em linha e executar as ações do fluxo (aprovar, emitir…).
 */
export default function Registros({ recursoId, linhas, opcoes, podeEscrever, nomes = {} }: {
  recursoId: string; linhas: Linha[]; opcoes: Opcoes; podeEscrever: boolean; nomes?: Record<string, string>;
}) {
  const r = recursoPorId(recursoId)!;
  const router = useRouter();
  const [aberto, setAberto] = useState<"novo" | string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  const editaveis = r.campos.filter((c) => !c.sistema);
  const colunas = r.campos.filter((c) => c.lista);

  async function enviar(method: "POST" | "PATCH" | "DELETE", corpo: Record<string, unknown>) {
    setOcupado(true); setErro("");
    const url = `/api/admin/registros/${r.id}` + (method === "DELETE" ? `?id=${corpo.id}` : "");
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(corpo),
    });
    setOcupado(false);
    if (!res.ok) { setErro((await res.json().catch(() => ({}))).error ?? "Não foi possível salvar."); return false; }
    router.refresh();
    return true;
  }

  function abrir(l?: Linha) {
    setErro("");
    if (!l) {
      setForm(Object.fromEntries(editaveis.map((c) => [c.nome, c.padrao ?? (c.tipo === "bool" ? false : "")])));
      setAberto("novo");
    } else {
      setForm(Object.fromEntries(editaveis.map((c) => [c.nome, l[c.nome] ?? (c.tipo === "bool" ? false : "")])));
      setAberto(l.id);
    }
  }

  async function acao(l: Linha, id: string, pedeMotivo?: boolean, rotulo?: string) {
    let motivo = "";
    if (pedeMotivo) {
      motivo = window.prompt(`${rotulo}: explique o motivo`) ?? "";
      if (!motivo.trim()) return;
    }
    await enviar("PATCH", { id: l.id, acao: id, motivo });
  }

  const statusDe = (l: Linha) => (r.status ? String(l[r.status.coluna] ?? "") : "");
  const editavel = (l: Linha) => podeEscrever && (!r.status?.abertos || r.status.abertos.includes(statusDe(l)));

  return (
    <div className="space-y-4">
      {podeEscrever && aberto !== "novo" && (
        <button type="button" onClick={() => abrir()} className="btn-verde inline-flex items-center gap-1.5 px-4 py-2 text-sm">
          <Plus className="size-4" /> Nova {r.singular}
        </button>
      )}
      {erro && <p className="rounded-xl border border-critico/30 bg-critico/10 px-4 py-2.5 text-sm text-critico">{erro}</p>}

      {aberto && (
        <form className="cartao space-y-4 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await enviar(aberto === "novo" ? "POST" : "PATCH", aberto === "novo" ? form : { ...form, id: aberto });
            if (ok) setAberto(null);
          }}>
          <div className="flex items-center justify-between">
            <p className="font-semibold text-texto">{aberto === "novo" ? `Nova ${r.singular}` : `Editar ${r.singular}`}</p>
            <button type="button" onClick={() => setAberto(null)} aria-label="Fechar" className="text-texto-2 hover:text-texto"><X className="size-5" /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {editaveis.filter((c) => aberto === "novo" || !c.soCriar).map((c) => (
              <label key={c.nome} className={"block text-sm " + (c.tipo === "textarea" ? "sm:col-span-2" : "")}>
                <span className="mb-1 block font-semibold text-texto">{c.rotulo}{c.obrigatorio && " *"}</span>
                <CampoForm c={c} valor={form[c.nome]} opcoes={opcoes[c.nome] ?? []} onChange={(v) => setForm({ ...form, [c.nome]: v })} />
                {c.ajuda && <span className="mt-1 block text-xs text-texto-2">{c.ajuda}</span>}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button disabled={ocupado} className="btn-verde px-4 py-2 text-sm disabled:opacity-60">{ocupado ? "Salvando…" : "Salvar"}</button>
            <button type="button" onClick={() => setAberto(null)} className="btn-contorno px-4 py-2 text-sm">Cancelar</button>
          </div>
        </form>
      )}

      <div className={TABELA_CAIXA}>
        <table className={TABELA}>
          <thead className={THEAD}>
            <tr>
              <th className={TH}>{r.campos.find((c) => c.nome === r.tituloColuna)?.rotulo ?? "Nome"}</th>
              {colunas.map((c) => <th key={c.nome} className={TH}>{c.rotulo}</th>)}
              {r.status && <th className={TH}>Situação</th>}
              {r.autorColuna && <th className={TH}>Por</th>}
              <th className={TH}></th>
            </tr>
          </thead>
          <tbody className={TBODY}>
            {linhas.map((l) => {
              const st = statusDe(l);
              const acoes = (r.acoes ?? []).filter((x) => !r.status || x.quando.includes(st));
              return (
                <tr key={l.id} className={TR}>
                  <td className={TD}>
                    {r.codigo && <span className="mr-2 font-mono text-xs text-texto-2">{String(l[r.codigo] ?? "")}</span>}
                    <span className="font-medium text-texto">{String(l[r.tituloColuna] ?? "—")}</span>
                    {typeof l.motivo === "string" && l.motivo && <span className="mt-0.5 block text-xs text-texto-2">Motivo: {l.motivo}</span>}
                    {typeof l.erro === "string" && l.erro && <span className="mt-0.5 block text-xs text-critico">{l.erro}</span>}
                    {typeof l.pdf_url === "string" && l.pdf_url && <a href={l.pdf_url} target="_blank" rel="noreferrer" className="mt-0.5 block text-xs font-semibold text-verde hover:underline">Baixar PDF</a>}
                  </td>
                  {colunas.map((c) => <td key={c.nome} className={TD + " tabular-nums"}>{mostrar(c, l[c.nome], opcoes)}</td>)}
                  {r.status && <td className={TD}><Etiqueta tom={TOM_STATUS[st] ?? "neutro"}>{r.status.rotulos[st] ?? st}</Etiqueta></td>}
                  {r.autorColuna && <td className={TD + " text-xs text-texto-2"}>{nomes[String(l[r.autorColuna] ?? "")] ?? "—"}</td>}
                  <td className={TD}>
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {podeEscrever && acoes.map((x) => (
                        <button key={x.id} type="button" disabled={ocupado} onClick={() => acao(l, x.id, x.pedeMotivo, x.rotulo)}
                          className={"rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-60 " +
                            (x.tom === "verde" ? "border-verde bg-verde text-fundo" : x.tom === "critico" ? "border-critico/40 text-critico" : "border-linha-forte text-texto-2 hover:text-texto")}>
                          {x.rotulo}
                        </button>
                      ))}
                      {editavel(l) && (
                        <button type="button" onClick={() => abrir(l)} aria-label="Editar" className="rounded-full p-1.5 text-texto-2 hover:text-texto"><Pencil className="size-4" /></button>
                      )}
                      {podeEscrever && r.excluir && (
                        <button type="button" aria-label="Excluir" className="rounded-full p-1.5 text-texto-2 hover:text-critico"
                          onClick={() => { if (window.confirm("Excluir este registro?")) void enviar("DELETE", { id: l.id }); }}>
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!linhas.length && <p className={LISTA_VAZIA}>Nada por aqui ainda.</p>}
      </div>
    </div>
  );
}

function CampoForm({ c, valor, opcoes, onChange }: {
  c: Campo; valor: unknown; opcoes: { id: string; rotulo: string }[]; onChange: (v: unknown) => void;
}) {
  const cls = CAMPO_COMPACTO + " w-full";
  const v = valor === null || valor === undefined ? "" : String(valor);
  switch (c.tipo) {
    case "textarea":
      return <textarea className={cls + " min-h-24"} value={v} required={c.obrigatorio} onChange={(e) => onChange(e.target.value)} />;
    case "bool":
      return <input type="checkbox" className="size-5 accent-[var(--color-verde)]" checked={valor === true} onChange={(e) => onChange(e.target.checked)} />;
    case "select":
      return (
        <select className={cls} value={v} required={c.obrigatorio} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {c.opcoes?.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      );
    case "ref": case "membro":
      return (
        <select className={cls} value={v} required={c.obrigatorio} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
        </select>
      );
    case "dinheiro": case "numero":
      return <input type="number" step={c.tipo === "dinheiro" ? "0.01" : "any"} className={cls} value={v} required={c.obrigatorio} onChange={(e) => onChange(e.target.value)} />;
    case "data":
      return <input type="date" className={cls} value={v.slice(0, 10)} required={c.obrigatorio} onChange={(e) => onChange(e.target.value)} />;
    case "datahora":
      return <input type="datetime-local" className={cls} value={v ? new Date(v).toLocaleString("sv-SE").slice(0, 16) : ""} required={c.obrigatorio} onChange={(e) => onChange(e.target.value)} />;
    case "email":
      return <input type="email" className={cls} value={v} required={c.obrigatorio} onChange={(e) => onChange(e.target.value)} />;
    case "telefone":
      return <input type="tel" className={cls} value={v} required={c.obrigatorio} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input className={cls} value={v} required={c.obrigatorio} onChange={(e) => onChange(e.target.value)} />;
  }
}
