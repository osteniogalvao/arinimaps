import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { carregarEspelhoGestao, nomeAnunciante, type Empreendimento } from "@/lib/empreendimento/espelho";
import { hojeBrasilia } from "@/lib/simulador";
import EspelhoVendas from "./EspelhoVendas";

/** Corpo da página do espelho de vendas, igual no painel do anunciante e na Central. */
export default async function PaginaEspelho({ emp, base }: { emp: Empreendimento; base: "/painel" | "/admin" }) {
  const [{ unidades, geometrias, ativo }, anunciante] = await Promise.all([
    carregarEspelhoGestao(emp),
    nomeAnunciante(emp.owner_id, emp.partner_id),
  ]);
  const publico = ["publicado", "em_negociacao", "vendido"].includes(emp.status);
  return (
    <div className="space-y-6">
      <div>
        <Link href={`${base}/empreendimentos`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-texto-2 transition-colors hover:text-verde">
          <ArrowLeft className="size-4" /> Espelho de vendas
        </Link>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-sm text-texto-2">{emp.codigo}{emp.municipio ? ` · ${emp.municipio}` : ""}</p>
            <h1 className="lp-display mt-1 text-2xl text-texto text-balance md:text-[2rem]">{emp.titulo}</h1>
            {anunciante && <p className="mt-1 text-base text-texto-2">{anunciante}</p>}
          </div>
          {publico && (
            <Link href={`/imovel/${emp.codigo}/espelho`} target="_blank" className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline underline-offset-4">
              Versão pública <ExternalLink className="size-4" />
            </Link>
          )}
        </div>
      </div>
      <EspelhoVendas empreendimento={{ id: emp.id, codigo: emp.codigo, titulo: emp.titulo, municipio: emp.municipio }}
        unidades={unidades} geometrias={geometrias} ativo={ativo} base={base} hoje={hojeBrasilia()} anunciante={anunciante} />
    </div>
  );
}
