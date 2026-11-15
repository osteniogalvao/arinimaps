"use client";
import { useRef,useState,type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";

type Props={registros:{id:string;tipo:string;rotulo:string}[];regioes:{id:string;nome:string}[];titulares:{user_id:string;nome:string}[]};
const valores=[["taxa_nominal_aa","Taxa nominal anual (%)"],["cet_aa","CET anual aproximado (%)"],["seguro_mensal","Seguro mensal estimado (R$)"],
  ["tarifa_inicial","Tarifa inicial estimada (R$)"],["prazo_max","Prazo máximo (meses)"],["percentual_max","Percentual máximo financiado (%)"]];
export default function FormFin({registros,regioes,titulares}:Props) {
  const [msg,setMsg]=useState(""); const [ocupado,setOcupado]=useState(false); const router=useRouter();
  const tentativa=useRef({chave:"",id:""});
  async function enviar(b:Record<string,unknown>,form?:HTMLFormElement) {
    if(ocupado) return;
    setOcupado(true);setMsg("");
    try {
      const chave=JSON.stringify(b);
      if(tentativa.current.chave!==chave) tentativa.current={chave,id:crypto.randomUUID()};
      const r=await fetch("/api/admin/financeiro/financiamento",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:tentativa.current.id,...b})});
      const j=await r.json();if(!r.ok) throw Error(j.error??"Falha ao registrar.");
      tentativa.current={chave:"",id:""};setMsg("Alteração registrada.");form?.reset();router.refresh();
    } catch(e) {setMsg(e instanceof Error?e.message:"Confira sua conexão.");} finally {setOcupado(false);}
  }
  function salvar(ev:FormEvent<HTMLFormElement>,acao:string) {
    ev.preventDefault();const form=ev.currentTarget;const f=new FormData(form);
    const b:Record<string,unknown>={...Object.fromEntries(f),acao};
    if(acao==="linha") {
      for(const [k] of valores) b[k]=Number(f.get(k));
      b.sistemas=f.getAll("sistema");b.lista_documentos=String(f.get("lista_documentos")??"").split("\n");
    } else {b.prioridade=Number(f.get("prioridade"));b.sla_minutos=Number(f.get("sla_minutos"));b.verificado=f.has("verificado");}
    void enviar(b,form);
  }
  return <div className="space-y-5">
    <section className="cartao space-y-3 p-5"><h2 className="lp-display text-xl">Linhas e vagas ativas</h2>
      {registros.map(r=><div className="flex flex-wrap items-center justify-between gap-3" key={r.id}>
        <span>{r.rotulo}</span><button type="button" className="btn-contorno p-2" disabled={ocupado}
          onClick={()=>enviar({acao:"encerrar",tipo:r.tipo,id:r.id})}>Desativar {r.tipo}</button></div>)}
      {!registros.length && <p>Nenhuma linha ou vaga cadastrada.</p>}
    </section>
    <details className="cartao p-5"><summary className="cursor-pointer font-semibold">Cadastrar versão da linha bancária</summary>
      <form onSubmit={ev=>salvar(ev,"linha")} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={ROTULO}>Banco<input name="banco" className={CAMPO} minLength={2} maxLength={100} required/></label>
        <label className={ROTULO}>Nome da linha<input name="nome" className={CAMPO} minLength={2} maxLength={160} required/></label>
        <label className={ROTULO}>Tipo do imóvel<select name="tipo" className={CAMPO}><option value="urbano">Urbano</option><option value="rural">Rural</option></select></label>
        <fieldset><legend className={ROTULO}>Amortização aceita</legend>{["SAC","PRICE"].map(s=><label key={s} className="mr-3"><input type="checkbox" name="sistema" value={s}/> {s}</label>)}</fieldset>
        {valores.map(([k,l])=><label key={k} className={ROTULO}>{l}<input className={CAMPO} name={k} type="number" required step={k==="prazo_max"?"1":"any"} min={k==="prazo_max"?1:0}/></label>)}
        <label className={ROTULO}>Vigência inicial<input name="inicio" className={CAMPO} type="date" required/></label>
        <label className={ROTULO}>Vigência final<input name="fim" className={CAMPO} type="date" required/></label>
        <label className={ROTULO}>Fonte dos parâmetros<input name="fonte" className={CAMPO} required minLength={3} maxLength={500}/></label>
        <label className={ROTULO}>Documentos sugeridos, um por linha<textarea name="lista_documentos" className={CAMPO} rows={3}/></label>
        <button className="btn-primario p-3" disabled={ocupado}>Publicar versão da linha</button>
      </form>
    </details>
    <details className="cartao p-5"><summary className="cursor-pointer font-semibold">Habilitar vaga de correspondente</summary>
      <form onSubmit={ev=>salvar(ev,"vaga")} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={ROTULO}>Banco (mesmo nome da linha)<input name="banco" className={CAMPO} minLength={2} maxLength={100} required/></label>
        <label className={ROTULO}>Região<select className={CAMPO} name="regiao_id" required defaultValue=""><option value="">Selecione</option>{regioes.map(r=><option key={r.id} value={r.id}>{r.nome}</option>)}</select></label>
        <label className={ROTULO}>Titular do perfil correspondente<select className={CAMPO} name="titular_id" required defaultValue=""><option value="">Selecione</option>{titulares.map(t=><option key={t.user_id} value={t.user_id}>{t.nome}</option>)}</select></label>
        <label className={ROTULO}>Razão social<input name="identificacao" className={CAMPO} required minLength={2} maxLength={150}/></label>
        <label className={ROTULO}>CNPJ<input name="cnpj" className={CAMPO} required maxLength={18}/></label>
        <label className={ROTULO}>Referência do contrato de correspondência verificado<input name="referencia_verificacao" className={CAMPO} required minLength={3} maxLength={240}/></label>
        <label className={ROTULO}>Prioridade<select name="prioridade" className={CAMPO}><option value="1">Primeira vaga</option><option value="2">Segunda vaga</option></select></label>
        <label className={ROTULO}>Prazo para primeiro contato (minutos corridos)<input name="sla_minutos" className={CAMPO} required type="number" min="1" max="10080"/></label>
        <label className="flex gap-2 items-start text-sm"><input type="checkbox" name="verificado" required/>Conferi o CNPJ, o responsável e o contrato da instituição para este banco e região.</label>
        <button className="btn-primario p-3" disabled={ocupado}>Habilitar correspondente</button>
      </form>
    </details>
    {msg && <p role="status">{msg}</p>}
  </div>;
}

