import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { formatBRL, STATUS_LABEL } from "@/lib/format";
import { termoBusca } from "@/components/admin/BuscaLista";
import { CabecalhoPagina, Etiqueta, Vazio } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO, CODIGO, TABELA, TABELA_CAIXA, TBODY, TH, THEAD, TR } from "@/components/admin/estilos";
import Resumo from "@/components/admin/Resumo";
import { ExternalLink, Search } from "lucide-react";

export const metadata = { title: "Consulta de imóveis" };

const DISPONIVEIS = ["aprovado", "publicado", "em_negociacao"];
const MAX = 200;

/**
 * Consulta rápida de imóveis disponíveis (tela da recepção no CRM da Arini
 * Negócios): quem atende o cliente acha o imóvel por código, nome, tipo,
 * município ou faixa de valor e abre o anúncio para mandar ao cliente.
 */
export default async function ConsultaImoveis({ searchParams }: PageProps<"/admin/consulta-imoveis">) {
  await exigirSetor("comercial", "operacoes", "marketing");
  const sp = await searchParams;
  const q = termoBusca(sp.q);
  const tipo = sp.tipo === "urbano" || sp.tipo === "rural" ? sp.tipo : "";
  const mun = typeof sp.municipio === "string" && /^[0-9a-f-]{36}$/i.test(sp.municipio) ? sp.municipio : "";
  const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/\D/g, "")); return n > 0 ? n : null; };
  const min = num(sp.min), max = num(sp.max);
  const admin = supabaseAdmin();

  let c = admin.from("properties")
    .select("id, codigo, titulo, tipo, status, valor, municipality:municipalities!properties_municipality_id_fkey(id, nome)", { count: "exact" })
    .eq("demonstracao", false).in("status", DISPONIVEIS);
  if (q) c = c.or(`codigo.ilike.%${q}%,titulo.ilike.%${q}%`);
  if (tipo) c = c.eq("tipo", tipo);
  if (mun) c = c.eq("municipality_id", mun);
  if (min) c = c.gte("valor", min);
  if (max) c = c.lte("valor", max);
  const contar = (t: string) => admin.from("properties").select("id", { count: "exact", head: true })
    .eq("demonstracao", false).in("status", DISPONIVEIS).eq("tipo", t).then((r) => r.count ?? 0);
  const [{ data, count }, urbanos, rurais, { data: municipios }] = await Promise.all([
    c.order("created_at", { ascending: false }).limit(MAX),
    contar("urbano"), contar("rural"),
    admin.from("municipalities").select("id, nome").eq("ativo", true).order("nome").limit(500),
  ]);
  const lista = (data ?? []) as unknown as { id: string; codigo: string; titulo: string; tipo: string; status: string; valor: number | null; municipality: { nome: string } | null }[];

  return (
    <div className="space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Consulta de imóveis"
        subtitulo="Imóveis disponíveis para oferecer ao cliente. Abra o anúncio para mandar o link." />
      <Resumo itens={[
        { rotulo: "Disponíveis", valor: urbanos + rurais, tom: "verde", href: "/admin/consulta-imoveis" },
        { rotulo: "Urbanos", valor: urbanos, href: "/admin/consulta-imoveis?tipo=urbano", ativo: tipo === "urbano" },
        { rotulo: "Rurais", valor: rurais, href: "/admin/consulta-imoveis?tipo=rural", ativo: tipo === "rural" },
      ]} />
      <form className="cartao grid gap-3 p-4 md:grid-cols-6" role="search">
        <label className="relative md:col-span-2">
          <span className="sr-only">Código ou nome</span>
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-2" />
          <input name="q" defaultValue={q} placeholder="Código ou nome do imóvel" className={CAMPO_COMPACTO + " w-full pl-9"} />
        </label>
        <select name="tipo" defaultValue={tipo} aria-label="Tipo" className={CAMPO_COMPACTO}>
          <option value="">Urbano e rural</option><option value="urbano">Urbano</option><option value="rural">Rural</option>
        </select>
        <select name="municipio" defaultValue={mun} aria-label="Município" className={CAMPO_COMPACTO}>
          <option value="">Todos os municípios</option>
          {(municipios ?? []).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
        <input name="min" defaultValue={min ?? ""} inputMode="numeric" placeholder="Valor mínimo (R$)" aria-label="Valor mínimo" className={CAMPO_COMPACTO} />
        <input name="max" defaultValue={max ?? ""} inputMode="numeric" placeholder="Valor máximo (R$)" aria-label="Valor máximo" className={CAMPO_COMPACTO} />
        <div className="flex gap-2 md:col-span-6">
          <button className="btn-verde px-5 py-2 text-sm">Filtrar</button>
          <Link href="/admin/consulta-imoveis" className="btn-contorno px-5 py-2 text-sm">Limpar</Link>
        </div>
      </form>
      {count != null && count > lista.length && <p className="text-sm text-texto-2">Mostrando {lista.length} de {count}. Refine os filtros para achar os demais.</p>}
      {!lista.length ? <Vazio icone={Search} titulo="Nenhum imóvel disponível com esses filtros" /> : (
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead><tr className={THEAD}>
              <th className={TH}>Código</th><th className={TH}>Imóvel</th><th className={TH}>Município</th>
              <th className={TH}>Valor</th><th className={TH}>Situação</th><th className={TH}></th>
            </tr></thead>
            <tbody className={TBODY}>
              {lista.map((p) => (
                <tr key={p.id} className={TR}>
                  <td className={"px-4 py-3.5 whitespace-nowrap " + CODIGO}>{p.codigo}</td>
                  <td className="px-4 py-3.5 font-medium text-texto">{p.titulo}<span className="ml-2 text-xs font-normal text-texto-2 capitalize">({p.tipo})</span></td>
                  <td className="px-4 py-3.5">{p.municipality?.nome ?? "—"}</td>
                  <td className="px-4 py-3.5 tabular-nums whitespace-nowrap">{formatBRL(p.valor)}</td>
                  <td className="px-4 py-3.5"><Etiqueta tom={p.status === "em_negociacao" ? "ouro" : "verde"}>{STATUS_LABEL[p.status]}</Etiqueta></td>
                  <td className="px-4 py-3.5 text-right">
                    <a href={`/imovel/${encodeURIComponent(p.codigo)}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-verde hover:underline underline-offset-4">
                      Ver anúncio <ExternalLink className="size-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
