import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import SiteHeader from "@/components/SiteHeader";
import { Conteudo } from "@/components/ui/Pagina";
import { AVISO_SIMULACAO } from "@/lib/financiamento";
import Simular from "./Simular";

export default async function Financiamento({ params }: {params:Promise<{codigo:string}>}) {
  const {codigo} = await params;
  if (!await ator()) redirect("/entrar?volta="+encodeURIComponent(`/imovel/${codigo}/financiamento`));
  const db = supabaseAdmin();
  const {data:imovel,error} = await db.from("properties").select("codigo,titulo,tipo,valor").eq("codigo",codigo)
    .in("status",["publicado","em_negociacao"]).eq("aceita_financiamento",true).maybeSingle();
  if(error) throw Error("Não foi possível consultar o imóvel.");
  if(!imovel) notFound();
  const dia=new Date().toISOString().slice(0,10);
  const {data:linhas,error:erro} = await db.from("fin_linhas")
    .select("id,banco,nome,prazo_max,percentual_max,sistemas,taxa_nominal_aa,cet_aa,seguro_mensal,tarifa_inicial,fonte,inicio,fim")
    .eq("tipo",imovel.tipo).eq("ativo",true).lte("inicio",dia).gte("fim",dia).order("banco").order("nome");
  if(erro) throw Error("Não foi possível consultar as linhas de financiamento.");
  return <><SiteHeader/><Conteudo className="max-w-3xl space-y-5 py-10">
    <Link href={`/imovel/${codigo}`} className="text-verde">Voltar à ficha</Link>
    <h1 className="lp-display text-3xl">Simular financiamento</h1><p>{imovel.titulo} · {codigo}</p>
    {linhas.length && imovel.valor>0 ? <Simular codigo={codigo} valor={imovel.valor} linhas={linhas}/> : <div className="cartao space-y-4 p-6">
      <p>Em breve. A equipe ainda precisa confirmar {imovel.valor>0 ? "uma linha de financiamento para este tipo de imóvel" : "o preço do imóvel"}.</p>
      <Link className="btn-contorno inline-block p-3" href={"/contato-perfil?perfil=comprar&oferta="+encodeURIComponent("Financiamento · "+codigo)}>Avise-me sobre o financiamento</Link>
    </div>}
    <p className="text-sm text-texto-2">{AVISO_SIMULACAO}</p>
  </Conteudo></>;
}

