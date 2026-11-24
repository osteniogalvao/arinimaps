export type PerfilEquipe = { role?: string; setores_gestor?: string[] | null; equipe_acesso?: string | null };

export function somenteLeituraEquipe(p: PerfilEquipe | null | undefined) {
  return p?.role === "analista_arini" && p.equipe_acesso === "leitura";
}

/**
 * 2FA da equipe: obrigatório DESLIGADO (ordem do Stenio, 24/11/2026). A opção
 * `seguranca_mfa_equipe` das Configurações é ignorada de propósito: se ela
 * tivesse ficado marcada no banco, toda a equipe sem autenticador cadastrado
 * era mandada para "ativar o segundo fator" e não entrava na Central.
 * Quem já tem 2FA cadastrado continua confirmando o código no login (aal2).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function mfaObrigatoriaEquipe(_p?: PerfilEquipe | null, _exigirEquipeToda = false) {
  return false;
}

/** Leitura mantém autenticação, recuperação e confirmação dos próprios avisos. */
export function escritaLiberadaParaLeitura(caminho: string, metodo: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(metodo.toUpperCase())) return true;
  // MFA/senha usam GoTrue e as rotas de Auth, não Server Actions da página.
  // Não liberar POST em uma página: uma Action pode ser enviada para outra URL.
  return caminho === "/api/acesso" || caminho.startsWith("/api/auth/") || caminho === "/api/notificacoes";
}
