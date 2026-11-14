import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import Calculadora from "./Calculadora";

export default async function Insumos() {
  const a = await ator();
  if (!a) redirect("/entrar?volta=/painel/insumos");
  if (!a.acesso.recursos.has("calculadora_insumos")) return <div><h1 className="lp-display text-2xl">Calculadora de insumos</h1>
    <Link href="/planos?perfil=produtor#planos" className="lp-btn lp-btn-contorno mt-4">Consultar planos de produtor</Link></div>;
  return <><CabecalhoPagina titulo="Calculadora de insumos" subtitulo="Informe a área, a dose por hectare e o preço unitário para estimar a quantidade e o custo da aplicação." /><Calculadora /></>;
}
