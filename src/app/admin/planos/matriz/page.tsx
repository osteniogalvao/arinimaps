import Link from "next/link";
import { redirect } from "next/navigation";
import { CabecalhoPagina, CAMPO } from "@/components/ui/Pagina";
import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";

const personas = {
  proprietario: "Proprietário", corretor_imobiliaria: "Corretor ou imobiliária", produtor_rural: "Produtor rural",
  engenheiro: "Profissional técnico", comprador_investidor: "Comprador ou investidor", leiloeiro: "Leiloeiro",
  ente_publico: "Órgão público", empresa_holding: "Empresa ou incorporadora",
};
const classes: Record<string,string> = {
  C:"Consulta", O:"Operação", M:"Comercialização", G:"Gestão", L:"Consulta pública limitada", P:"Contratação específica", "—":"Bloqueado",
};
const natureza: Record<string,string> = { F:"Função da persona", I:"Operação interna", X:"Integração", N:"Modelo de negócio" };

export default async function Matriz({ searchParams }: PageProps<"/admin/planos/matriz">) {
  const a = await ator();
  if (!a) redirect("/entrar");
  if (!temSetor(a, "diretoria")) redirect("/admin?sem_acesso=diretoria");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0,120) : "";
  const persona = typeof sp.persona === "string" && Object.hasOwn(personas,sp.persona) ? sp.persona as keyof typeof personas : "proprietario";
  const classe = typeof sp.classe === "string" && Object.hasOwn(classes,sp.classe) ? sp.classe : "";
  const pagina = Math.max(1, Math.min(1000, Math.floor(Number(sp.pagina) || 1)));
  const inicio = (pagina - 1) * 30;
  let consulta = supabaseAdmin().from("matriz_personas").select("id,titulo,natureza,modulo,subsecao,permissoes", { count: "exact" });
  if (q) consulta = /^\d+$/.test(q) ? consulta.eq("id", Number(q)) : consulta.ilike("titulo","%" + q + "%");
  if (classe) consulta = consulta.contains("permissoes", { [persona]: classe });
  const { data, error, count } = await consulta.order("id").range(inicio, inicio+29);
  function link(n: number) { return "?" + new URLSearchParams({ q, persona, classe, pagina:String(n) }); }
  return <div className="mx-auto max-w-[1280px] space-y-6">
    <CabecalhoPagina titulo="Matriz de acessos por persona" eyebrow="Central · Diretoria"
      subtitulo="Consulte a classificação prevista nos documentos do Carlos. As liberações efetivas de cada conta dependem dos recursos implementados, do plano e do vínculo com os dados." />
    <form className="cartao grid items-end gap-4 p-5 md:grid-cols-4">
      <label>Buscar item<input defaultValue={q} className={CAMPO} name="q" maxLength={120} placeholder="Número ou título" /></label>
      <label>Persona<select className={CAMPO} defaultValue={persona} name="persona">{Object.entries(personas).map(([id,nome]) => <option key={id} value={id}>{nome}</option>)}</select></label>
      <label>Acesso previsto<select className={CAMPO} defaultValue={classe} name="classe"><option value="">Todos</option>{Object.entries(classes).map(([id,nome]) => <option key={id} value={id}>{nome}</option>)}</select></label>
      <button className="lp-btn lp-btn-verde" type="submit">Aplicar filtros</button>
    </form>
    {error ? <p role="alert">A matriz está indisponível. Tente novamente.</p> : <>
      <p>{count ?? 0} itens encontrados para {personas[persona]}.</p>
      <div className="cartao divide-y divide-linha">{(data ?? []).map((item) => <article key={item.id} className="p-4">
        <p className="text-xs text-texto-2">{item.modulo} · {item.subsecao}</p>
        <h2 className="mt-1 font-semibold">{item.id}. {item.titulo}</h2>
        <p className="text-sm">{natureza[item.natureza]} · {classes[item.permissoes[persona]]}</p>
      </article>)}</div>
      <nav className="flex gap-5" aria-label="Paginação da matriz">
        {pagina > 1 && <Link href={link(pagina-1)}>Anterior</Link>}
        <span>Página {pagina}</span>{inicio+30 < (count ?? 0) && <Link href={link(pagina+1)}>Próxima</Link>}
      </nav>
    </>}
  </div>;
}
