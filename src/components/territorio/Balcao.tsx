"use client";
import { useState, type FormEvent } from "react";
import { CAMPO } from "@/components/ui/Pagina";
import { estadoProtocolo, type PedidoMunicipal, type ServicoMunicipal } from "@/lib/territorio-contratado";
import { useOperacao } from "./useOperacao";

function AnexarProjeto() {
  return <label className="block">Projeto ou documento complementar (opcional)
    <input type="file" name="arquivo" accept=".pdf,.dwg,.dxf,.kml,.kmz,.zip,.doc,.docx,.xls,.xlsx,.odt,.ods,.jpg,.jpeg,.png,.heic,.webp,.gif" className={CAMPO}/>
    <span className="text-sm text-texto-2">Envie um documento, imagem ou arquivo de projeto de até 25 MB.</span></label>;
}
function arquivoDoFormulario(form:FormData) {
  const arquivo=form.get("arquivo");
  return arquivo instanceof File && arquivo.name ? arquivo : undefined;
}
export default function Balcao({servicos,pedidos,interno=false,gestor=false}:{servicos:ServicoMunicipal[];pedidos:PedidoMunicipal[];interno?:boolean;gestor?:boolean}) {
  const {enviar,ocupado,mensagem}=useOperacao();
  const [escolhido,setEscolhido]=useState("");
  const servico=servicos.find(s=>s.id===escolhido);
  async function protocolar(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!servico) return;
    const form=e.currentTarget;
    const f=new FormData(form);
    const dados=Object.fromEntries(servico.requisitos.map((r,i)=>[r,String(f.get("req"+i)??"").trim()]));
    if (await enviar({acao:"protocolar",regra:servico.id,dados},"Pedido recebido.",arquivoDoFormulario(f))) form.reset();
  }
  async function regra(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();const f=new FormData(e.currentTarget);
    const requisitos=String(f.get("requisitos")).split("\n").map(x=>x.trim()).filter(Boolean);
    await enviar({acao:"regra",anterior:servico?.id??null,nome:servico?.nome??f.get("nome"),orientacao:f.get("orientacao"),requisitos},"Regra municipal publicada.");
  }
  async function andamento(e:FormEvent<HTMLFormElement>,p:PedidoMunicipal) {
    e.preventDefault();const form=e.currentTarget;const f=new FormData(form);
    if (await enviar({acao:"andamento",id:p.id,revisao:p.revisao,etapa:interno?f.get("etapa"):"resposta",texto:f.get("texto")},"Andamento registrado.",arquivoDoFormulario(f))) form.reset();
  }
  return <div className="space-y-7">
    <p role="status" aria-live="polite" className="font-semibold text-verde">{mensagem}</p>
    {(!interno || gestor) && <section className="cartao space-y-3 p-5">
      <h2 className="text-xl font-semibold">{interno ? "Regras dos serviços municipais" : "Abrir protocolo"}</h2>
      {!interno && !servicos.length ? <p>Nenhum serviço municipal está recebendo pedidos no momento.</p> : <label className="block">Serviço
        <select value={escolhido} onChange={e=>setEscolhido(e.target.value)} className={CAMPO}><option value="">{interno?"Criar serviço":"Selecione"}</option>
          {servicos.map(s=><option key={s.id} value={s.id}>{s.municipio} · {s.nome} (v{s.versao})</option>)}</select></label>}
      {interno && gestor ? <form key={escolhido} onSubmit={regra} className="space-y-3">
        <label className="block">Nome do serviço<input name="nome" defaultValue={servico?.nome} required minLength={3} maxLength={100} readOnly={!!servico} className={CAMPO}/></label>
        <label className="block">Orientações do município<textarea name="orientacao" defaultValue={servico?.orientacao} required minLength={5} maxLength={2500} className={CAMPO}/></label>
        <label className="block">Requisitos para o pedido (um por linha)<textarea name="requisitos" defaultValue={servico?.requisitos.join("\n")} required rows={4} className={CAMPO}/></label>
        <button disabled={ocupado} className="btn-verde px-4 py-2">{servico?"Publicar nova versão":"Publicar serviço"}</button>
      </form> : !interno && servico && <form key={servico.id} onSubmit={protocolar} className="space-y-4">
        <p><strong>{servico.territorio}</strong></p><p className="whitespace-pre-wrap">{servico.orientacao}</p>
        {servico.requisitos.map((r,i)=><label key={r} className="block">{r}<textarea className={CAMPO} name={"req"+i} required maxLength={2000}/></label>)}
        <AnexarProjeto/>
        <button className="btn-verde px-4 py-2" disabled={ocupado}>Protocolar pedido</button>
      </form>}
    </section>}
    <section className="space-y-3"><h2 className="text-xl font-semibold">{interno?"Protocolos do município":"Meus protocolos"}</h2>
      {!pedidos.length && <p>Nenhum protocolo registrado.</p>}
      {pedidos.map(p=><details key={p.id} className="cartao p-4"><summary className="cursor-pointer font-semibold">
        Nº {p.numero} · {p.servico} · {estadoProtocolo[p.estado]}</summary>
        <div className="mt-3 space-y-3"><p>{p.municipio} · Regra v{p.versao} · {new Date(p.data).toLocaleDateString("pt-BR")}</p>
          <dl>{Object.entries(p.dados).map(([k,v])=><div key={k} className="mb-2"><dt className="font-semibold">{k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>)}</dl>
          <ol className="space-y-2 border-l border-linha pl-4">{p.andamentos.map((v,i)=><li key={i}>
            <strong>{estadoProtocolo[v.acao]}</strong> · {new Date(v.data).toLocaleString("pt-BR")}<p className="whitespace-pre-wrap">{v.texto}</p>
            {v.arquivo && <a className="break-all text-sm underline" href={"/api/territorio/anexos?id="+encodeURIComponent(v.arquivo.id)}>Baixar {v.arquivo.nome} ({Math.ceil(v.arquivo.tamanho/1024)} KB)</a>}
          </li>)}</ol>
          {((!interno && p.estado==="pendencia") || (interno && !p.proprio && ["protocolado","em_analise"].includes(p.estado))) &&
            <form className="space-y-2" onSubmit={e=>andamento(e,p)}>
              {interno && <label>Andamento<select name="etapa" className={CAMPO}>
                {(p.estado==="protocolado"?["em_analise","pendencia"]:["pendencia"]).concat(gestor?["deferido","indeferido"]:[]).map(x=><option key={x} value={x}>{estadoProtocolo[x]}</option>)}</select></label>}
              <label className="block">{interno?"Justificativa para o solicitante":"Resposta à pendência"}<textarea required maxLength={2000} name="texto" className={CAMPO}/></label>
              {!interno && <AnexarProjeto/>}
              <button className="btn-verde px-4 py-2" disabled={ocupado}>{interno?"Registrar andamento":"Enviar resposta"}</button>
            </form>}
        </div></details>)}
    </section></div>;
}
