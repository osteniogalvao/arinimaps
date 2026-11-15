import "server-only";
import { AsaasErro, chamarAsaasFiscal, tomadorDaCobranca, type AsaasNota } from "@/lib/asaas";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CNPJ_IMOVEIS, estadoFiscal, faturaDaReferencia, parametrosFiscais, referenciaFiscal } from "@/lib/nfse-regras";

type Fatura = { fatura: string; estado: string; gateway_id: string | null; pagamento: string; cliente: string;
  plano: string; componente: string; valor: number; inicio: string };
type ClienteFiscal = { id: string; cpfCnpj: string; deleted?: boolean; externalReference?: string };
type Lista<T> = { data: T[] };
type Nota = AsaasNota & { customer: string; value: number; payment?: string | null };
type Identidade = Pick<Fatura, "fatura" | "pagamento" | "cliente" | "valor">;
const documento = (valor: string) => String(valor ?? "").replace(/\D/g, "");
const rejeicao = (erro: unknown) => erro instanceof AsaasErro && [400,401,403,422].includes(erro.status);

async function conferirEmitente(cnpj: string) {
  const conta = await chamarAsaasFiscal<{cpfCnpj: string}>("/myAccount/commercialInfo", {}, cnpj === CNPJ_IMOVEIS);
  if (documento(conta.cpfCnpj) !== cnpj) throw Error("O CNPJ da conta Asaas diverge do emitente definido pela contabilidade.");
}

// Um ID de cliente só vale dentro da conta que o criou. A conta da Tecnologia
// recebe nome, documento e endereço do mesmo tomador usado na cobrança.
async function clienteFiscal(origem: string) {
  const db = supabaseAdmin();
  const { data: vinculo, error } = await db.from("nfse_tomadores").select("cliente_fiscal").eq("cliente_cobranca", origem).maybeSingle();
  if (error) throw Error("Falha ao consultar o tomador fiscal.");
  const pagador = await tomadorDaCobranca(origem);
  const cpfCnpj = documento(pagador.cpfCnpj);
  if (pagador.id !== origem || ![11,14].includes(cpfCnpj.length) || !pagador.name) throw Error("Complete os dados fiscais do tomador da cobrança.");
  const ref = "arini_cobranca_" + origem;
  let cliente: ClienteFiscal | undefined;
  if (vinculo?.cliente_fiscal) {
    cliente = await chamarAsaasFiscal<ClienteFiscal>("/customers/" + encodeURIComponent(vinculo.cliente_fiscal));
  } else {
    const lista = await chamarAsaasFiscal<Lista<ClienteFiscal>>("/customers?limit=2&externalReference=" + encodeURIComponent(ref));
    if (lista.data.length > 1) throw Error("Mais de um cadastro fiscal corresponde ao cliente da cobrança.");
    cliente = lista.data[0];
  }
  if (!cliente) {
    const reserva = await db.from("nfse_tomadores").insert({ cliente_cobranca: origem });
    if (reserva.error) throw Error("O cadastro fiscal do tomador aguarda conciliação.");
    try {
      const { name, email, address, addressNumber, complement, province, postalCode } = pagador;
      cliente = await chamarAsaasFiscal<ClienteFiscal>("/customers", { method: "POST", body: {
        name, cpfCnpj, email, address, addressNumber, complement, province, postalCode,
        externalReference: ref, notificationDisabled: true,
      } });
    } catch (e) {
      if (rejeicao(e)) await db.from("nfse_tomadores").delete().eq("cliente_cobranca", origem).is("cliente_fiscal", null);
      throw e;
    }
  }
  if (!cliente.id || cliente.deleted || documento(cliente.cpfCnpj) !== cpfCnpj || cliente.externalReference !== ref) {
    throw Error("Dados divergentes no cadastro de tomador da Tecnologia.");
  }
  if (!vinculo?.cliente_fiscal) {
    const { error: gravacao } = await db.from("nfse_tomadores").upsert({ cliente_cobranca: origem, cliente_fiscal: cliente.id });
    if (gravacao) throw Error("Falha ao vincular o tomador fiscal.");
  }
  return cliente.id;
}

