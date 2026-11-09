"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Trash2 } from "lucide-react";
import { enviarJson } from "@/lib/api/enviar";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import { dataBR } from "@/lib/acompanhamento/textos";

type Lembrete = { id: string; data: string; texto: string; enviado_em: string | null };

/** Lembretes simples do proprietário: o e-mail sai na data escolhida (worker). */
export default function Lembretes({ propertyId, lembretes }: { propertyId: string; lembretes: Lembrete[] }) {
  const router = useRouter();
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [data, setData] = useState("");
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro("");
    const r = await enviarJson(`/api/imoveis/${propertyId}/lembretes`, "POST", { data, texto });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro.mensagem); return; }
    setData("");
    setTexto("");
    router.refresh();
  }

  async function apagar(id: string) {
    if (!confirm("Apagar este lembrete?")) return;
    const r = await enviarJson(`/api/imoveis/${propertyId}/lembretes?lembrete=${id}`, "DELETE");
    if (!r.ok) { setErro(r.erro.mensagem); return; }
    router.refresh();
  }

  // data "AAAA-MM-DD" sem fuso: meio-dia evita voltar um dia na conversão
  const dia = (d: string) => dataBR(`${d}T12:00:00`);

  return (
    <section className="cartao p-5 md:p-7">
      <header className="mb-5 flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><BellRing className="size-5" /></span>
        <div>
          <h2 className="lp-display text-xl md:text-2xl text-texto">Lembretes</h2>
          <p className="mt-1.5 text-base text-texto-2">Anote algo para lembrar sobre o imóvel. Você recebe um e-mail na data marcada.</p>
        </div>
      </header>

      <form onSubmit={criar} className="grid gap-4 sm:grid-cols-[11rem_1fr_auto] sm:items-end">
        <label className="block">
          <span className={ROTULO}>Data</span>
          <input type="date" className={CAMPO} required min={hoje} value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <label className="block">
          <span className={ROTULO}>Lembrete</span>
          <input className={CAMPO} required maxLength={500} value={texto} placeholder="Ex.: renovar o ITR; ligar para o corretor"
            onChange={(e) => setTexto(e.target.value)} />
        </label>
        <button type="submit" disabled={ocupado} className="btn-verde px-5 py-3 text-sm disabled:opacity-50">
          {ocupado ? "Salvando…" : "Criar lembrete"}
        </button>
      </form>
      {erro && <p className="mt-3 text-sm text-critico">{erro}</p>}

      {lembretes.length > 0 && (
        <ul className="mt-5 divide-y divide-linha rounded-xl border border-linha">
          {lembretes.map((l) => (
            <li key={l.id} className="flex items-start gap-4 px-4 py-3">
              <span className="w-24 shrink-0 text-sm font-semibold tabular-nums text-texto">{dia(l.data)}</span>
              <span className="min-w-0 flex-1 text-[0.95rem] text-texto-3">{l.texto}</span>
              <span className="shrink-0 text-xs text-texto-2">{l.enviado_em ? "enviado" : "agendado"}</span>
              <button type="button" onClick={() => apagar(l.id)} aria-label="Apagar lembrete"
                className="shrink-0 text-texto-2 transition-colors hover:text-critico">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
