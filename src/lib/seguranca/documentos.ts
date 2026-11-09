import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { podeOperarOportunidade, temSetor, type Ator } from "@/lib/authz";
import { ipDoPedido } from "./limite";

/**
 * Quem pode abrir cada arquivo do cofre privado (`docs`) — item 6.3.
 *
 * A permissão sai do REGISTRO que aponta para o arquivo, não do caminho:
 * um caminho que não está em nenhuma tabela não abre (nem para a equipe),
 * o que impede adivinhar nomes de arquivo.
 *
 * | Arquivo                               | Fora da equipe                         | Equipe (setor)                         |
 * |---------------------------------------|----------------------------------------|----------------------------------------|
 * | Documento do imóvel (property_documents) | dono ou parceiro responsável         | Operações, Jurídico, Cartografia       |
 * | Autorização assinada (property_authorizations.documento_path) | dono ou parceiro | Operações, Jurídico            |
 * | Selfie do aceite (selfie_path)        | só quem fez o aceite                   | Operações, Jurídico                    |
 * | Contrato (contracts.documento_path)   | quem opera a oportunidade              | Comercial, Jurídico, Financeiro        |
 * | Anexo cartográfico (cartographic_requests.arquivos) | quem abriu a solicitação | Cartografia                          |
 * | Minha área (property_area_arquivos)   | dono ou parceiro responsável           | Operações, Cartografia, Comercial      |
 */
export type CategoriaArquivo = "documento" | "selfie" | "autorizacao" | "contrato" | "cartografia";

