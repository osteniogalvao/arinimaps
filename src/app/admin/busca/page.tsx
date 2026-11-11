import Link from "next/link";
import { Search } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import type { SetorId } from "@/lib/setores";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO, LISTA, LINHA_LISTA, LISTA_VAZIA } from "@/components/admin/estilos";

type Achado = { grupo: string; titulo: string; detalhe: string; href: string };

/**
 * Busca universal da Central: imóveis, leads e oportunidades, tarefas,
 * despesas, notas fiscais e itens de CRM, cada grupo só para quem atua no
 * setor dono dele.
 */
export default async function Busca({ searchParams }: PageProps<"/admin/busca">) {
  const user = await exigirEquipe();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const tem = (...s: SetorId[]) => s.some((x) => user.setores.includes(x));
  const achados: Achado[] = [];

  if (q.length >= 2) {
    const admin = supabaseAdmin();
    const t = q.replace(/[%,()*]/g, " ");
    const like = `%${t}%`;
    const digitos = q.replace(/\D/g, "");
    const buscas: Promise<void>[] = [];
    if (tem("operacoes", "comercial", "marketing", "cartografia", "juridico")) {
      buscas.push((async () => {
        const { data } = await admin.from("properties").select("id, codigo, titulo, status").or(`codigo.ilike.${like},titulo.ilike.${like}`).limit(10);
        for (const p of data ?? []) achados.push({ grupo: "Imóveis", titulo: p.titulo || p.codigo, detalhe: `${p.codigo} · ${p.status}`, href: `/admin/imoveis/${p.id}` });
      })());
    }
    if (tem("comercial")) {
      buscas.push((async () => {
        const filtros = [`nome.ilike.${like}`, `email.ilike.${like}`];
        if (digitos.length >= 4) filtros.push(`telefone.ilike.%${digitos}%`);
        const { data: leads } = await admin.from("leads").select("id, nome, telefone").or(filtros.join(",")).limit(10);
        const ids = (leads ?? []).map((l) => l.id);
        const { data: opps } = await admin.from("opportunities").select("id, codigo, lead_id, etapa")
          .or([`codigo.ilike.${like}`, ...(ids.length ? [`lead_id.in.(${ids.join(",")})`] : [])].join(",")).limit(15);
        for (const o of opps ?? []) {
          const l = (leads ?? []).find((x) => x.id === o.lead_id);
          achados.push({ grupo: "Oportunidades", titulo: l?.nome ?? o.codigo, detalhe: `${o.codigo} · ${o.etapa}${l?.telefone ? ` · ${l.telefone}` : ""}`, href: `/admin/oportunidades/${o.id}` });
        }
      })());
    }
    buscas.push((async () => {
      let tq = admin.from("tasks").select("id, codigo, titulo, setor, status").or(`titulo.ilike.${like},codigo.ilike.${like}`).limit(10);
      if (!user.setores.includes("diretoria")) tq = tq.in("setor", user.setores);
      const { data } = await tq;
      for (const x of data ?? []) achados.push({ grupo: "Tarefas", titulo: x.titulo, detalhe: `${x.codigo ?? ""} · ${x.status}`, href: `/admin/tarefas/${x.id}` });
    })());
    if (tem("financeiro", "diretoria")) {
      buscas.push((async () => {
        const { data } = await admin.from("despesas").select("id, codigo, descricao, status").or(`descricao.ilike.${like},codigo.ilike.${like}`).limit(8);
        for (const x of data ?? []) achados.push({ grupo: "Despesas", titulo: x.descricao, detalhe: `${x.codigo} · ${x.status}`, href: `/admin/registros/despesas?status=todos&q=${encodeURIComponent(x.codigo)}` });
        const { data: nf } = await admin.from("notas_fiscais").select("id, codigo, tomador_nome, status").or(`tomador_nome.ilike.${like},codigo.ilike.${like}`).limit(8);
        for (const x of nf ?? []) achados.push({ grupo: "Notas fiscais", titulo: x.tomador_nome, detalhe: `${x.codigo} · ${x.status}`, href: `/admin/registros/notas-fiscais?status=todos&q=${encodeURIComponent(x.codigo)}` });
      })());
    }
    buscas.push((async () => {
      const { data } = await admin.from("crm_itens").select("id, codigo, titulo, pipeline:crm_pipelines(nome, setor)").or(`titulo.ilike.${like},codigo.ilike.${like}`).limit(10);
      for (const x of data ?? []) {
        const p = x.pipeline as unknown as { nome: string; setor: string } | null;
        if (p && !tem(p.setor as SetorId)) continue;
        achados.push({ grupo: "CRMs dos setores", titulo: x.titulo, detalhe: `${x.codigo} · ${p?.nome ?? ""}`, href: `/admin/crm/item/${x.id}` });
      }
    })());
    await Promise.all(buscas.map((b) => b.catch(() => undefined)));
  }
  const grupos = [...new Set(achados.map((a) => a.grupo))];

  return (
    <div className="max-w-4xl space-y-6">
      <CabecalhoPagina eyebrow="Central" titulo="Buscar em tudo" subtitulo="Código, nome, telefone ou título. Cada resultado só aparece para quem atua no setor dele." />
      <form className="flex gap-2">
        <input name="q" defaultValue={q} autoFocus placeholder="AIB-000123, OP-000045, nome do cliente, telefone…" className={CAMPO_COMPACTO + " flex-1 !py-3 !text-base"} />
        <button className="btn-verde inline-flex items-center gap-2 px-5"><Search className="size-4" /> Buscar</button>
      </form>
      {q.length >= 2 && !achados.length && <p className={LISTA_VAZIA}>Nada encontrado para “{q}”.</p>}
      {grupos.map((g) => (
        <section key={g} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-texto-2">{g}</h2>
          <div className={LISTA}>
            {achados.filter((a) => a.grupo === g).map((a, i) => (
              <Link key={i} href={a.href} className={LINHA_LISTA}>
                <span className="min-w-0 flex-1 font-medium text-texto">{a.titulo}</span>
                <span className="text-xs text-texto-2">{a.detalhe}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
