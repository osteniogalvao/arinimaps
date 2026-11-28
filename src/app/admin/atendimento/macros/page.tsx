import { acessoAtendimento } from "@/lib/atendimento-acesso";
import { SETORES_ATENDIMENTO, nomeSetor } from "@/lib/atendimento-rotulos";
import NavAtendimento from "@/components/atendimento/NavAtendimento";
import MacrosAtendimento from "@/components/atendimento/MacrosAtendimento";

export const metadata = { title: "Macros do atendimento" };

/** Macros do atendimento (0179): sequências de passos aplicadas com um clique na conversa. */
export default async function Macros() {
  const { triagem, diretoria } = await acessoAtendimento();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="lp-display text-2xl text-texto">Macros</h1>
        <p className="mt-1 max-w-3xl text-sm text-texto-2">
          Uma macro faz vários passos de uma vez na conversa aberta: responder, anotar, etiquetar, transferir, assumir ou encerrar.
          Use no botão <strong className="text-texto">Macros</strong> da conversa. Pública: a equipe toda usa; pessoal: só você.
        </p>
      </div>
      <NavAtendimento atual="macros" triagem={triagem} diretoria={diretoria} />
      <MacrosAtendimento setores={SETORES_ATENDIMENTO.map((s) => ({ id: s, nome: nomeSetor(s) }))} />
    </div>
  );
}
