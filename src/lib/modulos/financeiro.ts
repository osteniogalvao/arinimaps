import "server-only";
import { temSetor } from "@/lib/authz";
import { lerConfiguracoes, numero, texto } from "@/lib/settings";
import { concluirTarefaDoEvento } from "@/lib/central";
import {
  AsaasErro, asaasBuscarClientePorReferencia, asaasBuscarNota, asaasCancelarNota, asaasConfigurado,
  asaasCriarCliente, asaasEmitirNota, type AsaasNota,
} from "@/lib/asaas";
import { ErroRegistro, registrarAcoes, registrarAntesCriar } from "@/lib/registros-servidor";

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
  if (s === "AUTHORIZED") return "emitida";
  if (s === "CANCELED" || s === "CANCELLED") return "cancelada";
  if (s === "ERROR" || s === "CANCELLATION_DENIED") return "erro";
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

registrarAcoes("notas-fiscais", {
  async emitir({ linha }) {
    if (!asaasConfigurado()) {
      throw new ErroRegistro("O Asaas não está configurado. Emita a nota no site da prefeitura e anote o número aqui.", 503);
    }
    const cfg = await lerConfiguracoes();
    const nome = texto(cfg, "nf_servico_nome", "Intermediação de negócios imobiliários");
    const codigo = texto(cfg, "nf_servico_codigo", "");
    try {
      const ref = `tomador:${linha.tomador_doc}`;
      const cliente = (await asaasBuscarClientePorReferencia(ref))
        ?? (await asaasCriarCliente({
          name: String(linha.tomador_nome), cpfCnpj: String(linha.tomador_doc),
          email: (linha.tomador_email as string) || undefined, externalReference: ref,
        }));
      if (!cliente) throw new ErroRegistro("Não foi possível cadastrar o tomador no Asaas.");
      const nota = await asaasEmitirNota({
        customer: cliente.id, serviceDescription: String(linha.descricao), observations: String(linha.codigo ?? ""),
        value: Number(linha.valor), effectiveDate: hoje(), municipalServiceName: nome,
        municipalServiceCode: codigo || undefined, iss: numero(cfg, "nf_iss_aliquota", 2), externalReference: String(linha.id),
      });
      if (!nota) throw new ErroRegistro("O Asaas não respondeu.");
      return camposDaNota(nota);
    } catch (e) {
      if (e instanceof AsaasErro) return { status: "erro", erro: e.mensagem };
      throw e;
    }
  },
  async atualizar({ linha }) {
    if (!linha.gateway_id) throw new ErroRegistro("Esta nota ainda não foi enviada.");
    const nota = await asaasBuscarNota(String(linha.gateway_id));
    return nota ? camposDaNota(nota) : null;
  },
  async cancelar({ linha, motivo }) {
    if (linha.gateway_id && asaasConfigurado()) {
      try {
        const nota = await asaasCancelarNota(String(linha.gateway_id));
        if (nota) return { ...camposDaNota(nota), erro: motivo };
      } catch (e) {
        if (e instanceof AsaasErro) throw new ErroRegistro(e.mensagem);
        throw e;
      }
    }
    return { status: "cancelada", erro: motivo };
  },
});
