"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { Etiqueta } from "@/components/ui/Pagina";

export type Observacao = { id: string; setor: string; texto: string; created_at: string; autor: string };
const PLACA: Record<string, string> = { nao_colocada: "Não colocada", colocada: "Colocada", retirada: "Retirada" };
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/**
 * Captador, placa e observações por setor na ficha do imóvel (como no CRM da
 * Arini Negócios: cada setor deixa a sua anotação e todos veem o histórico).
 */
export default function FichaSetores({ id, captador, placa, equipe, observacoes, meusSetores, nomesSetor, editaCaptacao, semMigration }: {
  id: string; captador: string | null; placa: string; equipe: { user_id: string; nome: string }[];
  observacoes: Observacao[]; meusSetores: string[]; nomesSetor: Record<string, string>;
  editaCaptacao: boolean; semMigration: boolean;
}) {
  const router = useRouter();
  const [cap, setCap] = useState(captador ?? "");
  const [pl, setPl] = useState(placa);
  const [setor, setSetor] = useState(meusSetores[0] ?? "");
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");

  async function enviar(corpo: Record<string, unknown>, ok: string) {
    setOcupado(true); setErro(""); setMsg("");
    const r = await enviarJson("/api/admin/imoveis/ficha", "POST", { id, ...corpo });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro.mensagem); return false; }
    setMsg(ok); router.refresh(); return true;
  }

  if (semMigration) {
    return <p className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm font-semibold text-alerta">Falta rodar a migration 0176 no Supabase para usar captador, placa e observações dos setores.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-52 flex-1"><span className="mb-1 block text-sm font-semibold text-texto">Captador</span>
          <select className={CAMPO_COMPACTO + " w-full"} value={cap} disabled={!editaCaptacao} onChange={(e) => setCap(e.target.value)}>
            <option value="">Sem captador</option>
            {equipe.map((p) => <option key={p.user_id} value={p.user_id}>{p.nome}</option>)}
          </select></label>
        <label className="block min-w-40"><span className="mb-1 block text-sm font-semibold text-texto">Placa no imóvel</span>
          <select className={CAMPO_COMPACTO + " w-full"} value={pl} disabled={!editaCaptacao} onChange={(e) => setPl(e.target.value)}>
            {Object.entries(PLACA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        {editaCaptacao && (
          <button type="button" disabled={ocupado || (cap === (captador ?? "") && pl === placa)} className="btn-verde px-4 py-2 text-sm disabled:opacity-50"
            onClick={() => enviar({ acao: "captacao", captador_user_id: cap || null, placa_status: pl }, "Captação salva.")}>
            Salvar
          </button>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-texto">Observações dos setores</p>
        {!observacoes.length && <p className="text-sm text-texto-2">Nenhuma observação ainda.</p>}
        <ul className="space-y-2">
          {observacoes.map((o) => (
            <li key={o.id} className="rounded-xl border border-linha bg-superficie-2/50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                <Etiqueta tom="verde">{nomesSetor[o.setor] ?? o.setor}</Etiqueta>
                <span className="font-semibold text-texto">{o.autor}</span>
                <span>{quando(o.created_at)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[0.95rem] text-texto">{o.texto}</p>
            </li>
          ))}
        </ul>
        {meusSetores.length > 0 && (
          <div className="space-y-2">
            <textarea className={CAMPO_COMPACTO + " w-full min-h-20"} maxLength={2000} value={texto} placeholder="Escreva uma observação para os outros setores"
              aria-label="Nova observação" onChange={(e) => setTexto(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              {meusSetores.length > 1 && (
                <select aria-label="Setor que assina" className={CAMPO_COMPACTO} value={setor} onChange={(e) => setSetor(e.target.value)}>
                  {meusSetores.map((s) => <option key={s} value={s}>{nomesSetor[s] ?? s}</option>)}
                </select>
              )}
              <button type="button" disabled={ocupado || !texto.trim()} className="btn-ouro px-4 py-2 text-sm disabled:opacity-50"
                onClick={async () => { if (await enviar({ acao: "observacao", setor, texto }, "Observação registrada.")) setTexto(""); }}>
                Registrar observação
              </button>
            </div>
          </div>
        )}
      </div>
      {erro && <p role="alert" className="text-sm font-semibold text-critico">{erro}</p>}
      {msg && <p className="text-sm font-semibold text-verde">{msg}</p>}
    </div>
  );
}
