import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import SiteHeader from "@/components/SiteHeader";
import { Conteudo } from "@/components/ui/Pagina";
import { AVISO_SIMULACAO } from "@/lib/financiamento";
import Simular from "./Simular";
import Estimar from "./Estimar";

export default async function Financiamento({ params }: {params:Promise<{codigo:string}>}) {
  const {codigo} = await params;
  if (!await ator()) redirect("/entrar?volta="+encodeURIComponent(`/imovel/${codigo}/financiamento`));
  const db = supabaseAdmin();
  const {data:imovel,error} = await db.from("properties").select("codigo,titulo,tipo,valor,modalidade,aceita_financiamento").eq("codigo",codigo)
    .in("status",["publicado","em_negociacao"]).maybeSingle();
  if(error) throw Error("Não foi possível consultar o imóvel.");
  if(!imovel || (imovel.modalidade==="leilao" && !imovel.aceita_financiamento)) notFound();
  const dia=new Date().toISOString().slice(0,10);
  const {data:linhas,error:erro} = imovel.aceita_financiamento ? await db.from("fin_linhas")
    .select("id,banco,nome,prazo_max,percentual_max,sistemas,taxa_nominal_aa,cet_aa,seguro_mensal,tarifa_inicial,fonte,inicio,fim")
    .eq("tipo",imovel.tipo).eq("ativo",true).lte("inicio",dia).gte("fim",dia).order("banco").order("nome") : {data:[],error:null};
  if(erro) throw Error("Não foi possível consultar as linhas de financiamento.");
  return <><SiteHeader/><Conteudo className="max-w-3xl space-y-5 py-10">
    <Link href={`/imovel/${codigo}`} className="text-verde">Voltar à ficha</Link>
    <h1 className="lp-display text-3xl">{imovel.aceita_financiamento ? "Simular financiamento" : "Estimar parcelas da compra"}</h1><p>{imovel.titulo} · {codigo}</p>
    {linhas.length > 0 && imovel.valor>0 ? <Simular codigo={codigo} valor={imovel.valor} linhas={linhas}/> : <><Estimar valor={Number(imovel.valor)||0} aceita={Boolean(imovel.aceita_financiamento)} />{imovel.aceita_financiamento && <div className="cartao space-y-4 p-6">
      <p>Em breve. A equipe ainda precisa confirmar {imovel.valor>0 ? "uma linha de financiamento para este tipo de imóvel" : "o preço do imóvel"}.</p>
      <Link className="btn-contorno inline-block p-3" href={"/contato-perfil?perfil=comprar&oferta="+encodeURIComponent("Financiamento · "+codigo)}>Avise-me sobre o financiamento</Link>
    </div>}</>}
    <p className="text-sm text-texto-2">{AVISO_SIMULACAO}</p>
  </Conteudo></>;
}

