import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { temPerfilCofre } from "@/lib/cofre";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import Cofre from "./Cofre";

export default async function PaginaCofre() {
  const a = await ator();
  if (!a) redirect("/entrar?volta=%2Fpainel%2Fcofre");
  if (!temPerfilCofre(a.role,a.nicho)) redirect("/painel");
  return <div className="space-y-6">
    <CabecalhoPagina eyebrow="Área do cliente" titulo="Cofre de propriedades"
      subtitulo="Guarde os dados e documentos dos seus imóveis para consulta particular. As referências de CAR e matrícula são declaradas por você." />
    <Cofre produtor={a.nicho === "produtor_rural"} />
  </div>;
}
