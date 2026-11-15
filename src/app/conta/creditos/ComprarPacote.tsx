"use client";
import { useRef, useState } from "react";

type Pacote = { preco: number; comprados: number; cortesia: number; meses: number; ativo: boolean };

export default function ComprarPacote({ pacote }: { pacote: Pacote }) {
  const chave = useRef("");
  const [processando, setProcessando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [url, setUrl] = useState("");
  async function comprar() {
    setProcessando(true);
    setMensagem("");
    try {
      chave.current ||= crypto.randomUUID();
      const res = await fetch("/api/ia/creditos/comprar", { method: "POST", headers: {
        "Content-Type": "application/json", "Idempotency-Key": chave.current,
      }, body: JSON.stringify(pacote) });
      const dados = await res.json();
      if (!res.ok) setMensagem(dados.error ?? "Não foi possível gerar a cobrança.");
      else if (dados.url) setUrl(dados.url);
      else if (dados.status === "paga") setMensagem("Pagamento confirmado. Atualize a página para consultar o saldo.");
      else setMensagem("Seu pedido está em processamento. Consulte novamente em instantes.");
    } catch { setMensagem("A conexão foi interrompida. Tente consultar a cobrança novamente."); }
    finally { setProcessando(false); }
  }
  const reais = (pacote.preco / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return <section className="cartao space-y-3 p-5">
    <h2 className="text-xl font-semibold">Pacote avulso</h2>
    <p>{pacote.comprados} créditos comprados + {pacote.cortesia} de cortesia por <strong>{reais}</strong>. Validade de {pacote.meses} meses a partir da confirmação do pagamento.</p>
    {!pacote.ativo ? <p>A compra avulsa está em configuração.</p>
      : url ? <a href={url} rel="noopener noreferrer" target="_blank" className="btn-ouro inline-block px-4 py-2">Abrir fatura no Asaas</a>
      : <button type="button" disabled={processando} className="btn-ouro px-4 py-2" onClick={comprar}>
        {processando ? "Consultando…" : "Gerar ou consultar cobrança de " + reais}</button>}
    <p role="status" aria-live="polite">{mensagem}</p>
  </section>;
}