/** Macros do atendimento (0179). Sem dependência de servidor: tela e API. */
export type PassoMacro =
  | { tipo: "mensagem"; texto: string }
  | { tipo: "nota"; texto: string }
  | { tipo: "etiqueta"; texto: string }
  | { tipo: "transferir"; setor: string; motivo?: string }
  | { tipo: "assumir" } | { tipo: "pendente" } | { tipo: "resolver" };

export type Macro = { id: string; nome: string; passos: PassoMacro[]; publica: boolean; criado_por: string | null; ativo: boolean };

export const PASSO_LABEL: Record<PassoMacro["tipo"], string> = {
  mensagem: "Enviar mensagem ao cliente", nota: "Adicionar nota interna", etiqueta: "Adicionar etiqueta",
  transferir: "Transferir para o setor", assumir: "Assumir a conversa", pendente: "Marcar aguardando cliente", resolver: "Encerrar a conversa",
};

/** Valida e limpa os passos vindos da tela (no máximo 10). */
export function limparPassos(bruto: unknown, setoresValidos: string[]): PassoMacro[] {
  if (!Array.isArray(bruto)) return [];
  const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const out: PassoMacro[] = [];
  for (const p of bruto.slice(0, 10)) {
    const tipo = (p as { tipo?: string })?.tipo;
    const x = p as Record<string, unknown>;
    if (tipo === "mensagem" || tipo === "nota") { const texto = t(x.texto, 4000); if (texto) out.push({ tipo, texto }); }
    else if (tipo === "etiqueta") { const texto = t(x.texto, 40).toLowerCase().replace(/^#/, ""); if (texto) out.push({ tipo, texto }); }
    else if (tipo === "transferir") { const setor = t(x.setor, 40); if (setoresValidos.includes(setor)) out.push({ tipo, setor, motivo: t(x.motivo, 200) || undefined }); }
    else if (tipo === "assumir" || tipo === "pendente" || tipo === "resolver") out.push({ tipo });
  }
  return out;
}
