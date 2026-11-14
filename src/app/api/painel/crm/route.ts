import { sessaoCrm, listarPrivados, detalhePrivado } from "@/lib/crm-privado-servidor";
import { paginaCrm, UUID_CRM } from "@/lib/crm-privado";

const mensagens: Record<number, string> = {
  400: "Confira os campos do atendimento.", 401: "Entre novamente para continuar.",
  403: "O CRM privado não está liberado nesta sessão.", 404: "Atendimento ou contato não encontrado.",
  409: "Este atendimento foi atualizado. Recarregue antes de continuar.", 503: "O CRM não está disponível agora. Tente novamente.",
};
const json = (corpo: unknown, status = 200) => Response.json(corpo, { status, headers: { "Cache-Control": "private, no-store" } });
const falhar = (status: number) => json({ erro: mensagens[status] }, status);
export async function GET(req: Request) {
  const s = await sessaoCrm();
  if (s.status !== 200) return falhar(s.status);
  const params = new URL(req.url).searchParams;
  const id = params.get("id");
  const pagina = paginaCrm(params.get("pagina"));
  if (id !== null && !UUID_CRM.test(id)) return falhar(400);
  try {
    const resultado = id ? await detalhePrivado(s.banco, s.titular, id, pagina) : await listarPrivados(s.banco, s.titular, pagina);
    return resultado ? json(resultado) : falhar(404);
  } catch { return falhar(503); }
}

async function gravar(req: Request, abrir: boolean) {
  const s = await sessaoCrm();
  if (s.status !== 200) return falhar(s.status);
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b) || typeof b.id !== "string" || !UUID_CRM.test(b.id)) return falhar(400);
  const permitidos = abrir ? ["id","contatoId","nome","email","telefone","assunto","retorno","nota","modelo","categoria","campos"] : ["id","versao","etapa","retorno","nota"];
  if (Object.keys(b).some(k => !permitidos.includes(k)) || permitidos.some(k => k !== "versao" && k !== "campos" && b[k] != null && typeof b[k] !== "string")) return falhar(400);
  if (b.campos !== undefined && (!b.campos || Array.isArray(b.campos) || typeof b.campos !== "object"
    || Object.keys(b.campos).length > 8 || Object.values(b.campos).some(v => typeof v !== "string" || v.length > 250))) return falhar(400);
  if (b.retorno && !/^\d{4}-\d{2}-\d{2}$/.test(b.retorno)) return falhar(400);
  if (abrir ? (b.contatoId && !UUID_CRM.test(b.contatoId)) || !b.assunto?.trim() : !Number.isSafeInteger(b.versao)) return falhar(400);
  const params = { p_id: b.id, p_retorno: b.retorno || null, p_nota: b.nota || null };
  const res = abrir
    ? await s.banco.rpc("crm_privado_abrir", { ...params, p_contato_id: b.contatoId || null, p_nome: b.nome ?? null,
        p_email: b.email ?? null, p_telefone: b.telefone ?? null, p_assunto: b.assunto,
        p_modelo: b.modelo ?? null, p_categoria: b.categoria ?? null, p_campos: b.campos ?? {} })
    : await s.banco.rpc("crm_privado_encaminhar", { ...params, p_versao: b.versao, p_etapa: b.etapa ?? null });
  if (res.error) {
    const { code } = res.error;
    return falhar(code === "42501" ? 403 : code === "P0002" ? 404 : code === "40001" ? 409
      : code.startsWith("22") || code === "23514" ? 400 : 503);
  }
  return json({ ok: true, id: b.id }, abrir ? 201 : 200);
}
export const POST = (req: Request) => gravar(req, true);
export const PATCH = (req: Request) => gravar(req, false);

export async function PUT(req: Request) {
  const s = await sessaoCrm();
  if (s.status !== 200) return falhar(s.status);
  const b = await req.json().catch(() => null);
  if (!b || typeof b.profissao !== "string" || b.profissao.length > 60 || Object.keys(b).length !== 1) return falhar(400);
  const { error } = await s.banco.rpc("crm_privado_profissao", { p_profissao: b.profissao });
  return error ? falhar(error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503) : json({ok:true});
}
