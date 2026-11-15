import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Credenciar from "./Credenciar";
import type { Credencial } from "@/lib/leiloes";

export default async function CredenciaisLeilao() {
  await exigirSetor("diretoria");
  const db=supabaseAdmin();
  const [{data:parceiros},{data:credenciais}]=await Promise.all([
    db.from("partners").select("id,razao_social,registro_profissional,status,perfil:profiles(nome)").eq("tipo","leiloeiro").in("status",["ativo","aprovado"]).order("created_at",{ascending:false}).limit(500),
    db.from("leilao_credenciais").select("*"),
  ]);
  return <main className="space-y-4"><h1 className="lp-display text-3xl">Credenciamento de leiloeiros</h1>
    <p>Confira o registro profissional e a empresa antes de conceder o pacote contratado.</p>
    {(parceiros??[]).map(p=>{const c=credenciais?.find(x=>x.partner_id===p.id) as Credencial|undefined;
      const perfil=p.perfil as unknown as {nome:string}|null;
      return <Credenciar key={p.id+"-"+(c?.revisao??0)} id={p.id} nome={perfil?.nome??"Leiloeiro"} empresa={p.razao_social??""} matricula={p.registro_profissional??""} credencial={c} />;
    })}
    {!parceiros?.length&&<p>Nenhum leiloeiro com cadastro aprovado.</p>}
  </main>;
}
