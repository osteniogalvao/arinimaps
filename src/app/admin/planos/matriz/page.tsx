import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CabecalhoPagina, CAMPO } from "@/components/ui/Pagina";
import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";

import { PERSONAS_MATRIZ as personas, NIVEIS_MATRIZ as classes, FASES_MATRIZ, DISPOSICOES_MATRIZ } from "@/lib/direitos-persona";

async function configurarPlano(form: FormData) {
  "use server";
  const a = await ator();
  if (!a || a.role !== "admin_central") redirect("/admin?sem_acesso=diretoria");
  const item = Number(form.get("item"));
  const plano = String(form.get("plano") ?? "");
  const regra = String(form.get("regra") ?? "");
  const filtros = new URLSearchParams({ plano, q: String(item), persona: String(form.get("persona") ?? "") });
  let falhou = true;
  if (Number.isInteger(item) && item >= 1 && item <= 915 && plano.length < 80 && ["padrao", "liberar", "bloquear"].includes(regra)) {
    const { error } = await supabaseAdmin().rpc("fn_configurar_direito_plano", {
      p_admin: a.userId, p_plano: plano, p_item: item, p_liberado: regra === "padrao" ? null : regra === "liberar",
    });
    falhou = !!error;
  }
  filtros.set("resultado", falhou ? "erro" : "salvo");
  revalidatePath("/admin/planos/matriz");
  redirect("/admin/planos/matriz?" + filtros);
}

