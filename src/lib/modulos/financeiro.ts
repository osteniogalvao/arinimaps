import "server-only";
import { temSetor } from "@/lib/authz";
import { lerConfiguracoes, numero, texto } from "@/lib/settings";
import { concluirTarefaDoEvento } from "@/lib/central";
import {
  AsaasErro, asaasBuscarClientePorReferencia, asaasBuscarNota, asaasCancelarNota, asaasConfigurado,
  asaasCriarCliente, asaasEmitirNota, asaasNotasPorReferencia, type AsaasNota,
} from "@/lib/asaas";
import { ErroRegistro, registrarAcoes, registrarAntesCriar, type ContextoAcao } from "@/lib/registros-servidor";

/** Financeiro central e central fiscal (migration 0066). */

const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

registrarAcoes("despesas", {
  async aprovar({ ator, linha }) {
    const alcada = numero(await lerConfiguracoes(), "despesa_alcada_diretoria", 5000);
    const diretoria = temSetor(ator, "diretoria");
    if (Number(linha.valor) > alcada && !diretoria) {
      throw new ErroRegistro(`Acima de R$ ${alcada.toLocaleString("pt-BR")} só a Diretoria aprova.`, 403);
    }
    if (linha.solicitante === ator.userId && !diretoria) {
      throw new ErroRegistro("Quem pediu a despesa não pode aprovar a própria despesa.", 403);
    }
    await concluirTarefaDoEvento(`despesa_aprovacao:${linha.id}`, ator.userId, "Despesa aprovada");
    return { status: "aprovada", aprovado_por: ator.userId, aprovado_em: new Date().toISOString(), motivo: null };
  },
  async reprovar({ ator, linha, motivo }) {
    if (!temSetor(ator, "diretoria") && linha.solicitante === ator.userId) {
      throw new ErroRegistro("Quem pediu a despesa não pode reprová-la; cancele.", 403);
    }
    await concluirTarefaDoEvento(`despesa_aprovacao:${linha.id}`, ator.userId, `Despesa reprovada: ${motivo}`);
    return { status: "reprovada", aprovado_por: ator.userId, aprovado_em: new Date().toISOString(), motivo };
  },
  async pagar({ ator, linha }) {
    await concluirTarefaDoEvento(`despesa_vencida:${linha.id}`, ator.userId, "Despesa paga");
    return { status: "paga", pago_em: hoje() };
  },
  async cancelar({ motivo }) {
    return { status: "cancelada", motivo };
  },
});

registrarAntesCriar("despesas", async (ator, linha) => {
  linha.status = "pendente";
  linha.solicitante = ator.userId;
});

registrarAcoes("lancamentos", {
  async estornar({ linha }) {
    if (linha.estornado) throw new ErroRegistro("Este lançamento já foi estornado.");
    return { estornado: true };
  },
});

registrarAntesCriar("lancamentos", async (ator, linha) => {
  linha.origem = "manual";
  linha.criado_por = ator.userId;
});

registrarAntesCriar("notas-fiscais", async (ator, linha) => {
  const doc = String(linha.tomador_doc ?? "").replace(/\D/g, "");
  if (doc.length !== 11 && doc.length !== 14) throw new ErroRegistro("CPF ou CNPJ do tomador inválido.");
  linha.tomador_doc = doc;
  linha.status = "rascunho";
  linha.criado_por = ator.userId;
});

function situacaoNota(n: AsaasNota) {
  const s = n.status?.toUpperCase();
  if (s === "AUTHORIZED" || s === "CANCELLATION_DENIED") return "emitida";
  if (s === "CANCELED" || s === "CANCELLED") return "cancelada";
  if (s === "ERROR") return "erro";
  return "enviada";
}

export function camposDaNota(n: AsaasNota) {
  const status = situacaoNota(n);
  return {
    status, gateway_id: n.id, numero: n.number ?? null, pdf_url: n.pdfUrl ?? null, xml_url: n.xmlUrl ?? null,
    erro: status === "erro" ? (n.statusDescription ?? "A prefeitura recusou a nota.") : null,
    ...(status === "emitida" ? { emitida_em: new Date().toISOString() } : {}),
  };
}

function permitirConciliacao(linha: Record<string, unknown>) {
  // Um processo interrompido pode ter deixado a reserva sem resposta. Esperar as
  // chamadas que ainda podem estar em curso antes de permitir a conferência manual.
  if (linha.status === "emitindo" && Date.now() - Date.parse(String(linha.updated_at)) < 5 * 60_000) {
    throw new ErroRegistro("A emissão está em andamento. Aguarde cinco minutos e atualize a página.", 409);
  }
}

