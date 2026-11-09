import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { formatBRL } from "@/lib/format";
import { Building2, ImageOff, PenLine, SearchX, Users } from "lucide-react";
import { Etiqueta } from "@/components/ui/Pagina";
import { CabecalhoSetor, Indicadores, Secao, TarefasDoSetor } from "@/components/admin/Painel";
import { CODIGO, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";

import { LEAD_ORIGEM_LABEL as ORIGEM } from "@/lib/funil";
import { lerEmLotes } from "@/lib/supabase/lotes";

/** linhas na tabela de material; os indicadores contam todos */
const MAX_TABELA = 100;

/**
 * Marketing: de onde vêm os interessados, o que mais atrai e que material de
 * divulgação cada imóvel já tem (tour, vídeo, link curto).
 */
export default async function PainelMarketing() {
  const user = await exigirSetor("marketing");
  const admin = supabaseAdmin();
  const ha30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const ha90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  // em lotes: o PostgREST corta cada pedido em 1000 linhas sem avisar, e aqui
  // tudo vira contagem (origem, campanha, interessados por imóvel)
  const [{ data: leads }, { data: imoveis }, { data: apresentacoes }] = await Promise.all([
    lerEmLotes<{ property_id: string; origem: string; canal: string | null; utm: unknown; created_at: string }>((de, ate) =>
      admin.from("leads").select("property_id, origem, canal, utm, created_at").gte("created_at", ha90).order("id").range(de, ate)),
    lerEmLotes((de, ate) => admin.from("properties")
      .select("id, codigo, titulo, tipo, valor, published_at, municipality:municipalities!properties_municipality_id_fkey(nome), media:property_media(id)")
      .in("status", ["publicado", "em_negociacao"]).order("published_at", { ascending: false }).order("id").range(de, ate)),
    lerEmLotes<{ property_id: string; tipo: string; status: string }>((de, ate) =>
      admin.from("presentations").select("property_id, tipo, status").order("id").range(de, ate)),
  ]);

  const leads30 = (leads ?? []).filter((l) => l.created_at >= ha30);
  const porOrigem = new Map<string, number>();
  const porCampanha = new Map<string, number>();
  const porImovel = new Map<string, number>();
  for (const l of leads ?? []) {
    const utm = (l.utm ?? {}) as Record<string, string>;
    const origem = utm.utm_source || l.canal || l.origem || "direto";
    porOrigem.set(origem, (porOrigem.get(origem) ?? 0) + 1);
    if (utm.utm_campaign) porCampanha.set(utm.utm_campaign, (porCampanha.get(utm.utm_campaign) ?? 0) + 1);
    porImovel.set(l.property_id, (porImovel.get(l.property_id) ?? 0) + 1);
  }
  const maior = Math.max(1, ...porOrigem.values());
  const ordenado = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

  const material = new Map<string, { tour: boolean; video: string }>();
  for (const a of apresentacoes ?? []) {
    const m = material.get(a.property_id) ?? { tour: false, video: "—" };
    if (a.tipo === "tour3d" && a.status === "pronto") m.tour = true;
    if (a.tipo === "video") m.video = a.status === "pronto" ? "pronto" : a.status === "erro" ? "falhou" : "na fila";
    material.set(a.property_id, m);
  }

  const lista = (imoveis ?? []).map((p) => ({
    ...p, leads: porImovel.get(p.id) ?? 0, fotos: (p.media as unknown as { id: string }[] | null)?.length ?? 0,
    material: material.get(p.id) ?? { tour: false, video: "—" },
  }));
  const semFoto = lista.filter((p) => p.fotos === 0).length;
  const semProcura = lista.filter((p) => p.leads === 0).length;

  return (
    <div className="space-y-10 md:space-y-12">
      <CabecalhoSetor setor="marketing">
        <Link href="/admin/configuracoes" className="btn-contorno inline-flex items-center gap-2 px-4 py-2.5 text-sm"><PenLine className="size-4" /> Textos do site</Link>
      </CabecalhoSetor>

      <Indicadores itens={[
        { rotulo: "Imóveis no ar", icone: Building2, valor: lista.length },
        { rotulo: "Interessados em 30 dias", icone: Users, valor: leads30.length, nota: `${(leads ?? []).length} em 90 dias` },
        { rotulo: "Imóveis sem foto", icone: ImageOff, valor: semFoto, destaque: semFoto > 0 },
        { rotulo: "Sem nenhum interessado em 90 dias", icone: SearchX, valor: semProcura, destaque: semProcura > 0 && lista.length > 0 },
      ]} />

      <div className="grid gap-10 lg:gap-6 lg:grid-cols-2">
        <Secao titulo="De onde vieram os interessados (90 dias)">
          <div className="cartao p-6 space-y-3">
            {ordenado(porOrigem).map(([o, n]) => (
              <div key={o} className="grid grid-cols-[8rem_1fr_2.5rem] sm:grid-cols-[10rem_1fr_3rem] items-center gap-4 text-[0.95rem]">
                <span className="text-texto-2 truncate">{ORIGEM[o] ?? o}</span>
                <span className="h-2.5 rounded-full bg-superficie-2 overflow-hidden">
                  <span className="block h-full rounded-full bg-ouro" style={{ width: `${(n / maior) * 100}%` }} />
                </span>
                <span className="lp-display text-right text-lg leading-none tabular-nums text-texto">{n}</span>
              </div>
            ))}
            {!porOrigem.size && <p className="py-6 text-center text-[0.95rem] text-texto-2">Nenhum interessado no período.</p>}
          </div>
        </Secao>

        <Secao titulo="Campanhas (links com UTM)">
          <div className="cartao p-6 space-y-1 text-[0.95rem]">
            {ordenado(porCampanha).slice(0, 8).map(([c, n]) => (
              <p key={c} className="flex justify-between gap-3 border-b border-linha py-2.5 last:border-0"><span className="text-texto-2 truncate">{c}</span><span className="font-semibold tabular-nums text-texto">{n}</span></p>
            ))}
            {!porCampanha.size && (
              <p className="leading-relaxed text-texto-2">
                Nenhum interessado chegou por link de campanha. Para medir um anúncio, divulgue o link do imóvel com
                <span className="font-mono text-xs"> ?utm_source=instagram&utm_campaign=nome-da-campanha</span> no final.
              </p>
            )}
          </div>
        </Secao>
      </div>

      <Secao titulo="Imóveis no ar e material de divulgação">
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead>
              <tr className={THEAD}>
                <th className={TH}>Imóvel</th>
                <th className={TH + " text-right"}>Interessados</th>
                <th className={TH + " text-right"}>Fotos</th>
                <th className={TH}>Tour 3D</th>
                <th className={TH}>Vídeo</th>
                <th className={TH}>Link para divulgar</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {lista.sort((a, b) => b.leads - a.leads).slice(0, MAX_TABELA).map((p) => (
                <tr key={p.id} className={TR}>
                  <td className="px-4 py-3.5">
                    <Link href={`/imovel/${p.codigo}`} target="_blank" className="font-medium text-texto hover:text-verde">{p.titulo}</Link>
                    <span className="mt-0.5 block text-sm text-texto-2">
                      {(p.municipality as unknown as { nome: string } | null)?.nome} · {formatBRL(p.valor)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums">{p.leads}</td>
                  <td className={"px-4 py-3.5 text-right tabular-nums " + (p.fotos === 0 ? "font-semibold text-critico" : "")}>{p.fotos}</td>
                  <td className="px-4 py-3.5 text-sm font-semibold">
                    {p.material.tour
                      ? <Link href={`/imovel/${p.codigo}/tour`} target="_blank" className="text-verde hover:underline">abrir</Link>
                      : <span className="text-texto-2">—</span>}
                  </td>
                  <td className={TD}>
                    {p.material.video === "—"
                      ? <span className="text-texto-2">—</span>
                      : <Etiqueta tom={p.material.video === "pronto" ? "verde" : p.material.video === "falhou" ? "critico" : "neutro"}>{p.material.video}</Etiqueta>}
                  </td>
                  <td className={"px-4 py-3.5 select-all whitespace-nowrap " + CODIGO}>{site}/i/{p.codigo}</td>
                </tr>
              ))}
              {!lista.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-texto-2">Nenhum imóvel publicado ainda.</td></tr>}
            </tbody>
          </table>
        </div>
        {lista.length > MAX_TABELA && (
          <p className="text-sm text-texto-2">
            Mostrando {MAX_TABELA} de {lista.length} imóveis no ar (os com mais interessados primeiro). Os indicadores acima contam todos.
          </p>
        )}
        <p className="text-sm text-texto-2">
          O vídeo é gerado pelo serviço de vídeo do servidor; “na fila” significa que ele ainda não processou o imóvel.
        </p>
      </Secao>

      <TarefasDoSetor setor="marketing" souEu={user.id} />
    </div>
  );
}
