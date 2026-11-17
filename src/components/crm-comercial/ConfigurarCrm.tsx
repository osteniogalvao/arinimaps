"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { CAMPO } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { enviarJson } from "@/lib/api/enviar";
import { ETAPAS, ETAPA_LABEL } from "@/lib/funil";

type Modelo = { id: string; titulo: string; canal: string; assunto: string | null; texto: string; etapa: string | null; ativo: boolean; ordem: number };
type Motivo = { id: string; nome: string; ativo: boolean };

const VAZIO = { titulo: "", canal: "whatsapp", assunto: "", texto: "", etapa: "", ativo: true, ordem: 0 };

function EditorModelo({ inicial, onPronto }: { inicial?: Modelo; onPronto: () => void }) {
  const router = useRouter();
  const [f, setF] = useState(inicial ? { ...inicial, assunto: inicial.assunto ?? "", etapa: inicial.etapa ?? "" } : VAZIO);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <form className="space-y-3 rounded-xl border border-linha bg-superficie-2/40 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setOcupado(true); setErro("");
        const r = await enviarJson("/api/admin/crm-comercial/modelos", inicial ? "PATCH" : "POST", inicial ? { ...f, id: inicial.id } : f);
        setOcupado(false);
        if (!r.ok) { setErro(r.erro.mensagem); return; }
        onPronto(); router.refresh();
      }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <input className={CAMPO_COMPACTO + " sm:col-span-3"} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Título (ex.: Primeiro contato)" maxLength={80} required aria-label="Título" />
        <select className={CAMPO_COMPACTO} value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })} aria-label="Canal">
          <option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="ambos">WhatsApp e e-mail</option>
        </select>
        <select className={CAMPO_COMPACTO} value={f.etapa} onChange={(e) => setF({ ...f, etapa: e.target.value })} aria-label="Etapa sugerida">
          <option value="">Qualquer etapa</option>
          {ETAPAS.map((e) => <option key={e} value={e}>{ETAPA_LABEL[e]}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativo</label>
        {f.canal !== "whatsapp" && <input className={CAMPO_COMPACTO + " sm:col-span-3"} value={f.assunto} onChange={(e) => setF({ ...f, assunto: e.target.value })} placeholder="Assunto do e-mail" maxLength={150} aria-label="Assunto" />}
      </div>
      <textarea className={CAMPO + " min-h-28"} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} maxLength={4000} required aria-label="Texto"
        placeholder="Olá, {{nome}}! Aqui é {{corretor}}, da ARINI…" />
      <p className="text-xs text-texto-2">Variáveis: {"{{nome}}"} (primeiro nome do cliente), {"{{imovel}}"}, {"{{codigo}}"}, {"{{corretor}}"}, {"{{oportunidade}}"}.</p>
      <div className="flex gap-3">
        <button disabled={ocupado} className="lp-btn lp-btn-verde !px-4 !py-2 text-sm disabled:opacity-50">Salvar</button>
        <button type="button" onClick={onPronto} className="text-sm text-texto-2">Cancelar</button>
        {erro && <span className="text-sm text-critico">{erro}</span>}
      </div>
    </form>
  );
}

export function Modelos({ modelos }: { modelos: Modelo[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {modelos.map((m) => editando === m.id ? (
        <EditorModelo key={m.id} inicial={m} onPronto={() => setEditando(null)} />
      ) : (
        <div key={m.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-linha p-4">
          <div className="min-w-60 flex-1">
            <p className="font-semibold text-texto">{m.titulo} {!m.ativo && <span className="text-xs text-texto-2">(inativo)</span>}</p>
            <p className="text-xs text-texto-2">{m.canal === "ambos" ? "WhatsApp e e-mail" : m.canal === "email" ? "E-mail" : "WhatsApp"}{m.etapa ? ` · ${ETAPA_LABEL[m.etapa]}` : ""}</p>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-texto-2">{m.texto.replace(/\\n/g, "\n")}</p>
          </div>
          <button type="button" onClick={() => setEditando(m.id)} className="text-sm font-semibold text-verde hover:underline">Editar</button>
          <button type="button" aria-label={`Apagar ${m.titulo}`} className="text-texto-2 hover:text-critico"
            onClick={async () => {
              if (!confirm(`Apagar o modelo “${m.titulo}”?`)) return;
              const r = await enviarJson(`/api/admin/crm-comercial/modelos?id=${m.id}`, "DELETE");
              if (r.ok) router.refresh();
            }}><Trash2 className="size-4" /></button>
        </div>
      ))}
      {editando === "novo" ? <EditorModelo onPronto={() => setEditando(null)} /> : (
        <button type="button" onClick={() => setEditando("novo")} className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline">
          <Plus className="size-4" /> Novo modelo
        </button>
      )}
    </div>
  );
}

export function Motivos({ motivos }: { motivos: Motivo[] }) {
  const router = useRouter();
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState("");
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2">
        {motivos.map((m) => (
          <li key={m.id}>
            <button type="button" title={m.ativo ? "Clique para desativar" : "Clique para reativar"}
              onClick={async () => { const r = await enviarJson("/api/admin/crm-comercial/motivos", "PATCH", { id: m.id, ativo: !m.ativo }); if (r.ok) router.refresh(); }}
              className={"rounded-full border px-3 py-1.5 text-sm " + (m.ativo ? "border-linha-forte text-texto" : "border-linha text-texto-2 line-through")}>
              {m.nome}
            </button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={async (e) => {
        e.preventDefault(); setErro("");
        const r = await enviarJson("/api/admin/crm-comercial/motivos", "POST", { nome: novo });
        if (!r.ok) { setErro(r.erro.mensagem); return; }
        setNovo(""); router.refresh();
      }}>
        <input className={CAMPO_COMPACTO + " w-72"} value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Novo motivo de perda" maxLength={80} aria-label="Novo motivo" />
        <button className="lp-btn lp-btn-verde !px-4 !py-2 text-sm">Adicionar</button>
        {erro && <span className="self-center text-sm text-critico">{erro}</span>}
      </form>
    </div>
  );
}
