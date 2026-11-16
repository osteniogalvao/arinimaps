import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { autorizarImovel } from "@/app/(public)/divulgador/acoes";
import { botaoDiv, caixaDiv } from "@/lib/divulgacao";

export default async function ConsentimentoDivulgacao({imovel}:{imovel:string}) {
  const a=await ator();if(a?.nicho!=="proprietario"||!a.ownerId)return null;
  const db=supabaseAdmin();
  const [dono,vinculo]=await Promise.all([db.from("properties").select("id").eq("id",imovel).eq("owner_id",a.ownerId).maybeSingle(),
    db.from("divulgacao_imoveis").select("autorizado,autorizante").eq("imovel",imovel).maybeSingle()]);
  if(!dono.data||vinculo.error)return null;
  const permite=vinculo.data?.autorizado && vinculo.data.autorizante===a.userId;
  return <form action={autorizarImovel} className={caixaDiv}>
    <h2 className="text-xl font-semibold">Divulgação por terceiros</h2>
    <p>{permite?"Você autorizou divulgadores credenciados a publicar material deste imóvel aprovado pela ARINI.":"Você pode autorizar divulgadores credenciados pela ARINI a usar o material aprovado deste imóvel em publicações identificadas como publicidade."}</p>
    <input type="hidden" name="imovel" value={imovel}/>
    <button className={botaoDiv} name="decisao" value={permite?"revogar":"autorizar"}>{permite?"Revogar autorização":"Autorizar divulgação deste imóvel"}</button>
  </form>;
}
