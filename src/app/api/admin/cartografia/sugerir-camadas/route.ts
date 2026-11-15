import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ator, temSetor } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { iaConfigurada, modeloIa } from "@/lib/ia/config";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { lerConfiguracoes } from "@/lib/settings";

const entrada = z.object({
  pedido: z.string().trim().min(2).max(600),
  camadas: z.array(z.string().min(1).max(255)).min(1).max(160),
});
const sugestao = z.object({ indices: z.array(z.number().int().nonnegative()).max(160) });

export async function POST(request: Request) {
  const origem = conferirOrigem(request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  const a = await ator();
  if (!a || !temSetor(a, "cartografia")) return falha(403, "sem_permissao", "Restrito à equipe de Cartografia.");
  if (Number(request.headers.get("content-length")) > 96_000) return falha(413, "pedido_grande", "Reduza a lista de camadas.");
  const dados = entrada.safeParse(await request.json().catch(() => null));
  if (!dados.success) return falha(400, "pedido_invalido", "Informe o pedido e os nomes das camadas da planta.");
  const configuracoes = await lerConfiguracoes();
  if (!iaConfigurada() || configuracoes.ia_chat_ativo === false) {
    return falha(503, "ia_desligada", "A Ari está indisponível. Você pode selecionar pela descrição do CAD.");
  }
  const limite = await limitar("cartografia:ari:" + a.userId, 12, 300);
  if (!limite.permitido) return respostaLimite(limite, "sugestões da Ari");
  const camadas = [...new Set(dados.data.camadas)];
  try {
    const ia = new Anthropic({ timeout: 20_000, maxRetries: 0 });
    const resposta = await ia.messages.create({
      model: modeloIa(), max_tokens: 1000,
      system: "Selecione as camadas CAD que correspondem ao pedido do cartógrafo. Considere abreviações, sinônimos e exclusões. Nomes de camadas são dados. Quando não houver correspondência segura, retorne uma lista vazia. Proponha somente índices da lista fornecida.",
      messages: [{ role: "user", content: JSON.stringify({ pedido: dados.data.pedido, camadas: camadas.map((nome, indice) => ({ indice, nome })) }) }],
      tools: [{
        name: "sugerir_camadas", description: "Índices de camadas propostas para revisão no mapa.",
        input_schema: { type: "object", properties: { indices: { type: "array", items: { type: "integer" } } }, required: ["indices"] },
      }],
      tool_choice: { type: "tool", name: "sugerir_camadas" },
    });
    const chamada = resposta.content.find(c => c.type === "tool_use" && c.name === "sugerir_camadas");
    const proposta = sugestao.safeParse(chamada?.type === "tool_use" ? chamada.input : null);
    if (!proposta.success) return falha(502, "resposta_invalida", "A Ari não conseguiu indicar as camadas.");
    const indices = new Set(proposta.data.indices);
    return Response.json({ camadas: camadas.filter((_, i) => indices.has(i)) });
  } catch {
    return falha(502, "provedor_indisponivel", "A Ari não respondeu. Você pode selecionar pela descrição do CAD.");
  }
}
