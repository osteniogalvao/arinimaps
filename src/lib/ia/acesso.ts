import "server-only";
import { saldoAri } from "@/lib/ia/creditos";
import { lerConfiguracoes } from "@/lib/settings";
import { acessoDe } from "@/lib/planos-servidor";
import { iaConfigurada } from "@/lib/ia/config";
export type EstadoIa = {
  /** chave instalada e função ligada pela Diretoria */
  ligado: boolean;
  motivo?: "sem_chave" | "desligado";
  sessao: boolean;
  permitido: boolean;
  negacao?: { mensagem: string; solucao: string };
  saldo?: number | null;
};

/** O que o botão do assistente deve mostrar para esta conta (não registra tentativa). */
export async function estadoIa(userId: string | null): Promise<EstadoIa> {
  if (!iaConfigurada()) return { ligado: false, motivo: "sem_chave", sessao: !!userId, permitido: false };
  const cfg = await lerConfiguracoes();
  if (cfg.ia_chat_ativo === false) return { ligado: false, motivo: "desligado", sessao: !!userId, permitido: false };
  if (!userId) {
    return { ligado: true, sessao: false, permitido: false,
      negacao: { mensagem: "Entre na sua conta para conversar com o assistente.", solucao: "Confira os créditos disponíveis na sua conta." } };
  }
  const acesso = await acessoDe(userId);
  if (!acesso.recursos.has("chat_ia")) {
    return { ligado: true, sessao: true, permitido: false,
      negacao: { mensagem: `O assistente não está no seu plano${acesso.planNome ? ` (${acesso.planNome})` : ""}.`, solucao: "Veja os planos em /planos ou fale com a Arini." } };
  }
  if (acesso.equipe) return { ligado: true, sessao: true, permitido: true, saldo: null };
  const saldo = await saldoAri(userId, acesso.nicho);
  return { ligado: true, sessao: true, permitido: true, saldo: saldo.total };
}
