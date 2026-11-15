import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Documento } from "@/lib/juridico";
import BotaoImprimir from "@/app/(public)/termos/[documento]/BotaoImprimir";

export const dynamic = "force-dynamic";
async function assinar(form: FormData) {
  "use server";
  const u = await currentUser();
  if (!u) redirect("/entrar");
  const id = String(form.get("id"));
  if (!/^[a-f0-9-]{36}$/i.test(id) || form.get("confirmacao")!=="on") return;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const {error} = await supabaseAdmin().rpc("fn_assinar_testemunha",{p_id:id,p_titular:u.id,p_codigo:String(form.get("codigo")),p_ip:ip});
  if (error) throw Error("A assinatura não foi registrada. Reabra o documento e confira sua indicação.");
  revalidatePath("/conta/termos");
  redirect("/conta/termos/"+id);
}
export default async function CopiaAceite({params}: {params: Promise<{id:string}>}) {
  const u = await currentUser();
  if (!u) redirect("/entrar");
  const {id} = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const db = supabaseAdmin();
  const testemunha = await db.from("exclusividade_testemunhas").select("perfil,codigo,assinado_em").eq("autorizacao",id).eq("perfil",u.id).maybeSingle();
  if (testemunha.error) throw Error("Falha ao conferir o acesso ao contrato.");
  const colunas = "termo_aceito,versao,aceite_at,imovel:properties(codigo,titulo)";
  const {data,error} = testemunha.data
    ? await db.from("property_authorizations").select("termo_aceito,versao,aceite_at,imovel:properties(codigo,titulo),convite:exclusividade_testemunhas!inner(perfil)").eq("id",id).eq("convite.perfil",u.id).maybeSingle()
    : await db.from("property_authorizations").select(colunas).eq("id",id).eq("aceite_por",u.id).maybeSingle();
  if (error) throw Error("Falha ao consultar o contrato.");
  if (!data) notFound();
  const assinaturas = await db.from("exclusividade_testemunhas").select("posicao,assinado_em,pessoa:profiles!exclusividade_testemunhas_perfil_fkey(nome)")
    .eq("autorizacao",id).not("assinado_em","is",null).order("posicao");
  if (assinaturas.error) throw Error("Falha ao consultar as assinaturas do contrato.");
  const termo = data.termo_aceito as (Documento & {codigo_verificacao?:string}) | null;
  const imovel = data.imovel as unknown as {codigo:string;titulo:string}|null;
  return <main className="mx-auto max-w-3xl space-y-5 p-5">
    <Link className="underline print:hidden" href="/conta/termos">Voltar aos meus termos</Link>
    <h1 className="lp-display text-3xl">{termo?.titulo ?? "Aceite do imóvel"}</h1>
    <p>{imovel?.codigo} · {imovel?.titulo} · {data.versao}</p>
    <p>Assinado em {new Date(data.aceite_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})} (Brasília).</p>
    {termo?.codigo_verificacao && <p className="break-all text-sm">Código de verificação · {termo.codigo_verificacao}</p>}
    {testemunha.data && !testemunha.data.assinado_em && <form action={assinar} className="cartao space-y-3 p-4 print:hidden">
      <input type="hidden" name="id" value={id}/><input type="hidden" name="codigo" value={testemunha.data.codigo}/>
      <label className="flex items-start gap-2"><input required type="checkbox" name="confirmacao"/>Conferi a íntegra e assino este documento como testemunha.</label>
      <button className="btn-contorno px-3 py-2">Assinar como testemunha</button>
    </form>}
    {testemunha.data?.assinado_em && <p>Você assinou como testemunha em {new Date(testemunha.data.assinado_em).toLocaleString("pt-BR")}.</p>}
    <BotaoImprimir />
    {termo?.pdf && <a href={termo.pdf} download className="ml-3 underline">Baixar modelo original em PDF</a>}
    {termo?.secoes.map(s=><section key={s.titulo} className="space-y-2"><h2 className="font-bold">{s.titulo}</h2>
      {s.itens.map((item,i)=><p key={i} className="whitespace-pre-line">{item}</p>)}</section>) ?? <p>Este registro histórico contém a versão e a data de aceite. A íntegra individualizada passou a ser guardada nas contratações posteriores.</p>}
    {assinaturas.data.length>0 && <section className="space-y-2"><h2 className="font-bold">Assinaturas de testemunhas</h2>
      {assinaturas.data.map(t=><p key={t.posicao}>Testemunha {t.posicao} · {(t.pessoa as unknown as {nome:string}|null)?.nome} · {new Date(t.assinado_em).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})} (Brasília)</p>)}
    </section>}
  </main>;
}
