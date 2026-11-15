"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { enviarJson } from "@/lib/api/enviar";
import type { LoteLeilao, PacoteLeilao } from "@/lib/leiloes";

function dataTexto(valor:string|null){if(!valor)return "Sem data";const d=new Date(valor);return Number.isNaN(d.getTime())?valor:d.toLocaleString("pt-BR");}
export default function GestaoLote({lote:l,pacote}:{lote:LoteLeilao;pacote:PacoteLeilao}){
  const router=useRouter();const [ocupado,setOcupado]=useState(false);const [aviso,setAviso]=useState("");
  const completo=["leilao_profissional","leilao_premium"].includes(pacote);const estado=l.operacao?.estado??"agendado";
  async function enviar(acao:string,dados:Record<string,unknown>,revisao=l.operacao?.revisao??0){
    setOcupado(true);setAviso("");const r=await enviarJson("/api/leiloes","POST",{acao,imovel:l.id,dados,revisao});
    setOcupado(false);setAviso(r.ok?"Alteração registrada.":r.erro.mensagem);if(r.ok||r.erro.status===409)router.refresh();
  }
  return <section className="cartao space-y-4 p-5"><h2 className="lp-display text-xl">{l.titulo}</h2>
    <p>{l.codigo} · {l.status} · {estado.replaceAll("_"," ")}{l.comitente&&" · Comitente "+l.comitente}</p>
    <div className="flex gap-4"><Link href={"/painel/imoveis/"+l.id} className="text-verde underline">Documentos do imóvel</Link>
    <Link href="/painel/oportunidades" className="text-verde underline">{l.interessados} oportunidades encaminhadas</Link></div>
    <div className="flex flex-wrap gap-4"><a className="text-verde underline" href={"/api/leiloes/recorte?imovel="+l.id+"&formato=kml"}>Exportar recorte em KML</a>
      <a className="text-verde underline" href={"/api/leiloes/recorte?imovel="+l.id+"&formato=kmz"}>Exportar recorte em KMZ</a>
      {completo&&["publicado","em_negociacao"].includes(l.status)&&<Link className="text-verde underline" href={"/imovel/"+l.codigo+"/relatorio"}>Relatório territorial do recorte</Link>}
    </div>
    {l.documentos.length>0&&<ul>{l.documentos.map((d,i)=><li key={i}>{d.nome??d.tipo} · versão {d.versao} · {d.verificado?"conferido":"aguarda conferência"}</li>)}</ul>}
    <p>Primeira praça · {dataTexto(l.praca1)}{l.praca2&&" · Segunda praça · "+dataTexto(l.praca2)}</p>
    {estado==="agendado"&&pacote!=="leilao_teste"&&<details><summary>Atualizar agenda de praças</summary><form className="mt-3 grid gap-2" onSubmit={e=>{
      e.preventDefault();const d=new FormData(e.currentTarget);const a=String(d.get("primeira"));const b=String(d.get("segunda")||"");
      void enviar("agenda",{primeira:new Date(a).toISOString(),segunda:b?new Date(b).toISOString():null});
    }}><label>Primeira praça<input required className="input block" name="primeira" type="datetime-local"/></label>
      <label>Segunda praça<input className="input block" name="segunda" type="datetime-local"/></label><button disabled={ocupado} className="btn-contorno">Salvar agenda</button></form></details>}
    {completo&&<><h3 className="font-semibold">Habilitações</h3>{!l.candidaturas.length&&<p>Nenhuma solicitação.</p>}
      {l.candidaturas.map(c=><div className="border-t border-linha pt-2" key={c.id}><p>{c.nome} · {c.contato} · {c.estado}{c.referencia&&" · "+c.referencia}</p>
        {c.estado==="solicitada"&&estado==="agendado"&&<form className="mt-2 flex flex-wrap gap-2" onSubmit={e=>{
          e.preventDefault();const acao=(e.nativeEvent as SubmitEvent).submitter?.getAttribute("value");if(!acao)return;
          void enviar(acao,{candidatura:c.id,referencia:new FormData(e.currentTarget).get("referencia")},c.revisao);
        }}><input className="input" name="referencia" required maxLength={500} placeholder="Referência da conferência ou motivo"/>
          <button className="btn-contorno" value="habilitar" disabled={ocupado}>Habilitar</button><button className="btn-contorno" value="recusar" disabled={ocupado}>Recusar</button></form>}
      </div>)}
      {estado==="agendado"&&["publicado","em_negociacao"].includes(l.status)&&<details><summary>Registrar resultado externo</summary><form className="mt-3 grid gap-2" onSubmit={e=>{
        e.preventDefault();const d=new FormData(e.currentTarget);const acao=(e.nativeEvent as SubmitEvent).submitter?.getAttribute("value");if(!acao)return;
        if(acao==="arrematar"&&(!d.get("candidatura")||Number(d.get("valor"))<=0)){setAviso("Selecione o arrematante habilitado e informe o valor.");return;}
        void enviar(acao,Object.fromEntries(d));
      }}><label>Arrematante habilitado<select className="input block" name="candidatura"><option value="">Selecionar</option>{l.candidaturas.filter(c=>c.estado==="habilitada").map(c=><option value={c.id} key={c.id}>{c.nome}</option>)}</select></label>
        <label>Valor da arrematação em reais<input className="input block" name="valor" type="number" step="0.01" min="0.01"/></label>
        <label>Referência da ata ou do resultado<input className="input block" required name="referencia" maxLength={500}/></label>
        <div className="flex gap-2"><button value="arrematar" disabled={ocupado} className="btn-contorno">Registrar arrematação</button>
        <button value="sem_arremate" disabled={ocupado} className="btn-contorno">Encerrar sem arremate</button></div></form></details>}
      {l.operacao?.referencia_resultado&&<p>Resultado · {l.operacao.referencia_resultado}{l.operacao.valor!=null&&" · "+Number(l.operacao.valor).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</p>}
      {["arrematado","sem_arremate"].includes(estado)&&<form className="grid gap-2" onSubmit={e=>{e.preventDefault();void enviar("concluir",{referencia:new FormData(e.currentTarget).get("referencia")});}}>
        <label>Prestação de contas e encaminhamento pós-leilão<textarea className="input block" required name="referencia" maxLength={2000}/></label><button className="btn-contorno" disabled={ocupado}>Concluir pós-leilão</button></form>}
      {l.operacao?.pos_leilao&&<p>Pós-leilão · {l.operacao.pos_leilao}</p>}
    </>}
    {aviso&&<p role="status">{aviso}</p>}
  </section>;
}
