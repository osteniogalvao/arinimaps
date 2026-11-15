import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { documento } from "@/lib/juridico";

export const dynamic = "force-dynamic";
const dataBR = (v: string) => new Date(v.length === 10 ? v + "T12:00:00Z" : v).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

async function registrar(form: FormData) {
  "use server";
  const u = await currentUser();
  if (!u) redirect("/entrar");
  const { error } = await supabaseAdmin().rpc("fn_opcao_exclusividade", {
    p_autorizacao: String(form.get("id")), p_titular: u.id,
    p_evento: String(form.get("evento")), p_vencimento: String(form.get("validade")),
  });
  revalidatePath("/conta/termos");
  redirect(error ? "/conta/termos?retorno=erro" : "/conta/termos?retorno=ok");
}
function LinksAceitos({versoes}:{versoes: string}) {
  return <ul className="space-y-1">{versoes.split(",").map(v=>{
    const [id,versao] = v.split("@");
    const doc = versao && documento({},id,undefined,versao);
    return <li key={v}>{doc ? <Link className="underline" href={`/termos/${doc.id}?versao=${doc.versao}`}>{doc.titulo} · {doc.versao}</Link> : v}</li>;
  })}</ul>;
}

export default async function TermosDaConta({searchParams}: {searchParams: Promise<Record<string,string|string[]|undefined>>}) {
  const u = await currentUser();
  if (!u) redirect("/entrar");
  const q = await searchParams;
  const pagina = Math.max(1, Math.floor(Number(q.pagina) || 1));
  const db = supabaseAdmin();
  const [perfil, imoveis, testemunhos, parcerias] = await Promise.all([
    db.from("profiles").select("aceite_termos_at,aceite_termos_versao").eq("user_id",u.id).single(),
    db.from("property_authorizations").select("id,tipo,versao,validade,aceite_at,imovel:properties(codigo,titulo),eventos:exclusividade_eventos(evento,vencimento,criado_em)")
      .eq("aceite_por",u.id).order("aceite_at",{ascending:false}).order("id").range((pagina-1)*20,pagina*20),
    db.from("exclusividade_testemunhas").select("autorizacao,posicao,assinado_em").eq("perfil",u.id).order("assinado_em",{ascending:false,nullsFirst:true}),
    db.from("partners").select("aceite_termos_versao,aceite_termos_at,tipo").eq("profile_id",u.id),
  ]);
  if (perfil.error || imoveis.error || parcerias.error || testemunhos.error) throw Error("Não foi possível consultar os termos da sua conta.");
  return <main className="mx-auto max-w-3xl space-y-6 p-5">
    <Link href="/conta" className="underline">Minha conta</Link><h1 className="lp-display text-3xl">Termos e contratos aceitos</h1>
    {q.retorno && <p role="status">{q.retorno === "ok" ? "Sua opção foi registrada." : "Não foi possível registrar essa opção. Confira a vigência ou fale com a Central."}</p>}
    {perfil.data.aceite_termos_versao && <section className="cartao space-y-2 p-5"><h2 className="font-bold">Cadastro{perfil.data.aceite_termos_at && " · " + dataBR(perfil.data.aceite_termos_at)}</h2>
      <LinksAceitos versoes={perfil.data.aceite_termos_versao}/></section>}
    {parcerias.data.filter(p => p.aceite_termos_versao && p.aceite_termos_versao !== perfil.data.aceite_termos_versao).map(p=>
      <section className="cartao p-5" key={p.tipo}><h2 className="font-bold">Perfil {p.tipo}</h2><LinksAceitos versoes={p.aceite_termos_versao}/></section>)}
    {testemunhos.data.map(t=><section className="cartao space-y-2 p-5" key={t.autorizacao}>
      <h2 className="font-bold">Testemunha {t.posicao} · Termo de Exclusividade</h2>
      <p>{t.assinado_em ? "Assinado em " + dataBR(t.assinado_em) : "Aguardando sua assinatura"}</p>
      <Link className="underline" href={`/conta/termos/${t.autorizacao}`}>Conferir contrato</Link>
    </section>)}
    {imoveis.data.slice(0,20).map(a=>{
      const imovel = a.imovel as unknown as {codigo:string;titulo:string}|null;
      const eventos = a.eventos as {evento:string;vencimento:string;criado_em:string}[];
      const novo = a.versao?.includes("exclusividade@2026.11.15");
      const encerrado = eventos.some(e=>["encerramento","desistencia"].includes(e.evento));
      const optou = eventos.some(e=>e.evento==="nao_renovar" && e.vencimento===a.validade);
      return <article className="cartao space-y-3 p-5" key={a.id}>
        <h2 className="font-bold">{imovel?.codigo} · {imovel?.titulo}</h2>
        {a.aceite_at && <p>Aceito em {dataBR(a.aceite_at)}{a.validade && " · vencimento em " + dataBR(a.validade)}</p>}
        {a.versao && <LinksAceitos versoes={a.versao}/>}
        {a.tipo === "exclusividade" && <Link href={`/conta/termos/${a.id}`} className="inline-block underline">Abrir cópia do aceite deste imóvel</Link>}
        {eventos.sort((x,y)=>x.criado_em.localeCompare(y.criado_em)).map(e=><p key={e.evento+e.vencimento} className="text-sm">
          {dataBR(e.criado_em)} · {{aviso:"Aviso de renovação",nao_renovar:"Não renovação registrada",desistencia:"Desistência registrada",renovacao:"Exclusividade renovada",encerramento:"Exclusividade encerrada"}[e.evento]}</p>)}
        {novo && !encerrado && a.validade && a.validade >= new Date().toLocaleDateString("sv-SE",{timeZone:"America/Sao_Paulo"}) &&
          <form action={registrar} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={a.id}/><input type="hidden" name="validade" value={a.validade}/>
            {!optou && <button className="btn-contorno px-3 py-2" name="evento" value="nao_renovar">Registrar não renovação</button>}
            {Date.now() < Date.parse(a.aceite_at)+7*86400000 && <button name="evento" value="desistencia" className="btn-contorno px-3 py-2">Desistir deste contrato no prazo de 7 dias</button>}
          </form>}
      </article>;
    })}
    <nav className="flex gap-4">{pagina>1 && <Link href={`?pagina=${pagina-1}`}>Anterior</Link>}{imoveis.data.length>20 && <Link href={`?pagina=${pagina+1}`}>Próxima</Link>}</nav>
  </main>;
}
