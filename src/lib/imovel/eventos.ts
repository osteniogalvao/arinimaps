import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { consentimentoDaConta } from "@/lib/privacidade/consentimento";
import { ipDoPedido } from "@/lib/seguranca/limite";

/**
 * Histórico de acessos e interações do imóvel (requisitos cartográficos §1.1,
 * 05/10/2026): cada abertura de ficha, tour, relatório, documento, interesse
 * e consulta vira uma linha em `property_events`, sempre amarrada ao ID do
 * imóvel. Quem vê: dono, parceiro responsável e Matriz, na ficha do imóvel.
 *
 * Nunca lança: registrar histórico não pode derrubar a página.
 */
export type TipoEventoImovel =
  | "visualizacao" | "ficha" | "tour" | "relatorio" | "camada" | "documento" | "midia"
  | "favorito" | "interesse" | "lead" | "consulta" | "compartilhamento" | "revisao";

export async function registrarEventoImovel(dados: {
  propertyId: string;
  tipo: TipoEventoImovel;
  userId?: string | null;
  partnerId?: string | null;
  detalhe?: Record<string, unknown>;
  request?: Request | null;
  ip?: string | null;
}) {
  try {
    const navegacao = ["visualizacao","ficha","tour","relatorio","camada","favorito","consulta","compartilhamento"].includes(dados.tipo);
    if (navegacao && !await consentimentoDaConta(dados.userId,"rastro")) return;
    await supabaseAdmin().from("property_events").insert({
      property_id: dados.propertyId,
      user_id: dados.userId ?? null,
      partner_id: dados.partnerId ?? null,
      tipo: dados.tipo,
      detalhe: dados.detalhe ?? {},
      ip: navegacao ? null : dados.ip ?? (dados.request ? ipDoPedido(dados.request) : null),
    });
  } catch (e) {
    console.error("property_events falhou:", e);
  }
}

/** Origem de um dado do imóvel (§1.5). Nunca lança. */
export async function registrarOrigemDado(dados: {
  propertyId: string;
  campo: string;
  origem: "fonte_oficial" | "proprietario" | "corretor_franquia" | "matriz" | "processamento_arini" | "estimativa_arini" | "geometria_usuario" | "geometria_validada";
  detalhe?: string;
  userId?: string | null;
}) {
  try {
    await supabaseAdmin().from("property_data_sources").insert({
      property_id: dados.propertyId, campo: dados.campo, origem: dados.origem,
      detalhe: dados.detalhe ?? null, user_id: dados.userId ?? null,
    });
  } catch (e) {
    console.error("property_data_sources falhou:", e);
  }
}

export const ORIGEM_DADO_LABEL: Record<string, string> = {
  fonte_oficial: "Fonte externa/oficial",
  proprietario: "Proprietário/usuário",
  corretor_franquia: "Corretor/franquia",
  matriz: "Equipe da Matriz",
  processamento_arini: "Processamento Arini",
  estimativa_arini: "Estimativa Arini",
  geometria_usuario: "Geometria informada pelo usuário",
  geometria_validada: "Geometria validada pela Matriz",
};

export const EVENTO_IMOVEL_LABEL: Record<string, string> = {
  visualizacao: "Visualização no mapa", ficha: "Abertura da ficha", tour: "Tour 3D", relatorio: "Relatório territorial",
  camada: "Camada consultada", documento: "Documento aberto", midia: "Mídia enviada", favorito: "Favoritado",
  interesse: "Demonstração de interesse", lead: "Lead criado", consulta: "Consulta territorial",
  compartilhamento: "Compartilhado", revisao: "Alteração proposta",
};
