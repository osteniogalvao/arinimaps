"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
const textos: Record<string,[string,string]>={
  rastro:["Histórico de navegação em imóveis","Permitir que a ARINI registre consultas, favoritos e a origem da campanha para entender o interesse nos anúncios."],
  historico_ari:["Histórico da Ari","Permitir que a ARINI guarde as perguntas e respostas para consultar a conversa depois."],
  whatsapp_assinatura:["WhatsApp da assinatura","Receber avisos sobre renovação, vencimento e confirmação de pagamento no número da conta."],
  whatsapp_recuperacao:["Lembretes de contratação no WhatsApp","Receber até duas mensagens para retomar uma contratação de plano que ficou incompleta."],
  whatsapp:["Avisos pelo WhatsApp","Permitir avisos da ARINI sobre os imóveis acompanhados no número da conta."],
};
export default function Preferencias() {
  const [escolhas,setEscolhas]=useState<Record<string,boolean>>({});
  const [mensagem,setMensagem]=useState(""); const [ocupado,setOcupado]=useState(false);
  useEffect(()=>{fetch("/api/consentimentos").then(async r=>{if(!r.ok)throw Error();setEscolhas((await r.json()).escolhas);}).catch(()=>setMensagem("Não foi possível carregar suas preferências."));},[]);
  async function alterar(finalidade:string) {
    const permitido=!escolhas[finalidade]; setOcupado(true); setMensagem("");
    try {
      const r=await fetch("/api/consentimentos",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({finalidade,permitido})});
      if(!r.ok)throw Error();setEscolhas(s=>({...s,[finalidade]:permitido}));setMensagem("Preferência registrada.");
    } catch {setMensagem("Não foi possível salvar. Tente novamente.");}finally{setOcupado(false);}
  }
  return <main className="mx-auto max-w-2xl space-y-5 px-5 py-12"><Link href="/" className="underline">Início</Link>
    <h1 className="lp-display text-4xl">Preferências de privacidade</h1>
    <p>Os cookies de acesso, sessão e limite de imóveis permitem usar a plataforma. Você decide quais usos adicionais autoriza e pode alterar a escolha a qualquer momento.</p>
    {Object.entries(escolhas).map(([f,v])=><div key={f} className="flex items-center gap-4 rounded-xl border border-linha bg-superficie p-4">
      <div className="flex-1"><h2 className="font-bold">{textos[f][0]}</h2><p className="text-sm text-texto-2">{textos[f][1]}</p></div>
      <button type="button" role="switch" aria-label={textos[f][0]} aria-checked={v} disabled={ocupado} onClick={()=>alterar(f)} className="rounded-full border border-linha px-3 py-2 text-sm font-bold">{v?"Ativado":"Desativado"}</button>
    </div>)}<p role="status">{mensagem}</p>{Object.hasOwn(escolhas,"historico_ari") && <p><Link href="/conta/historico-ari" className="text-verde underline">Consultar ou apagar meu histórico da Ari</Link></p>}<Link href="/termos/privacidade" className="text-verde underline">Política de Privacidade</Link>
  </main>;
}