async function emitirNota({ admin, id, linha }: ContextoAcao) {
  if (!asaasConfigurado()) {
    throw new ErroRegistro("O Asaas não está configurado para emissão.", 503);
  }
  const cfg = await lerConfiguracoes();
  const nome = texto(cfg, "nf_servico_nome", "Intermediação de negócios imobiliários");
  const codigo = texto(cfg, "nf_servico_codigo", "");
  const { data: reserva, error } = await admin.from("notas_fiscais")
    .update({ status: "emitindo", erro: null }).eq("id", id).eq("status", "rascunho")
    .is("gateway_id", null).eq("updated_at", linha.updated_at).select("updated_at").maybeSingle();
  if (error) throw new ErroRegistro("Não foi possível reservar a emissão.", 503);
  if (!reserva) throw new ErroRegistro("A nota foi alterada ou sua emissão já começou. Atualize a página.", 409);
  let envioIniciado = false;
  let campos: Record<string, unknown>;
  try {
    const ref = `tomador:${linha.tomador_doc}`;
    const cliente = (await asaasBuscarClientePorReferencia(ref))
      ?? (await asaasCriarCliente({
        name: String(linha.tomador_nome), cpfCnpj: String(linha.tomador_doc),
        email: (linha.tomador_email as string) || undefined, externalReference: ref,
      }));
    if (!cliente) throw new ErroRegistro("Não foi possível cadastrar o tomador no Asaas.");
    envioIniciado = true;
    const nota = await asaasEmitirNota({
      customer: cliente.id, serviceDescription: String(linha.descricao), observations: String(linha.codigo ?? ""),
      value: Number(linha.valor), effectiveDate: hoje(), municipalServiceName: nome,
      municipalServiceCode: codigo || undefined, iss: numero(cfg, "nf_iss_aliquota", 2), externalReference: String(linha.id),
    });
    if (!nota?.id) throw new ErroRegistro("O Asaas não confirmou o ID da nota.");
    campos = camposDaNota(nota);
  } catch (e) {
    const detalhe = e instanceof AsaasErro || e instanceof ErroRegistro ? e.mensagem : "Falha de comunicação com o Asaas.";
    campos = envioIniciado
      ? { status: "conferir", erro: detalhe + " Confira a emissão no Asaas antes de tentar novamente." }
      : { status: "rascunho", erro: detalhe };
  }
  const { data, error: falha } = await admin.from("notas_fiscais").update(campos)
    .eq("id", id).eq("status", "emitindo").eq("updated_at", reserva.updated_at).select("id").maybeSingle();
  if (!falha && !data) {
    // O webhook autenticado pode ter confirmado esta mesma nota antes da resposta.
    const { data: atual } = await admin.from("notas_fiscais").select("gateway_id").eq("id", id).maybeSingle();
    if (atual?.gateway_id && (!campos.gateway_id || atual.gateway_id === campos.gateway_id)) return null;
  }
  if (falha || !data) throw new ErroRegistro("Não foi possível confirmar o resultado localmente. Atualize a situação e confira a nota no Asaas.", 409);
  return null;
}

registrarAcoes("notas-fiscais", {
  emitir: emitirNota,
  async vincular({ linha, motivo }) {
    permitirConciliacao(linha);
    const nota = await asaasBuscarNota(motivo.trim());
    if (!nota || nota.externalReference !== linha.id) throw new ErroRegistro("O ID indicado não corresponde à referência desta nota no Asaas.");
    return camposDaNota(nota);
  },
  async confirmar_ausencia({ linha, motivo }) {
    permitirConciliacao(linha);
    const correspondentes = await asaasNotasPorReferencia(String(linha.id));
    if (correspondentes.length) {
      throw new ErroRegistro("O Asaas já tem uma nota com esta referência. Confira e vincule o ID antes de continuar.", 409);
    }
    return { status: "rascunho", erro: "Ausência confirmada no Asaas: " + motivo };
  },
  async atualizar({ linha }) {
    if (!linha.gateway_id) throw new ErroRegistro("Esta nota ainda não foi enviada.");
    const nota = await asaasBuscarNota(String(linha.gateway_id));
    return nota ? camposDaNota(nota) : null;
  },
  async cancelar({ linha, motivo }) {
    if (linha.gateway_id) {
      if (!asaasConfigurado()) throw new ErroRegistro("O Asaas não está configurado para confirmar o cancelamento.", 503);
      try {
        const nota = await asaasCancelarNota(String(linha.gateway_id));
        if (nota) return { ...camposDaNota(nota), erro: motivo };
        throw new ErroRegistro("O Asaas não confirmou o cancelamento.", 503);
      } catch (e) {
        if (e instanceof AsaasErro) throw new ErroRegistro(e.mensagem);
        throw e;
      }
    }
    return { status: "cancelada", erro: motivo };
  },
});
