"use client";
import { useActionState } from "react";
import { indicarTestemunha } from "./indicar-testemunha";

export type Testemunha = {posicao:number; assinado_em:string|null; nome:string};
export default function Testemunhas({id,lista}:{id:string;lista:Testemunha[]}) {
  const [status,action,pendente] = useActionState(indicarTestemunha,"");
  return <details open={status ? true : undefined} className="cartao space-y-2 p-4 text-sm"><summary className="cursor-pointer">Testemunhas do contrato ({lista.filter(t=>t.assinado_em).length}/2 assinaturas)</summary>
    {lista.map(t=><p key={t.posicao}>Testemunha {t.posicao} · {t.nome} · {t.assinado_em ? "Assinou em "+new Date(t.assinado_em).toLocaleString("pt-BR") : "Aguardando assinatura"}</p>)}
    {lista.filter(t=>t.assinado_em).length<2 && <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={id}/>
      <label>Testemunha<select name="posicao" className="block border p-1">
        {[1,2].filter(i=>!lista.some(t=>t.posicao===i && t.assinado_em)).map(i=><option key={i}>{i}</option>)}
      </select></label>
      <label>E-mail cadastrado<input className="block border p-1" name="email" type="email" required maxLength={254}/></label>
      <button disabled={pendente} className="btn-contorno p-2">Indicar testemunha</button>
    </form>}
    {status && <p role="status">{status}</p>}
  </details>;
}
