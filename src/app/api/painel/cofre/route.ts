import { ator } from "@/lib/authz";
import { temPerfilCofre } from "@/lib/cofre";
import { falha } from "@/lib/erros";
import { corpoPedido, ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";

const campos = "id,nome,municipio,area_ha,car,matricula";
export async function GET(req: Request) {
  const a = await ator();
  if (!a || !temPerfilCofre(a.role,a.nicho)) return falha(a ? 403 : 401, "sem_acesso", "Entre com uma conta de proprietário ou produtor rural.");
  const pagina = Number(new URL(req.url).searchParams.get("pagina") ?? 1);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 10_000_000) return falha(400, "pagina", "Página inválida.");
  const db = supabaseAdmin();
  const [imoveis, limite] = await Promise.all([
    db.from("cofre_propriedades").select(campos, { count: "exact" }).eq("titular_id",a.userId)
      .order("created_at",{ascending:false}).order("id").range((pagina-1)*25, pagina*25-1),
    db.rpc("cofre_limite",{ p_titular: a.userId }),
  ]);
  if (imoveis.error || limite.error) return falha(503,"cofre_indisponivel","Não foi possível abrir o cofre.");
  return Response.json({ propriedades: imoveis.data, total: imoveis.count, limite: limite.data });
}

async function salvar(req: Request, nova: boolean) {
  const a = await ator();
  if (!a || !temPerfilCofre(a.role,a.nicho)) return falha(a ? 403 : 401,"sem_acesso","Entre com uma conta de proprietário ou produtor rural.");
  const d = await corpoPedido(req);
  if (!d || !ehUuid(d.id)) return falha(400,"dados","Identificação inválida.");
  for (const campo of ["nome","municipio","car","matricula"]) {
    const valor = d[campo];
    if (((campo === "nome" || campo === "municipio") && (typeof valor !== "string" || !valor.trim())) ||
      (valor != null && (typeof valor !== "string" || valor.trim().length > 160))) return falha(400,"dados","Confira os campos da propriedade.");
  }
  if (typeof d.area_ha !== "number" || !Number.isFinite(d.area_ha) || d.area_ha <= 0 || d.area_ha > 51_010_000_000)
    return falha(400,"area","Informe uma área válida em hectares.");
  const { error } = await supabaseAdmin().rpc("cofre_salvar_propriedade", {
    p_titular: a.userId, p_id: d.id, p_nome: String(d.nome).trim(), p_municipio: String(d.municipio).trim(),
    p_area_ha: d.area_ha, p_car: typeof d.car === "string" ? d.car.trim() || null : null,
    p_matricula: typeof d.matricula === "string" ? d.matricula.trim() || null : null, p_nova: nova,
  });
  if (error?.code === "54000") return falha(409,"limite","Você já usou todas as vagas do cofre.");
  if (error?.code === "23505") return falha(409,"conflito","Esta identificação já está em uso. Atualize a lista.");
  if (error?.code === "P0002") return falha(404,"propriedade","Propriedade não encontrada.");
  if (error) return falha(503,"cofre_indisponivel","Não foi possível salvar a propriedade.");
  return Response.json({ id: d.id });
}
export function POST(req: Request) { return salvar(req,true); }
export function PATCH(req: Request) { return salvar(req,false); }
export async function DELETE(req: Request) {
  const a = await ator();
  if (!a || !temPerfilCofre(a.role,a.nicho)) return falha(a ? 403 : 401,"sem_acesso","Entre com uma conta de proprietário ou produtor rural.");
  const id = new URL(req.url).searchParams.get("id");
  if (!ehUuid(id)) return falha(400,"propriedade","Propriedade inválida.");
  const {error} = await supabaseAdmin().from("cofre_propriedades").delete().eq("titular_id",a.userId).eq("id",id);
  return error ? falha(503,"cofre_indisponivel","Não foi possível excluir a propriedade.") : Response.json({ok:true});
}
