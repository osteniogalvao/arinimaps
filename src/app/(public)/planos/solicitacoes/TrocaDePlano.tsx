"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Previa = { tipo: "upgrade" | "downgrade"; fim: string; valor: number; recorrente: number; adicionais: number; ciclo: string };
const moeda = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string) => iso.split("-").reverse().join("/");

export default function TrocaDePlano({ oferta }: { oferta: string }) {
  const router = useRouter();
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  async function enviar(confirmar: boolean) {
    setOcupado(true);
    setMensagem("");
    try {
      const resposta = await fetch("/api/planos/troca", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oferta, acao: confirmar ? "confirmar" : "prever", previa, aceito: confirmar }),
      });
      const retorno = await resposta.json();
      if (!resposta.ok) throw Error(retorno.error || "Não foi possível consultar a troca.");
      if (confirmar) {
        router.push("/planos/solicitacoes?pedido=" + encodeURIComponent(retorno.assinatura));
        router.refresh();
      } else setPrevia(retorno);
    } catch (e) {
      setPrevia(null);
      setMensagem(e instanceof Error ? e.message : "Falha de conexão.");
    } finally { setOcupado(false); }
  }
  return <div className="space-y-2">
    {previa && <div className="rounded border p-3">
      <p>{previa.tipo === "upgrade"
        ? previa.valor > 0 ? `Diferença de ${moeda(previa.valor)} pelos dias restantes do período. O pagamento libera o novo plano até ${data(previa.fim)}.`
          : "O novo plano fica disponível ao confirmar, sem cobrança adicional neste período."
        : `Você mantém o plano atual até ${data(previa.fim)}, quando começa o novo ciclo. Nenhum valor é cobrado agora.`}</p>
      <p>Na renovação, {moeda(previa.recorrente)} por {previa.ciclo === "anual" ? "ano" : "mês"}
        {previa.adicionais > 0 && ` e ${moeda(previa.adicionais)} por mês em adicionais`}.</p>
    </div>}
    <button className="btn-primario px-4 py-2" type="button" disabled={ocupado} onClick={() => enviar(!!previa)}>
      {previa ? "Aceitar as condições e confirmar troca" : "Ver condições para trocar meu plano"}
    </button>
    {mensagem && <p role="status">{mensagem}</p>}
  </div>;
}
