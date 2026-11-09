"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";

async function acao(body: unknown) {
  const r = await enviarJson("/api/admin/mensalidades", "POST", body);
  if (!r.ok) {
    // mensagem + motivo + o que fazer (envelope de src/lib/erros.ts)
    alert([r.erro.mensagem, r.erro.motivo, r.erro.solucao].filter(Boolean).join("\n\n"));
    return null;
  }
  return r.dados;
}

export default function MensalidadeAcoes() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const wrap = async (body: unknown, msg?: (d: Record<string, unknown>) => string) => {
    setOcupado(true);
    const d = await acao(body);
    setOcupado(false);
    if (d) { if (msg) alert(msg(d)); router.refresh(); }
  };
  return (
    <div className="flex gap-2.5 flex-wrap">
      <button disabled={ocupado} className="btn-verde px-4 py-2.5 text-sm disabled:opacity-50"
        onClick={() => wrap({ acao: "gerar_faturas" }, (d) => `${d.geradas === 1 ? "1 fatura gerada" : `${d.geradas} faturas geradas`} para o mês atual.`)}>
        Gerar faturas do mês
      </button>
      <button disabled={ocupado} className="btn-contorno px-4 py-2.5 text-sm !text-alerta !border-alerta/50 disabled:opacity-50"
        onClick={() => wrap({ acao: "marcar_inadimplentes" }, (d) => `${d.vencidas === 1 ? "1 fatura marcada como vencida" : `${d.vencidas} faturas marcadas como vencidas`}.`)}>
        Processar inadimplência
      </button>
    </div>
  );
}

export function FaturaAcoes({ id }: { id: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <button disabled={ocupado} className="btn-verde whitespace-nowrap px-3 py-1.5 text-xs disabled:opacity-50"
        onClick={async () => { setOcupado(true); if (await acao({ acao: "marcar_paga", invoice_id: id })) router.refresh(); setOcupado(false); }}>
        Marcar paga
      </button>
      <button disabled={ocupado} className="btn-contorno whitespace-nowrap px-3 py-1.5 text-xs disabled:opacity-50"
        onClick={async () => {
          // a aba abre AINDA no clique: window.open depois do await é barrado
          // pelo bloqueador de pop-up. Depois só navega (ou fecha, se falhar).
          const aba = window.open("about:blank", "_blank");
          setOcupado(true);
          const d = await acao({ acao: "cobrar_asaas", invoice_id: id });
          setOcupado(false);
          const url = typeof d?.url === "string" ? d.url : null;
          if (!url) { aba?.close(); return; }
          if (aba) { aba.opener = null; aba.location.href = url; }
          else window.location.href = url; // bloqueador barrou até a aba em branco: abre aqui mesmo
        }}>
        Cobrar via Asaas
      </button>
    </div>
  );
}

export function ValorMensal({ id, valor }: { id: string; valor: number }) {
  const router = useRouter();
  const [v, setV] = useState(String(valor));
  const [ocupado, setOcupado] = useState(false);
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-sm text-texto-2">R$</span>
      <input className="w-24 rounded-lg border border-linha-forte bg-superficie-2 px-2.5 py-1.5 text-sm text-texto tabular-nums focus:border-verde focus:outline-none focus:ring-2 focus:ring-verde/30" value={v}
        onChange={(e) => setV(e.target.value)} inputMode="decimal" />
      {Number(v.replace(",", ".")) !== valor && (
        <button disabled={ocupado} className="btn-verde px-2.5 py-1.5 text-xs disabled:opacity-50"
          onClick={async () => {
            setOcupado(true);
            if (await acao({ acao: "atualizar_valor", subscription_id: id, valor_mensal: Number(v.replace(",", ".")) })) router.refresh();
            setOcupado(false);
          }}>
          salvar
        </button>
      )}
    </span>
  );
}
