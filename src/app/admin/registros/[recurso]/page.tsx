import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Database } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { recursoPorId } from "@/lib/registros";
import { CabecalhoPagina, Vazio } from "@/components/ui/Pagina";
import { aba, CAMPO_COMPACTO } from "@/components/admin/estilos";
import Registros, { type Linha, type Opcoes } from "@/components/admin/Registros";

/** Tela de qualquer cadastro da Central (src/lib/registros.ts). */
export default async function PaginaRegistro({ params, searchParams }: PageProps<"/admin/registros/[recurso]">) {
  const { recurso } = await params;
  const r = recursoPorId(recurso);
  if (!r) notFound();
  const user = await exigirEquipe();
  if (!r.ler.some((s) => user.setores.includes(s))) redirect(`/admin?sem_acesso=${r.ler[0]}`);
  const podeEscrever = r.escrever.some((s) => user.setores.includes(s));

  const sp = await searchParams;
  const filtro = typeof sp.status === "string" ? sp.status : r.status?.abertos ? "abertos" : "todos";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const admin = supabaseAdmin();

  let consulta = admin.from(r.tabela).select("*").order(r.ordem.coluna, { ascending: !!r.ordem.asc }).limit(300);
  if (r.status && filtro === "abertos" && r.status.abertos) consulta = consulta.in(r.status.coluna, r.status.abertos);
  else if (r.status && filtro !== "todos") consulta = consulta.eq(r.status.coluna, filtro);
  if (q && r.busca?.length) {
    const termo = q.replace(/[%,()]/g, " ");
    consulta = consulta.or(r.busca.map((c) => `${c}.ilike.%${termo}%`).join(","));
  }
  const { data, error } = await consulta;
  if (error) {
    return (
      <div className="max-w-4xl space-y-6">
        <CabecalhoPagina eyebrow={r.eyebrow} titulo={r.titulo} />
        <Vazio icone={Database} titulo="Falta atualizar o banco" texto="Este cadastro precisa da migration do módulo. Depois de rodá-la, a tela aparece." />
      </div>
    );
  }

  // opções dos campos que apontam para outra tabela ou para a equipe
  const opcoes: Opcoes = {};
  await Promise.all(r.campos.map(async (c) => {
    if (c.tipo === "ref" && c.ref) {
      const ref = c.ref;
      let q2 = admin.from(ref.tabela).select(`id, ${ref.rotulo}${ref.extra ? `, ${ref.extra}` : ""}`).order(ref.rotulo).limit(800);
      if (ref.filtroAtivo) q2 = q2.eq("ativo", true);
      if (ref.filtro) q2 = q2.in(ref.filtro.coluna, ref.filtro.valores);
      const { data: ops } = await q2;
      opcoes[c.nome] = ((ops ?? []) as unknown as Record<string, unknown>[]).map((o) => ({
        id: String(o.id), rotulo: String(o[ref.rotulo] ?? "") + (ref.extra && o[ref.extra] ? ` · ${String(o[ref.extra]).slice(0, 60)}` : ""),
      }));
      // linhas antigas podem apontar para registro fora do filtro: o rótulo ainda aparece
      const faltando = [...new Set(((data ?? []) as Record<string, unknown>[]).map((l) => l[c.nome]).filter((v): v is string => typeof v === "string"))]
        .filter((id) => !opcoes[c.nome].some((o) => o.id === id));
      if (faltando.length) {
        const { data: extra } = await admin.from(ref.tabela).select(`id, ${ref.rotulo}`).in("id", faltando.slice(0, 200));
        for (const o of (extra ?? []) as unknown as Record<string, unknown>[]) opcoes[c.nome].push({ id: String(o.id), rotulo: String(o[ref.rotulo] ?? "") });
      }
    }
  }));
  const precisaEquipe = r.autorColuna || r.campos.some((c) => c.tipo === "membro");
  const nomes: Record<string, string> = {};
  if (precisaEquipe) {
    const { data: eq } = await admin.from("profiles").select("user_id, nome")
      .in("role", ["admin_central", "analista_arini"]).order("nome");
    for (const m of eq ?? []) nomes[m.user_id] = m.nome || "—";
    for (const c of r.campos.filter((x) => x.tipo === "membro")) {
      opcoes[c.nome] = (eq ?? []).map((m) => ({ id: m.user_id, rotulo: m.nome || "—" }));
    }
  }

  const abas = r.status ? [
    ...(r.status.abertos ? [["abertos", "Em aberto"]] : []),
    ...Object.entries(r.status.rotulos),
    ["todos", "Todos"],
  ] : [];
  const href = (s: string) => `/admin/registros/${r.id}?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="max-w-6xl space-y-6">
      <CabecalhoPagina eyebrow={r.eyebrow} titulo={r.titulo} subtitulo={r.descricao} />
      <div className="flex flex-wrap items-center gap-2">
        {abas.map(([s, rot]) => <Link key={s} href={href(s)} className={aba(filtro === s)}>{rot}</Link>)}
        {r.busca?.length ? (
          <form className="ml-auto">
            {filtro && <input type="hidden" name="status" value={filtro} />}
            <input name="q" defaultValue={q} placeholder="Buscar…" className={CAMPO_COMPACTO + " w-56"} />
          </form>
        ) : null}
      </div>
      <Registros recursoId={r.id} linhas={(data ?? []) as Linha[]} opcoes={opcoes} podeEscrever={podeEscrever} nomes={nomes} />
    </div>
  );
}
