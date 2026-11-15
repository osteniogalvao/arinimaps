"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OfertaAssinatura } from "./Contratacao";

const moeda = (v: number) => (v / 100).toLocaleString("pt-BR", {style:"currency", currency:"BRL"});

export default function CartaoRenovacao({s}: {s: OfertaAssinatura}) {
  const router = useRouter();
  const [final, setFinal] = useState("");
  const [aceito, setAceito] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const cartao = s.assinatura_cartao;
  const origem = s.faturas_cotadas.find(f => f.componente === "plano" && f.status === "aberta" && !f.operacao && f.link);
  if (!s.aceite || s.cancelado || (!cartao && !origem)) return null;
  async function registrar(acao: "autorizar"|"revogar"|"conferir") {
    setOcupado(true); setMensagem("");
    try {
      const r = await fetch("/api/planos/cartao", {method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({acao,id:s.id,origem:origem?.id,plano:s.plano,ciclo:s.ciclo,recorrente:s.recorrente,adicionais:s.adicionais,final,aceito})});
      const resposta = await r.json();
      if (!r.ok) throw Error(resposta.error || "Falha ao gerenciar o cartão.");
      setMensagem(resposta.mensagem); setAceito(false); setFinal(""); router.refresh();
    } catch (e) {setMensagem(e instanceof Error ? e.message : "Falha de conexão.");}
    finally {setOcupado(false);}
  }
  const anual = s.ciclo === "anual";
  const valores = anual ? moeda(s.recorrente) + " por ano" + (s.adicionais ? " e " + moeda(s.adicionais) + " de adicionais por mês" : "") :
    moeda(s.recorrente + s.adicionais) + " por mês";
  return <section className="border-t pt-3 space-y-2" aria-label="Renovação no cartão">
    <h4 className="font-semibold">Renovação automática no cartão</h4>
    {cartao ? <>
      <p>Cartão com final {cartao.final}. {cartao.situacao === "ativo" ? "Confirmado pelo Asaas." :
        cartao.situacao === "indisponivel" ? "O Asaas não disponibilizou esse cartão para renovação. Pague pela fatura." :
        "Aguardando a confirmação do pagamento com esse cartão no Asaas."}</p>
      <div className="flex flex-wrap gap-4">
        {cartao.situacao === "aguardando" && <button type="button" className="underline" disabled={ocupado} onClick={()=>registrar("conferir")}>Conferir pagamento do cartão</button>}
        <button type="button" className="underline" disabled={ocupado} onClick={()=>registrar("revogar")}>Remover autorização</button>
      </div></> :
      <details><summary className="cursor-pointer underline">Autorizar as próximas renovações</summary>
        <div className="space-y-2 py-2">
          <p>Pague a fatura atual no Asaas com o cartão que deseja usar. A autorização vale para as próximas renovações de {valores}.</p>
          <label className="block">Últimos quatro dígitos do cartão <input className="w-20 border rounded px-2" inputMode="numeric"
            autoComplete="off" maxLength={4} value={final} onChange={e=>setFinal(e.target.value.replace(/\D/g,""))} /></label>
          <label className="flex gap-2"><input type="checkbox" checked={aceito} onChange={e=>setAceito(e.target.checked)}/>
            Sou titular deste cartão e autorizo as cobranças recorrentes pelos valores indicados.</label>
          <button type="button" className="btn-primario px-4 py-2" disabled={ocupado || !aceito || final.length !== 4} onClick={()=>registrar("autorizar")}>Autorizar cartão</button>
        </div></details>}
    {mensagem && <p role="status">{mensagem}</p>}
  </section>;
}