export type ArquivoResolvido = {
  categoria: CategoriaArquivo;
  permitido: boolean;
  motivo: string | null;
  nome: string;
  documentoId: string | null;
  propertyId: string | null;
  opportunityId: string | null;
  requestId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Caminho só com os caracteres que o próprio servidor gera; nada de `..`. */
export function caminhoValido(path: string) {
  return path.length > 3 && path.length <= 400 && !path.includes("..") && !path.includes("//") &&
    !path.startsWith("/") && /^[A-Za-z0-9._\-/]+$/.test(path);
}

async function responsavelPeloImovel(a: Ator, propertyId: string) {
  if (!a.ownerId && !a.partnerId) return false;
  const { data: p } = await supabaseAdmin()
    .from("properties").select("owner_id, partner_id").eq("id", propertyId).maybeSingle();
  if (!p) return false;
  return (!!a.ownerId && p.owner_id === a.ownerId) || (!!a.partnerId && p.partner_id === a.partnerId);
}

const nomeDoPath = (path: string) => path.split("/").pop() ?? "arquivo";
/** Terceiro trecho do caminho (imoveis/<id>/<pasta>/…). */
const partes3 = (path: string) => path.split("/")[2] ?? "";

/** Descobre o que é o arquivo e se este usuário pode abri-lo. null = arquivo desconhecido. */
export async function resolverArquivo(a: Ator, path: string): Promise<ArquivoResolvido | null> {
  const admin = supabaseAdmin();
  const [prefixo, chave] = path.split("/");
  const base = { documentoId: null, propertyId: null, opportunityId: null, requestId: null, motivo: null };

  if (prefixo === "imoveis" && UUID.test(chave ?? "")) {
    const propertyId = chave;
    const colunasAut = "id, property_id, selfie_path, documento_path, aceite_por";
    const [{ data: doc }, { data: autSelfie }, { data: autDoc }] = await Promise.all([
      admin.from("property_documents").select("id, nome_arquivo, property_id").eq("storage_path", path).limit(1).maybeSingle(),
      admin.from("property_authorizations").select(colunasAut).eq("selfie_path", path).limit(1).maybeSingle(),
      admin.from("property_authorizations").select(colunasAut).eq("documento_path", path).limit(1).maybeSingle(),
    ]);
    const aut = autSelfie ?? autDoc;
    if (doc && doc.property_id === propertyId) {
      const permitido = temSetor(a, "operacoes", "juridico", "cartografia") || (await responsavelPeloImovel(a, propertyId));
      return { ...base, categoria: "documento", permitido, motivo: permitido ? null : "não é responsável pelo imóvel",
        nome: doc.nome_arquivo ?? nomeDoPath(path), documentoId: doc.id, propertyId };
    }
    if (aut && aut.property_id === propertyId) {
      const selfie = aut.selfie_path === path;
      const permitido = temSetor(a, "operacoes", "juridico") ||
        (selfie ? aut.aceite_por === a.userId : await responsavelPeloImovel(a, propertyId));
      return { ...base, categoria: selfie ? "selfie" : "autorizacao", permitido,
        motivo: permitido ? null : selfie ? "selfie só para quem fez o aceite e a equipe" : "não é responsável pelo imóvel",
        nome: nomeDoPath(path), documentoId: aut.id, propertyId };
    }
    // Minha área (item 29, migration 0060): arquivos de projeto do anunciante.
    // Só o dono e a Central. Tabela ausente = arquivo desconhecido.
    if (partes3(path) === "minha-area") {
      const { data: arq, error } = await admin.from("property_area_arquivos")
        .select("id, nome_arquivo, property_id").eq("storage_path", path).limit(1).maybeSingle();
      if (error || !arq || arq.property_id !== propertyId) return null;
      const permitido = temSetor(a, "operacoes", "cartografia", "comercial") || (await responsavelPeloImovel(a, propertyId));
      return { ...base, categoria: "documento", permitido, motivo: permitido ? null : "não é responsável pelo imóvel",
        nome: arq.nome_arquivo ?? nomeDoPath(path), documentoId: arq.id, propertyId };
    }
    return null;
  }

  if (prefixo === "contratos" && UUID.test(chave ?? "")) {
    const { data: c } = await admin.from("contracts").select("id, opportunity_id").eq("documento_path", path).maybeSingle();
    if (!c || c.opportunity_id !== chave) return null;
    const permitido = a.ehArini
      ? temSetor(a, "comercial", "juridico", "financeiro")
      : await podeOperarOportunidade(a, c.opportunity_id);
    return { ...base, categoria: "contrato", permitido, motivo: permitido ? null : "não opera esta oportunidade",
      nome: nomeDoPath(path), documentoId: c.id, opportunityId: c.opportunity_id };
  }

  if (prefixo === "cartografia" && /^CART-\d+$/.test(chave ?? "")) {
    const { data: s } = await admin.from("cartographic_requests")
      .select("id, user_id, property_id, arquivos").eq("protocolo", chave).maybeSingle();
    const arquivos = (s?.arquivos ?? []) as { path?: string; nome?: string }[];
    const arq = arquivos.find((x) => x.path === path);
    if (!s || !arq) return null;
    const permitido = temSetor(a, "cartografia") || s.user_id === a.userId;
    return { ...base, categoria: "cartografia", permitido, motivo: permitido ? null : "não é o solicitante",
      nome: arq.nome ?? nomeDoPath(path), requestId: s.id, propertyId: s.property_id ?? null };
  }

  return null;
}

/** Grava a abertura (ou a tentativa negada). Nunca lança. */
export async function registrarAcessoDocumento(
  request: Request,
  a: Ator | null,
  path: string,
  acao: "visualizar" | "baixar",
  r: ArquivoResolvido | null
) {
  try {
    await supabaseAdmin().from("document_access_log").insert({
      user_id: a?.userId ?? null,
      categoria: r?.categoria ?? "documento",
      documento_id: r?.documentoId ?? null,
      storage_path: path.slice(0, 400),
      property_id: r?.propertyId ?? null,
      opportunity_id: r?.opportunityId ?? null,
      cartographic_request_id: r?.requestId ?? null,
      acao,
      permitido: !!r?.permitido,
      motivo: r ? r.motivo : "arquivo desconhecido",
      ip: ipDoPedido(request),
      agente: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
  } catch (e) {
    console.error("document_access_log falhou:", e);
  }
}

export const CATEGORIA_ARQUIVO_LABEL: Record<CategoriaArquivo, string> = {
  documento: "Documento do imóvel", selfie: "Selfie do aceite", autorizacao: "Autorização assinada",
  contrato: "Contrato", cartografia: "Anexo cartográfico",
};
