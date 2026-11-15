import "server-only";
import type { Ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function cofreAprovado(titular:string,cofre:string) {
  const {data} = await supabaseAdmin().from("propriedade_claims").select("id").eq("cofre_id",cofre)
    .eq("titular_id",titular).eq("estado","APROVADA").maybeSingle();
  return !!data;
}
export async function areaPrivadaLiberada(a:Ator,id:string) {
  if(a.ehArini) return true;
  const db=supabaseAdmin();
  const {data:p}=await db.from("properties").select("owner_id,partner_id").eq("id",id).maybeSingle();
  if(!p) return false;
  if(!p.owner_id) return !!a.partnerId && p.partner_id===a.partnerId;
  if(!a.ownerId || a.ownerId!==p.owner_id) return false;
  const {data}=await db.from("propriedade_claims").select("id").eq("anuncio_id",id)
    .eq("titular_id",a.userId).eq("estado","APROVADA").maybeSingle();
  return !!data;
}

