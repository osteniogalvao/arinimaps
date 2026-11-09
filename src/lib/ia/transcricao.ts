import "server-only";

/**
 * Transcrição de áudio para o cadastro rápido com a Ari (2ª etapa, item 4).
 *
 * A Anthropic não transcreve áudio. Enquanto nenhum serviço de transcrição
 * estiver configurado, o cadastro rápido ACEITA o áudio, avisa que ele será
 * transcrito quando o serviço for ligado e segue só com o texto e os arquivos.
 *
 * Para ligar: qualquer serviço compatível com a rota
 * `POST /v1/audio/transcriptions` (formato OpenAI/Whisper — OpenAI, Groq e
 * outros usam o mesmo contrato):
 *   ARINI_TRANSCRICAO_URL     ex.: https://api.openai.com/v1/audio/transcriptions
 *   ARINI_TRANSCRICAO_CHAVE   chave do serviço (nunca vai para o navegador)
 *   ARINI_TRANSCRICAO_MODELO  padrão whisper-1
 * Trocar de serviço = trocar só esta função.
 */
export function transcricaoConfigurada() {
  return !!process.env.ARINI_TRANSCRICAO_URL?.trim() && !!process.env.ARINI_TRANSCRICAO_CHAVE?.trim();
}

/** Texto do áudio, ou null se o serviço estiver desligado ou falhar (o cadastro segue sem ele). */
export async function transcreverAudio(arquivo: File): Promise<string | null> {
  if (!transcricaoConfigurada()) return null;
  try {
    const fd = new FormData();
    fd.set("file", arquivo, arquivo.name || "audio");
    fd.set("model", process.env.ARINI_TRANSCRICAO_MODELO?.trim() || "whisper-1");
    fd.set("language", "pt");
    const r = await fetch(process.env.ARINI_TRANSCRICAO_URL!.trim(), {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.ARINI_TRANSCRICAO_CHAVE!.trim()}` },
      body: fd,
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { text?: unknown };
    return typeof d.text === "string" && d.text.trim() ? d.text.trim().slice(0, 8000) : null;
  } catch (e) {
    console.error("transcrição falhou:", e);
    return null;
  }
}
