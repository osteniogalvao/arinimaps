import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import Comparador from "./Comparador";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Calculadora from "./Calculadora";

export default async function Insumos({searchParams}:PageProps<"/painel/insumos">) {
  const a = await ator();
  if (!a) redirect("/entrar?volta=/painel/insumos");
  if (!a.acesso.recursos.has("calculadora_insumos")) return <div><h1 className="lp-display text-2xl">Calculadora de insumos</h1>
    <Link href="/planos?perfil=produtor#planos" className="lp-btn lp-btn-contorno mt-4">Consultar planos de produtor</Link></div>;
  const podeComparar=a.acesso.recursos.has("comparador_insumos");
  const sp=await searchParams;
  const busca=String(sp.busca??"").trim().slice(0,100);
  const pag=(v:unknown)=>Math.min(20000,Math.max(0,Math.trunc(Number(v??0))||0));
  const pagina=pag(sp.pg),paginaGrupos=pag(sp.lista); const db=supabaseAdmin();
  const gs=podeComparar ? await db.rpc("fn_grupos_compra",{p_titular:a.userId,p_busca:busca,p_pagina:paginaGrupos}) : null;
  const todos=(gs?.data??[]) as {grupo:string;nome:string;menor:number}[];
  const grupos=todos.slice(0,50);const selecionado=grupos.find(g=>g.grupo===sp.grupo)??grupos[0];
  const compras=selecionado ? await db.from("insumos_compras").select("documento,item,emissao,fornecedor,produto,gtin,unidade,quantidade,total")
    .eq("titular",a.userId).eq("grupo",selecionado.grupo).order("emissao",{ascending:false}).order("documento").order("item").range(pagina*100,pagina*100+100) : null;
  return <><CabecalhoPagina titulo="Calculadora de insumos" subtitulo="Informe a área, a dose por hectare e o preço unitário para estimar a quantidade e o custo da aplicação." /><Calculadora />
    {podeComparar && (gs?.error||compras?.error ? <p>Não foi possível consultar as compras agora.</p> : <Comparador compras={(compras?.data??[]).slice(0,100)}
      grupos={grupos} selecionado={selecionado?.grupo??""} busca={busca} pagina={pagina} paginaGrupos={paginaGrupos}
      maisGrupos={todos.length>50} maisItens={(compras?.data?.length??0)>100}/> )}</>;
}