export default async function Matriz({ searchParams }: PageProps<"/admin/planos/matriz">) {
  const a = await ator();
  if (!a) redirect("/entrar");
  if (!temSetor(a, "diretoria")) redirect("/admin?sem_acesso=diretoria");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0,120) : "";
  const persona = typeof sp.persona === "string" && Object.hasOwn(personas,sp.persona) ? sp.persona as keyof typeof personas : "proprietario";
  const classe = typeof sp.classe === "string" && Object.hasOwn(classes,sp.classe) ? sp.classe : "";
  const pagina = Math.max(1, Math.min(1000, Math.floor(Number(sp.pagina) || 1)));
  const fase = FASES_MATRIZ.includes(String(sp.fase)) ? String(sp.fase) : "";
  const disposicao = DISPOSICOES_MATRIZ.includes(String(sp.disposicao)) ? String(sp.disposicao) : "";
  const admin = supabaseAdmin();
  const { data: planos } = await admin.from("plans").select("id,nome").order("nome");
  const plano = planos?.some(p => p.id === sp.plano) ? String(sp.plano) : "";
  const inicio = (pagina - 1) * 30;
  let consulta = supabaseAdmin().from("matriz_personas").select("id,titulo,disposicao,fase,modulo,subsecao,permissoes,observacoes,canonico,futuro", { count: "exact" });
  if (q) consulta = /^\d+$/.test(q) ? consulta.eq("id", Number(q)) : consulta.ilike("titulo","%" + q + "%");
  if (classe) consulta = consulta.contains("permissoes", { [persona]: classe });
  if (fase) consulta = consulta.eq("fase", fase);
  if (disposicao) consulta = consulta.eq("disposicao", disposicao);
  const { data, error, count } = await consulta.order("id").range(inicio, inicio+29);
  const { data: ajustes, error: erroAjustes } = plano && data?.length
    ? await admin.from("plano_direitos_item").select("item_id,liberado").eq("plano_id", plano).in("item_id", data.map(i => i.id))
    : { data: [], error: null };
  const regras = new Map(ajustes?.map(r => [r.item_id, r.liberado as boolean]));
  function link(n: number) { return "?" + new URLSearchParams({ q, persona, classe, fase, disposicao, plano, pagina:String(n) }); }
  return <div className="mx-auto max-w-[1280px] space-y-6">
    <CabecalhoPagina titulo="Matriz de acessos por persona" eyebrow="Central · Diretoria"
      subtitulo="Anexo A · 915 itens e dez entradas. Selecione um plano para consultar ou configurar exceções por item. O acesso aos dados exige o vínculo correspondente." />
    <form className="cartao grid items-end gap-4 p-5 md:grid-cols-4">
      <label>Buscar item<input defaultValue={q} className={CAMPO} name="q" maxLength={120} placeholder="Número ou título" /></label>
      <label>Persona<select className={CAMPO} defaultValue={persona} name="persona">{Object.entries(personas).map(([id,nome]) => <option key={id} value={id}>{nome}</option>)}</select></label>
      <label>Acesso previsto<select className={CAMPO} defaultValue={classe} name="classe"><option value="">Todos</option>{Object.entries(classes).map(([id,nome]) => <option key={id} value={id}>{nome}</option>)}</select></label>
      <label>Fase<select className={CAMPO} defaultValue={fase} name="fase"><option value="">Todas</option>{FASES_MATRIZ.map(f => <option key={f}>{f}</option>)}</select></label>
      <label>Disposição<select className={CAMPO} defaultValue={disposicao} name="disposicao"><option value="">Todas</option>{DISPOSICOES_MATRIZ.map(d => <option key={d}>{d}</option>)}</select></label>
      <label>Plano<select className={CAMPO} name="plano" defaultValue={plano}><option value="">Matriz de referência</option>{planos?.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.id}</option>)}</select></label>
      <button className="lp-btn lp-btn-verde" type="submit">Aplicar filtros</button>
    </form>
    {sp.resultado === "salvo" && <p role="status">Regra do plano salva.</p>}
    {sp.resultado === "erro" && <p role="alert">Não foi possível alterar a regra do plano.</p>}
    {error || erroAjustes ? <p role="alert">A matriz está indisponível. Tente novamente.</p> : <>
      <p>{count ?? 0} itens encontrados para {personas[persona]}.</p>
      <div className="cartao divide-y divide-linha">{(data ?? []).map((item) => <article key={item.id} className="p-4">
        <p className="text-xs text-texto-2">{item.modulo} · {item.subsecao}</p>
        <h2 className="mt-1 font-semibold">{item.id}. {item.titulo}</h2>
        <p className="text-sm">{item.disposicao} · {item.fase} · {classes[item.permissoes[persona]]}</p>
        {item.observacoes && <p className="text-xs text-texto-2">{item.observacoes}</p>}
        {plano && item.disposicao === "Produto" && <>
          <p className="mt-1 text-sm">Regra do plano · {regras.get(item.id) === true ? "Liberar" : regras.get(item.id) === false ? "Bloquear" : "Padrão da persona e do pacote"}</p>
          {a.role === "admin_central" && item.permissoes[persona] !== "-" && ![1,15,20,48,59].includes(item.id) &&
            !(item.id >= 222 && item.id <= 238) && !(item.id >= 260 && item.id <= 289) &&
            <form action={configurarPlano} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="plano" value={plano}/><input type="hidden" name="item" value={item.id}/>
              <input type="hidden" name="persona" value={persona}/>
              <label className="text-sm">Ajuste em todo o plano<select name="regra" className={CAMPO} defaultValue={regras.get(item.id) === true ? "liberar" : regras.get(item.id) === false ? "bloquear" : "padrao"}>
                <option value="padrao">Usar padrão</option><option value="liberar">Liberar conforme a persona</option><option value="bloquear">Bloquear</option>
              </select></label><button type="submit" className="lp-btn lp-btn-verde">Salvar item {item.id}</button>
            </form>}
        </>}
      </article>)}</div>
      <nav className="flex gap-5" aria-label="Paginação da matriz">
        {pagina > 1 && <Link href={link(pagina-1)}>Anterior</Link>}
        <span>Página {pagina}</span>{inicio+30 < (count ?? 0) && <Link href={link(pagina+1)}>Próxima</Link>}
      </nav>
    </>}
  </div>;
}
