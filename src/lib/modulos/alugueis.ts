import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { registrarAcoes, registrarDepoisCriar } from "@/lib/registros-servidor";

/** Aluguéis (migration 0157): contrato gera as parcelas e muda de situação. */

const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const proximoMes = () => {
  const [a, m] = hoje().split("-").map(Number);
  return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
};

async function gerarParcelas(contrato: string) {
  const admin = supabaseAdmin();
  await admin.rpc("fn_aluguel_gerar_parcela", { p_contrato: contrato, p_competencia: hoje() });
  await admin.rpc("fn_aluguel_gerar_parcela", { p_contrato: contrato, p_competencia: proximoMes() });
}

registrarDepoisCriar("contratos-locacao", async (_ator, linha) => {
  await gerarParcelas(String(linha.id));
});

registrarAcoes("contratos-locacao", {
  async suspender({ motivo, linha }) {
    return { status: "suspenso", observacoes: [linha.observacoes, `Suspenso em ${hoje()}: ${motivo}`].filter(Boolean).join("\n") };
  },
  async reativar({ id, admin }) {
    await admin.from("contratos_locacao").update({ status: "ativo" }).eq("id", id);
    await gerarParcelas(id);
    return null;
  },
  async encerrar({ motivo, linha, id, admin }) {
    // parcelas futuras ainda não pagas deixam de existir
    await admin.from("alugueis_parcelas").update({ status: "cancelado" }).eq("contrato_id", id).eq("status", "pendente").gt("competencia", hoje());
    return { status: "encerrado", fim: linha.fim ?? hoje(), observacoes: [linha.observacoes, `Encerrado em ${hoje()}: ${motivo}`].filter(Boolean).join("\n") };
  },
});
