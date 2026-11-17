import Link from "next/link";
import { Contact, Mail, Phone, Search } from "lucide-react";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina, Etiqueta, Vazio } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR, aba } from "@/components/admin/estilos";
import { equipeAtiva } from "@/components/admin/Painel";
import { carteira } from "@/lib/crm-clientes";
import { TEMPERATURA_LABEL, TEMPERATURA_TOM, soDigitos, type Temperatura } from "@/lib/crm-comercial";

/** Carteira de clientes do Comercial: cada pessoa com todas as oportunidades dela. */
export default async function Clientes({ searchParams }: PageProps<"/admin/clientes">) {
  const user = await exigirSetor("comercial");
  const sp = await searchParams;
  const busca = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 80) : "";
  const meus = sp.meus === "1";
  const ativos = sp.ativos === "1";
  const [{ clientes, semCrm }, equipe] = await Promise.all([carteira(), equipeAtiva()]);
  const nome = new Map(equipe.map((m) => [m.user_id, m.nome]));
  const d = soDigitos(busca);
  const lista = clientes.filter((c) =>
    (!busca || c.nome.toLowerCase().includes(busca) || (c.email ?? "").includes(busca) || (d.length >= 4 && soDigitos(c.telefone).includes(d))
      || c.etiquetas.some((t) => t.includes(busca)))
    && (!meus || c.responsavel === user.id)
    && (!ativos || c.abertas > 0));
  const mostrar = lista.slice(0, 300);
  const href = (extra: Record<string, string>) => {
    const u = new URLSearchParams(Object.entries({ q: busca, meus: meus ? "1" : "", ativos: ativos ? "1" : "", ...extra }).filter(([, v]) => v));
    return `/admin/clientes${u.size ? `?${u}` : ""}`;
  };

  return (
    <div className="max-w-6xl space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Carteira de clientes"
        subtitulo="Cada cliente reúne todas as oportunidades dele (mesmo telefone ou e-mail). Quem volta pelo site cai na mesma ficha e, com a carteira ligada no rodízio, com o mesmo corretor." />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ meus: "", ativos: "" })} className={aba(!meus && !ativos)}>Todos ({clientes.length})</Link>
        <Link href={href({ meus: "1" })} className={aba(meus)}>Minha carteira</Link>
        <Link href={href({ ativos: "1" })} className={aba(ativos)}>Com negociação aberta</Link>
        <form action="/admin/clientes" className="ml-auto flex items-center gap-2">
          {meus && <input type="hidden" name="meus" value="1" />}
          {ativos && <input type="hidden" name="ativos" value="1" />}
          <input name="q" defaultValue={busca} placeholder="Nome, telefone, e-mail ou etiqueta" className={CAMPO_COMPACTO + " w-72"} aria-label="Buscar cliente" />
          <button className="lp-btn lp-btn-verde !px-3 !py-2 text-sm" aria-label="Buscar"><Search className="size-4" /></button>
        </form>
      </div>
      {semCrm && <p className="text-sm text-alerta">Corretor, temperatura e etiquetas aparecem depois da migration 0147.</p>}
      {!mostrar.length ? (
        <Vazio icone={Contact} titulo="Nenhum cliente" texto={busca ? "Nada com essa busca." : "Os clientes aparecem conforme os leads chegam."} />
      ) : (
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead className={THEAD}>
              <tr><th className={TH}>Cliente</th><th className={TH}>Contato</th><th className={TH}>Negociações</th><th className={TH}>Corretor</th><th className={TH}>Última movimentação</th></tr>
            </thead>
            <tbody className={TBODY}>
              {mostrar.map((c) => (
                <tr key={c.chave} className={TR}>
                  <td className={TD}>
                    <Link href={`/admin/clientes/${encodeURIComponent(c.chave)}`} className="font-semibold text-texto hover:text-verde">{c.nome}</Link>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.temperatura && <Etiqueta tom={TEMPERATURA_TOM[c.temperatura as Temperatura]}>{TEMPERATURA_LABEL[c.temperatura as Temperatura]}</Etiqueta>}
                      {c.etiquetas.slice(0, 4).map((t) => <Etiqueta key={t}>{t}</Etiqueta>)}
                    </div>
                  </td>
                  <td className={TD + " text-sm text-texto-2"}>
                    {c.telefone && <p className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{c.telefone}</p>}
                    {c.email && <p className="inline-flex items-center gap-1.5"><Mail className="size-3.5" />{c.email}</p>}
                  </td>
                  <td className={TD + " tabular-nums"}>
                    {c.oportunidades.length}
                    {c.abertas > 0 && <span className="ml-2 text-xs text-ouro">{c.abertas} aberta(s)</span>}
                    {c.ganhas > 0 && <span className="ml-2 text-xs text-verde">{c.ganhas} fechada(s)</span>}
                  </td>
                  <td className={TD + " text-sm"}>{c.responsavel ? nome.get(c.responsavel) ?? "equipe" : "—"}</td>
                  <td className={TD + " text-xs text-texto-2 tabular-nums"}>{new Date(c.ultimo).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lista.length > mostrar.length && <p className="text-sm text-texto-2">Mostrando 300 de {lista.length}. Refine a busca.</p>}
    </div>
  );
}
