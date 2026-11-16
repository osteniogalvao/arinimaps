import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const nomesEstado: Record<string,string> = {
  espera:"Na lista de interesse", analise:"Aguardando análise da Matriz",
  ativo:"Cadastro aprovado", recusado:"Cadastro recusado", suspenso:"Participação suspensa",
};

export async function situacaoPiloto(titular?: string) {
  const db = supabaseAdmin();
  const [situacao, inscricao] = await Promise.all([
    db.rpc("divulgacao_situacao"),
    titular ? db.from("divulgacao_cadastros").select("estado,motivo").eq("titular",titular).maybeSingle() : {data:null,error:null},
  ]);
  return {
    disponivel: !situacao.error && !inscricao.error, aberto: situacao.data?.aberto === true,
    temVaga: situacao.data?.tem_vaga === true, estado: inscricao.data?.estado as string | undefined,
    motivo: inscricao.data?.motivo as string | null | undefined,
  };
}
export function chamadaPiloto(p: Awaited<ReturnType<typeof situacaoPiloto>>) {
  if (!p.disponivel) return "Consultar disponibilidade";
  if (p.estado==="ativo" && p.aberto) return "Abrir painel do divulgador";
  if (p.estado && (p.estado!=="espera" || !p.temVaga)) return nomesEstado[p.estado] ?? "Acompanhar inscrição";
  return p.temVaga ? "Solicitar participação" : "Em breve · Avise-me";
}
export const campoDiv = "mt-1 block w-full rounded-lg border border-linha bg-fundo p-2 text-texto";
export const botaoDiv = "rounded-full bg-verde px-5 py-2 font-semibold text-white";
export const caixaDiv = "space-y-4 rounded-xl border border-linha bg-superficie p-5";
