export type PerfilEquipe = { role?: string; setores_gestor?: string[] | null; equipe_acesso?: string | null };

export function somenteLeituraEquipe(p: PerfilEquipe | null | undefined) {
  return p?.role === "analista_arini" && p.equipe_acesso === "leitura";
}

/**
 * 2FA da equipe: só obrigatório quando a Diretoria liga `seguranca_mfa_equipe`
 * em Configurações. Desligado por padrão (decisão do Stenio, 24/11/2026): a
 * Diretoria e os gestores ainda não cadastraram o autenticador.
 */
export function mfaObrigatoriaEquipe(p: PerfilEquipe | null | undefined, exigirEquipeToda = false) {
  if (!p || !["admin_central", "analista_arini"].includes(p.role ?? "")) return false;
  return exigirEquipeToda;
}

/** Leitura mantém autenticação, recuperação e confirmação dos próprios avisos. */
export function escritaLiberadaParaLeitura(caminho: string, metodo: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(metodo.toUpperCase())) return true;
  // MFA/senha usam GoTrue e as rotas de Auth, não Server Actions da página.
  // Não liberar POST em uma página: uma Action pode ser enviada para outra URL.
  return caminho === "/api/acesso" || caminho.startsWith("/api/auth/") || caminho === "/api/notificacoes";
}
