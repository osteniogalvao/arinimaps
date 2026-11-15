import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { consentimentoDaConta } from "@/lib/privacidade/consentimento";
import { STATUS_VITRINE } from "@/lib/imovel/vitrine";
import Filtros from "./Filtros";

export const dynamic = "force-dynamic";
export default async function FiltrosConta({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const a = await ator();
  const sp = await searchParams;
  const iniciais: Record<string,string> = {};
  for (const k of ["tipo","municipio","q","area_min","area_max","preco_min","preco_max"]) {
    if (typeof sp[k] === "string") iniciais[k] = sp[k].slice(0,120);
  }
  if (!a) redirect("/entrar?cadastro=1&papel=comprador&nicho=comprador_investidor&volta="+encodeURIComponent("/conta/filtros?"+new URLSearchParams(iniciais)));
  if (a.nicho !== "comprador_investidor") return <main className="mx-auto max-w-3xl space-y-3 px-5 py-10">
    <h1 className="lp-display text-3xl">Filtros de interesse</h1><Link href="/conta/perfis" className="underline">Selecionar meu perfil de comprador ou investidor</Link>
  </main>;
  const db = supabaseAdmin();
  const [filtros, avisos, municipios, limite, consentiu] = await Promise.all([
    db.from("filtros_interesse").select("id,nome,ativo,whatsapp,tipo,preco_min,preco_max,area_min,area_max,essenciais,financiamento,permuta,municipio:municipalities(nome)")
      .eq("titular", a.userId).order("criado_em").order("id"),
    db.from("filtro_avisos").select("id,lido_em,criado_em,imovel:properties!inner(codigo,titulo,status)")
      .eq("titular",a.userId).in("imovel.status",[...STATUS_VITRINE]).order("criado_em",{ascending:false}).limit(80),
    db.from("municipalities").select("id,nome,uf").eq("ativo",true).order("nome").limit(1000),
    db.rpc("fn_filtro_limite",{p_titular:a.userId}),consentimentoDaConta(a.userId,"whatsapp"),
  ]);
  if (filtros.error || avisos.error || municipios.error || limite.error) throw new Error("Não foi possível carregar os filtros.");
  return <main className="mx-auto max-w-3xl space-y-5 px-5 py-10">
    <Link href="/conta" className="text-sm underline">Minha conta</Link><h1 className="lp-display text-4xl">Filtros de interesse</h1>
    <Filtros limite={Number(limite.data)} iniciais={iniciais} municipios={municipios.data??[]} consentiu={consentiu}
      filtros={(filtros.data??[]).map(({municipio,...f})=>({...f, municipioNome:(municipio as unknown as {nome:string}|null)?.nome??null}))}
      avisos={(avisos.data??[]).map(v=>{const p=v.imovel as unknown as {codigo:string;titulo:string};return {
        id:v.id,codigo:p.codigo,titulo:p.titulo,data:new Date(v.criado_em).toLocaleDateString("pt-BR"),lido:!!v.lido_em};})} />
  </main>;
}