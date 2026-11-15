"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { enviarJson, type ErroApi } from "@/lib/api/enviar";
import { AvisoErro } from "@/components/ui/Aviso";
import { formatBRLFinanceiro as formatBRL } from "@/lib/format";

export type Recebimento = {
  id: string; referencia: string; recebido_em: string; valor: number;
  repasse: number; repassado: number; em_conferencia: boolean; motivo_conferencia: string | null;
};

type Acao = "receber" | "ajustar_recebimento" | "baixar_repasse";
const campo = "w-full rounded border border-linha bg-transparent px-2 py-1.5";
const botao = "font-semibold text-verde underline underline-offset-2";

export default function Recebimentos({ id, recebido, captador, parcelas }: {
  id: string; recebido: number; captador: string | null; parcelas: Recebimento[];
}) {
  const router = useRouter();
  const [acao, setAcao] = useState<Acao | null>(null);
  const [parcela, setParcela] = useState<Recebimento | null>(null);
  const [erro, setErro] = useState<ErroApi | null>(null);
  const [ocupado, setOcupado] = useState(false);
  function abrir(tipo: Acao, p: Recebimento | null = null) {
    setAcao(tipo); setParcela(p); setErro(null);
  }
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    setOcupado(true); setErro(null);
    const resultado = await enviarJson("/api/admin/comissoes","POST",{
      commission_id:id, acao, recebimento_id:parcela?.id,
      referencia:parcela?.referencia ?? dados.get("referencia"),
      valor:acao === "baixar_repasse" ? Number(parcela!.repasse) : Number(dados.get("valor")),
      data:dados.get("data"), documento:dados.get("documento"),
    });
    setOcupado(false);
    if (resultado.ok) { setAcao(null); router.refresh(); } else setErro(resultado.erro);
  }
  return <details className="my-2 min-w-60 max-w-md text-left text-sm">
    <summary className="cursor-pointer font-semibold text-verde">Recebimentos e conciliação · {formatBRL(recebido)}</summary>
    <div className="space-y-3 pt-3">
      <p>O proprietário paga à ARINI Imóveis. {captador && <>O captador <strong>{captador}</strong> recebe sua parte em até cinco dias úteis de cada recebimento.</>}</p>
      {parcelas.map(p => <div key={p.id} className="border-t border-linha pt-2">
        <p className="break-all">{p.referencia} · {p.recebido_em.split("-").reverse().join("/")} · {formatBRL(p.valor)}</p>
        {p.em_conferencia && <p className="font-semibold">Conferência pendente. {p.motivo_conferencia}</p>}
        {captador && <p>Repasse devido {formatBRL(p.repasse)} · Pago {formatBRL(p.repassado)}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={botao} onClick={() => abrir("ajustar_recebimento",p)}>Conferir recebimento</button>
          {captador && !p.em_conferencia && p.repasse !== p.repassado && <button type="button" className={botao} onClick={() => abrir("baixar_repasse",p)}>
            {p.repasse > p.repassado ? "Baixar repasse" : "Registrar devolução"} de {formatBRL(Math.abs(p.repasse-p.repassado))}
          </button>}
        </div>
      </div>)}
      <button type="button" className={botao} onClick={() => abrir("receber")}>Registrar recebimento</button>
      {acao && <form key={acao+(parcela?.id ?? "")} onSubmit={enviar} className="space-y-2 border-t border-linha pt-2">
        <p className="font-semibold">{acao === "receber" ? "Nova parcela" : parcela?.referencia}</p>
        {acao === "receber" && <label className="block">Referência única da parcela<input name="referencia" className={campo} required minLength={3} maxLength={120} /></label>}
        {acao !== "baixar_repasse" && <label className="block">{acao === "receber" ? "Comissão recebida (R$)" : "Saldo desta parcela após a conferência (R$)"}
          <input type="number" name="valor" min={acao === "receber" ? "0.01" : "0"} step="0.01" className={campo} required defaultValue={parcela?.valor} /></label>}
        <label className="block">Data do movimento<input type="date" name="data" className={campo} required defaultValue={new Date().toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"})} /></label>
        <label className="block">{acao === "baixar_repasse" ? "Referência da NF ou RPA e do comprovante bancário" : "Comprovante na conta da ARINI Imóveis"}
          <input name="documento" className={campo} required minLength={3} maxLength={300} /></label>
        <div className="flex gap-3">
          <button className="btn-verde px-3 py-2" disabled={ocupado}>Registrar</button>
          <button type="button" className={botao} disabled={ocupado} onClick={() => setAcao(null)}>Cancelar</button>
        </div>
      </form>}
      {erro && <AvisoErro erro={erro} aoFechar={() => setErro(null)} />}
    </div>
  </details>;
}
