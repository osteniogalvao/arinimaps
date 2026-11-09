import { supabaseBrowser } from "@/lib/supabase/client";

export const VIDEO_MAX_MB = 50;
export const VIDEO_ACEITA = "video/mp4,video/quicktime,video/webm";

/**
 * Envia um vídeo do imóvel direto do navegador para o armazenamento, em três
 * passos: pede a autorização de envio, manda o arquivo, registra no imóvel.
 * Devolve a mensagem de erro, ou null quando deu certo.
 */
export async function enviarVideo(propertyId: string, arquivo: File): Promise<string | null> {
  if (arquivo.size > VIDEO_MAX_MB * 1024 * 1024) {
    return `${arquivo.name} tem ${(arquivo.size / 1048576).toFixed(0)} MB e o limite é ${VIDEO_MAX_MB} MB.`;
  }
  // queda de rede ou resposta sem JSON (413/504 com página HTML) viram mensagem, não exceção:
  // quem chama segue para os próximos vídeos e mostra o que falhou
  try {
    const pedido = await fetch(`/api/imoveis/${propertyId}/midia`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: arquivo.type, tamanho: arquivo.size }),
    });
    const aut = await pedido.json().catch(() => ({}));
    if (!pedido.ok) return aut.error ?? "Não foi possível iniciar o envio do vídeo.";

    const { error } = await supabaseBrowser().storage.from("media")
      .uploadToSignedUrl(aut.path, aut.token, arquivo, { contentType: arquivo.type });
    if (error) return `O envio de ${arquivo.name} falhou: ${error.message}`;

    const registro = await fetch(`/api/imoveis/${propertyId}/midia`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: aut.path }),
    });
    if (!registro.ok) return (await registro.json().catch(() => ({}))).error ?? "O vídeo subiu, mas não foi registrado.";
    return null;
  } catch {
    return `O envio de ${arquivo.name} foi interrompido (conexão caiu ou o servidor não respondeu). Reenvie na página do anúncio.`;
  }
}