function linkDocumento(valor?: string | null) {
  try { const u = new URL(valor ?? ""); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}

async function salvarNota(f: Identidade, emitente: string, nota: Nota) {
  const estado = estadoFiscal(nota.status);
  // Todos os chamadores já limitaram a busca por referência exata ou ID persistido,
  // ou receberam a resposta direta ao próprio POST. Alguns retornos omitem a referência.
  if (!estado || !nota.id || (nota.externalReference != null && faturaDaReferencia(nota.externalReference) !== f.fatura) ||
      !Number.isFinite(nota.value) || Math.round(nota.value*100) !== f.valor) throw Error("Nota fiscal com referência, valor ou situação divergente.");
  const db = supabaseAdmin();
  let cliente = f.cliente;
  if (emitente === CNPJ_IMOVEIS) {
    if (nota.payment !== f.pagamento) throw Error("A nota retornada pertence a outra cobrança.");
  } else {
    const vinculo = await db.from("nfse_tomadores").select("cliente_fiscal").eq("cliente_cobranca", f.cliente).maybeSingle();
    if (vinculo.error || !vinculo.data?.cliente_fiscal) throw Error("Confirme o vínculo do tomador com a conta fiscal.");
    cliente = vinculo.data.cliente_fiscal;
  }
  if (nota.customer !== cliente) throw Error("A nota retornada pertence a outro tomador.");
  const { data, error } = await db.rpc("nfse_assinatura_confirmar", {
    p_fatura: f.fatura, p_emitente: emitente, p_id: nota.id, p_estado: estado, p_numero: nota.number == null ? null : String(nota.number),
    p_pdf: linkDocumento(nota.pdfUrl), p_xml: linkDocumento(nota.xmlUrl),
    p_mensagem: ["ERROR","CANCELLATION_DENIED"].includes(nota.status) ? (nota.statusDescription ?? nota.status).slice(0, 350) : null,
  });
  if (error) throw Error("Falha ao conciliar a nota fiscal de assinatura.");
  if (!data) {
    const atual = await db.from("nfse_assinaturas").select("emitente,gateway_id").eq("fatura", f.fatura).single();
    if (atual.error || atual.data?.gateway_id !== nota.id || atual.data?.emitente !== emitente) throw Error("Nota já vinculada a outro emitente ou documento.");
  }
}

export async function eventoFiscalAssinatura(fatura: string | null, id: string, emitente: string) {
  const consulta = supabaseAdmin().from("nfse_assinaturas")
    .select("fatura,gateway_id,emitente,faturas_cotadas!inner(valor,pagamento,assinaturas_cotadas!inner(cliente))").eq("emitente",emitente);
  const { data, error } = await (fatura ? consulta.eq("fatura", fatura) : consulta.eq("gateway_id", id)).maybeSingle();
  if (error) throw Error("Falha ao localizar a nota fiscal.");
  if (!data || (data.gateway_id && data.gateway_id !== id)) return false;
  const f = data.faturas_cotadas as unknown as {valor: number; pagamento: string; assinaturas_cotadas: {cliente: string}};
  await conferirEmitente(emitente);
  const nota = await chamarAsaasFiscal<Nota>("/invoices/" + encodeURIComponent(id), {}, emitente === CNPJ_IMOVEIS);
  if (nota.id !== id || (!data.gateway_id && faturaDaReferencia(nota.externalReference) !== data.fatura)) throw Error("Identificação fiscal divergente.");
  await salvarNota({ fatura: data.fatura, valor: f.valor, cliente: f.assinaturas_cotadas.cliente, pagamento: f.pagamento }, emitente, nota);
  return true;
}

async function processar(f: Fatura, p: ReturnType<typeof parametrosFiscais>) {
  const recebedora = p.emitente === CNPJ_IMOVEIS;
  if (f.gateway_id) {
    const nota = await chamarAsaasFiscal<Nota>("/invoices/" + encodeURIComponent(f.gateway_id), {}, recebedora);
    if (nota.id !== f.gateway_id) throw Error("ID fiscal divergente.");
    return salvarNota(f, p.emitente, nota);
  }
  const ref = referenciaFiscal(f.fatura);
  const encontrados = await chamarAsaasFiscal<Lista<Nota>>("/invoices?limit=2&externalReference=" + encodeURIComponent(ref), {}, recebedora);
  if (encontrados.data.length > 1) throw Error("Mais de uma nota com a mesma referência. Confira no Asaas.");
  if (encontrados.data.length) return salvarNota(f, p.emitente, encontrados.data[0]);
  if (f.estado === "consultar") throw Error("Envio sem confirmação. Confira a referência na conta fiscal antes de regularizar.");

  const origem = recebedora ? { payment: f.pagamento } : { customer: await clienteFiscal(f.cliente) };
  if (p.servico.deductions > f.valor / 100) throw Error("As deduções configuradas superam o valor da cobrança.");
  const db = supabaseAdmin();
  const { data: ganhou, error } = await db.rpc("nfse_assinatura_reservar_post", {
    p_fatura: f.fatura, p_desde: p.desde, p_apos_pagamento: p.aposPagamento, p_emitente: p.emitente,
  });
  if (error) throw Error("Falha ao reservar a emissão fiscal.");
  if (!ganhou) return;
  let nota: Nota;
  try {
    nota = await chamarAsaasFiscal<Nota>("/invoices", { method: "POST", body: {
      ...p.servico, ...origem, externalReference: ref, value: f.valor / 100,
      effectiveDate: new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
      serviceDescription: "Assinatura ARINI · " + f.plano + " · " + f.componente + " · " + f.inicio,
      observations: "Cobrança da assinatura " + f.fatura,
    } }, recebedora);
  } catch (e) {
    if (rejeicao(e)) await db.from("nfse_assinaturas").update({ estado: "pendente", emitente: null })
      .eq("fatura", f.fatura).eq("estado", "consultar").is("gateway_id", null);
    throw e;
  }
  await salvarNota(f, p.emitente, nota);
}

export async function rodarNotasAssinaturas() {
  const config = process.env.ASAAS_NFSE_ASSINATURAS_CONFIG;
  if (!config) return { configurado: false, processadas: 0 };
  const p = parametrosFiscais(config);
  const db = supabaseAdmin();
  let processadas = 0, erros = 0;
  const inicio = Date.now();
  while (processadas < 6 && Date.now() - inicio < 30_000) {
    const { data, error } = await db.rpc("nfse_assinatura_proxima", { p_desde: p.desde, p_apos_pagamento: p.aposPagamento, p_emitente: p.emitente });
    if (error) throw Error("Falha ao consultar a fila fiscal.");
    const f = data?.[0] as Fatura | undefined;
    if (!f) break;
    try {
      if (!processadas) {
        await conferirEmitente(p.emitente);
        await chamarAsaasFiscal("/fiscalInfo/", {}, p.emitente === CNPJ_IMOVEIS);
      }
      await processar(f, p);
    } catch (e) {
      const mensagem = e instanceof AsaasErro ? e.mensagem : e instanceof Error ? e.message : "Falha fiscal.";
      const { error: gravacao } = await db.from("nfse_assinaturas").update({ mensagem: mensagem.slice(0,350), proxima: new Date(Date.now()+3600_000).toISOString() })
        .eq("fatura", f.fatura).in("estado", ["pendente","consultar","agendada"]);
      if (gravacao) throw Error("Falha ao registrar pendência fiscal.");
      erros++;
      // Em especial, nunca processe um segundo item se a conta emissora foi recusada.
      if (!processadas) return { configurado: true, processadas: 1, erros };
    }
    processadas++;
  }
  return { configurado: true, processadas, erros };
}
