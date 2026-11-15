import { revalidateTag } from "next/cache";
import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { lerCsvPrecos, validarSerie } from "@/lib/mercado/importacao";

export async function POST(req: Request) {
  const a = await ator();
  if (!temSetor(a, "operacoes", "diretoria"))
    return Response.json({ error: "Restrito às Operações." }, { status: 403 });
  const limite = await limitar("importacao-cotacoes:" + a!.userId, 36, 600);
  if (!limite.permitido) return respostaLimite(limite, "importação de cotações");
  const leitor = req.body?.getReader();
  if (!leitor) return Response.json({ error: "Dados ausentes." }, { status: 400 });
  let bytes = 0;
  const blocos: Uint8Array[] = [];
  while (true) {
    const parte = await leitor.read();
    if (parte.done) break;
    bytes += parte.value.byteLength;
    if (bytes > 95000) {
      await leitor.cancel();
      return Response.json({ error: "Arquivo grande demais." }, { status: 413 });
    }
    blocos.push(parte.value);
  }
  try {
    const b = JSON.parse(Buffer.concat(blocos).toString("utf8"));
    if (
      !b ||
      !["prever", "publicar"].includes(b.acao) ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(b.chave ?? "") ||
      typeof b.arquivo !== "string" ||
      !b.arquivo.trim() ||
      b.arquivo.length > 180 ||
      typeof b.autorizacao !== "string" ||
      b.autorizacao.trim().length < 10 ||
      b.autorizacao.length > 500 ||
      (b.acao === "publicar" && (b.autorizado !== true || !/^[0-9a-f]{64}$/.test(b.revisao ?? "")))
    )
      return Response.json({ error: "Confira o arquivo, a autorização e a prévia." }, { status: 400 });
    const serie = validarSerie(b.serie),
      pontos = lerCsvPrecos(b.csv, new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));
    const { data, error } = await supabaseAdmin().rpc("cotacoes_importar", {
      p_ator: a!.userId,
      p_chave: b.chave,
      p_serie: serie,
      p_pontos: pontos,
      p_arquivo: b.arquivo.trim(),
      p_autorizacao: b.autorizacao.trim(),
      p_revisao: b.acao === "publicar" ? b.revisao : null,
    });
    if (error)
      return Response.json(
        {
          error: ["22023", "40001"].includes(error.code) ? error.message : "A importação não foi concluída.",
        },
        { status: error.code === "40001" ? 409 : error.code === "22023" ? 400 : 503 },
      );
    if (data?.publicado) revalidateTag("cotacoes", { expire: 0 });
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof SyntaxError
            ? "Dados inválidos."
            : e instanceof Error
              ? e.message
              : "Falha ao ler o arquivo.",
      },
      { status: 400 },
    );
  }
}
