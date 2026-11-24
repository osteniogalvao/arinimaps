"use client";
import AvisoPlanoAnual from "../AvisoPlanoAnual";
import {useState} from "react";
import Pix from "./Pix";
import CartaoRenovacao from "./CartaoRenovacao";
import TrocaDePlano from "./TrocaDePlano";
import {useRouter} from "next/navigation";

export type OfertaAssinatura={id:string;nicho:string;plano:string;ciclo:string;primeira:number;recorrente:number;adicionais:number;escopo_confirmado:string;aceite:string|null;cancelado:string|null;arrependimento:boolean;
  assinatura_cartao:{final:string;situacao:string}|null;
  assinatura_reajustes:{id:string;vigencia:string;valor:number;condicoes:string;aceito_em:string|null;aplicado_em:string|null;avisado_em:string|null}[];
  faturas_cotadas:{id:string;tentativa_cartao:string|null;status:string;componente:string;inicio:string;fim:string;valor:number;link:string|null;link_estorno:string|null;operacao:string|null;nfse_assinaturas:{estado:string;numero:string|null;pdf_url:string|null;xml_url:string|null}|null}[]};
const moeda=(v:number)=>(v/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const estados:Record<string,string>={nova:"Preparando cobrança",emitindo:"Em conferência no Asaas",aberta:"Aguardando pagamento",paga:"Paga",vencida:"Vencida",cancelada:"Cancelada",estornada:"Estornada",parcial:"Estorno parcial em conferência"};
const data=(d:string)=>d.slice(0,10).split("-").reverse().join("/");
export type HistoricoTroca = {oferta:string;assinatura:string;tipo:string;status:string;novo:string;fim_ciclo:string;proporcional:number};
export default function Contratacao({s,ativo,temPlano,trocas}:{s:OfertaAssinatura;ativo:boolean;temPlano:boolean;trocas:HistoricoTroca[]}) {
 const router=useRouter();const [agora]=useState(()=>Date.now()),[aceito,setAceito]=useState(false),[ocupado,setOcupado]=useState(false),[mensagem,setMensagem]=useState("");
 const anual=s.ciclo==="anual";
 async function registrar(acao:string) {
   if(acao!=="aceitar"&&!window.confirm(acao==="arrependimento"?"Cancelar a assinatura e solicitar a devolução do pagamento?":"Encerrar a renovação ao fim do período pago?"))return;
   setOcupado(true);setMensagem("");
   try {
     const r=await fetch("/api/planos/contratacao",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao,id:s.id,aceito,ciclo:s.ciclo,primeira:s.primeira,recorrente:s.recorrente,adicionais:s.adicionais})});
     if(!r.ok) throw Error((await r.json()).error??"A operação não foi concluída.");
     setMensagem(acao==="aceitar"?"Aceite registrado. As faturas aparecem aqui.":"Solicitação registrada.");router.refresh();
   }catch(e){setMensagem(e instanceof Error?e.message:"Falha de conexão.");}finally{setOcupado(false);}
 }
 return <section className="rounded-lg border p-4 space-y-3" aria-label="Contratação">
   <h3 className="font-semibold">{trocas.some(t=>t.oferta===s.id)?"Proposta utilizada para troca":s.cancelado?"Renovação cancelada":s.aceite?"Assinatura e faturas":"Proposta liberada pela Central"}</h3>
   {s.aceite&&<p>Plano contratado · {s.plano.replaceAll("_"," ")}</p>}
   <p className="whitespace-pre-line">{s.escopo_confirmado}</p>
   <p>{s.aceite || temPlano || trocas.length
     ? (anual?moeda(s.recorrente)+" por ano":moeda(s.recorrente+s.adicionais)+" por mês")
     : anual?moeda(s.primeira)+" por ano":moeda(s.primeira+s.adicionais)+" no primeiro mês e "+moeda(s.recorrente+s.adicionais)+" por mês a partir do segundo"}{anual&&s.adicionais>0&&" + "+moeda(s.adicionais)+" de adicionais em fatura mensal separada"}</p>
   {trocas.map(t=><div key={t.oferta}><p>Troca para {t.novo.replaceAll("_"," ")} · {t.status==="aplicada"?"Aplicada":t.status==="encerrada"||s.cancelado&&s.aceite?"Encerrada":t.tipo==="downgrade"?"Agendada para "+data(t.fim_ciclo):"Aguardando pagamento de "+moeda(t.proporcional)}</p>
      {t.oferta===s.id&&<a className="underline" href={"/planos/solicitacoes?pedido="+t.assinatura}>Abrir assinatura e faturas</a>}</div>)}
   {s.aceite&&!s.cancelado&&<a className="underline" href="/planos">Escolher um plano para solicitar a troca</a>}
   {!s.aceite&&!s.cancelado&&temPlano&&<TrocaDePlano oferta={s.id}/>}
   {!s.aceite&&!s.cancelado&&!temPlano&&<><p>O Asaas emite a fatura a cada ciclo. Escolha Pix, boleto ou cartão na página de pagamento. A confirmação libera o período contratado.</p>
     {anual && <AvisoPlanoAnual />}
     <label className="flex gap-2"><input type="checkbox" checked={aceito} onChange={e=>setAceito(e.target.checked)}/>Aceito o escopo, os valores e a renovação {s.ciclo} apresentados.</label>
     <button type="button" disabled={!aceito||ocupado||!ativo} className="btn-primario px-4 py-2" onClick={()=>registrar("aceitar")}>{ativo?"Contratar e gerar fatura":"Emissão temporariamente indisponível"}</button></>}
   {s.assinatura_reajustes.filter(r=>r.avisado_em).map(r=><div className="rounded border p-3" key={r.id}>
      <h4 className="font-semibold">Condições propostas para {data(r.vigencia)}</h4><p>{moeda(r.valor)} por ciclo, além dos adicionais contratados.</p>
      <p className="whitespace-pre-line">{r.condicoes}</p>
      {r.aceito_em?<p>{r.aplicado_em?"Condições aplicadas.":"Aceite registrado."}</p>:!s.cancelado && r.vigencia>new Date(agora).toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"}) &&
        <button disabled={ocupado} className="underline" onClick={async()=>{
          setOcupado(true);setMensagem("");try {
            const res=await fetch("/api/planos/contratacao",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"aceitar_reajuste",id:r.id,valor:r.valor})});
            if(!res.ok)throw Error((await res.json()).error||"Falha ao registrar aceite.");router.refresh();setMensagem("Aceite registrado.");
          }catch(e){setMensagem(e instanceof Error?e.message:"Falha de conexão.");}finally{setOcupado(false);}
        }}>Aceitar este valor e as condições de renovação</button>}</div>)}
   {s.faturas_cotadas.slice().sort((a,b)=>b.inicio.localeCompare(a.inicio)||b.componente.localeCompare(a.componente)).map(f=><div className="border-t pt-2" key={f.id}>
     <p>{f.componente==="troca"?"Diferença da troca de plano":f.componente==="plano"?"Plano":"Adicionais mensais"} · {data(f.inicio)} · {moeda(f.valor)} · {estados[f.status]}{f.operacao?.startsWith("estorn")&&" · Estorno solicitado"}</p>
     {f.link&&!f.operacao&&["aberta","vencida"].includes(f.status)&&<a href={f.link} className="underline" rel="noreferrer" target="_blank">Abrir fatura no Asaas</a>}
     {f.link && !f.operacao && ["aberta","vencida"].includes(f.status) && <Pix id={f.id}/>}
     {f.tentativa_cartao && !f.operacao && ["aberta","vencida"].includes(f.status) && <p>Tentativa de pagamento no cartão registrada. Consulte a situação na fatura do Asaas.</p>}
     {f.link_estorno&&f.operacao&&<a href={f.link_estorno} className="underline" rel="noreferrer" target="_blank">Informar dados ao Asaas para a devolução do boleto</a>}
     {f.nfse_assinaturas?.estado==="emitida" && <p className="flex flex-wrap gap-3">
       Nota fiscal de serviço {f.nfse_assinaturas.numero}
       {f.nfse_assinaturas.pdf_url && <a href={f.nfse_assinaturas.pdf_url} target="_blank" rel="noreferrer" className="underline">Baixar PDF</a>}
       {f.nfse_assinaturas.xml_url && <a href={f.nfse_assinaturas.xml_url} target="_blank" rel="noreferrer" className="underline">Baixar XML</a>}
     </p>}
     {f.nfse_assinaturas?.estado==="cancelada" && <p>Nota fiscal cancelada.</p>}
   </div>)}
   {(ativo || s.assinatura_cartao) && <CartaoRenovacao s={s}/>}
   {s.aceite&&<div className="flex gap-4 flex-wrap">
     {!s.cancelado&&<button disabled={ocupado} className="underline" onClick={()=>registrar("cancelar")}>Cancelar renovação</button>}
     {!s.arrependimento&&agora<=Date.parse(s.aceite)+7*86400000&&<button disabled={ocupado} className="underline" onClick={()=>registrar("arrependimento")}>Solicitar cancelamento e estorno em 7 dias</button>}
     <button className="underline" onClick={()=>router.refresh()}>Atualizar faturas</button></div>}
   {mensagem&&<p role="status">{mensagem}</p>}
 </section>;
}
