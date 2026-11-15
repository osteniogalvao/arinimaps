import { lerConfiguracoes } from "@/lib/settings";
import { ator } from "@/lib/authz";
import { Calculator, Sprout } from "lucide-react";
import PainelAvaliacao from "./PainelAvaliacao";

/**
 * Cartão da ficha pública. Só aparece quando a Diretoria ligou a função
 * e o visitante entrou em sua conta.
 */
export default async function CartaoAvaliacaoPublico({ propertyId, tipo, status }: {
  propertyId: string | null | undefined; tipo: "rural" | "urbano"; status: string;
}) {
  if (!propertyId || !["publicado", "em_negociacao"].includes(status)) return null;
  const cfg = await lerConfiguracoes();
  const pre = cfg.pre_avaliacao_ativa === true;
  const apt = cfg.aptidao_ativa === true && tipo === "rural";
  if (!pre && !apt) return null;
  const a = await ator();
  if (!a) return null;

  return (
    <section className="cartao p-6 md:p-7 space-y-5">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full border border-linha-forte text-verde" aria-hidden>
          {pre ? <Calculator className="size-6" /> : <Sprout className="size-6" />}
        </span>
        <div className="min-w-0">
          <p className="lp-eyebrow text-xs">Inteligência Arini</p>
          <h2 className="lp-display mt-2 text-3xl text-texto">
            {pre ? "Pré-avaliação de valor" : "Aptidão territorial"}
          </h2>
          <p className="mt-1.5 text-base leading-relaxed text-texto-2">
            Estimativa automatizada, não substitui avaliação profissional. Mostra os dados usados e o que falta.
          </p>
        </div>
      </div>
      <PainelAvaliacao propertyId={propertyId} tipoImovel={tipo} modo="publico"
        mostrarPre={pre} mostrarAptidao={apt} podeContatar />
    </section>
  );
}
