import { CabecalhoPagina } from "@/components/ui/Pagina";
import { exigirSetor } from "@/lib/setores-servidor";
import FilaSolicitacoes from "./FilaSolicitacoes";

export default async function SolicitacoesPlanos() {
  await exigirSetor("financeiro", "diretoria");
  return (
    <div className="mx-auto max-w-[1280px] space-y-8">
      <CabecalhoPagina eyebrow="Central · Financeiro" titulo="Solicitações de planos"
        subtitulo="Confira a seleção e o valor apresentado ao cliente. Conclua o atendimento depois de confirmar as condições com ele. A conclusão registra a análise, sem gerar cobrança nem liberar recursos." />
      <FilaSolicitacoes />
    </div>
  );
}
