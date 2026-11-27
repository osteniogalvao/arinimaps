import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { STATUS_LABEL } from "@/lib/format";
import { CabecalhoPagina, Etiqueta, Vazio } from "@/components/ui/Pagina";
import { TABELA, TABELA_CAIXA, TBODY, TH, THEAD, TR } from "@/components/admin/estilos";
import BuscaLista, { termoBusca } from "@/components/admin/BuscaLista";
import Resumo from "@/components/admin/Resumo";
import LinhaLink from "@/components/admin/LinhaLink";
import { UsersRound } from "lucide-react";

export const metadata = { title: "Proprietários" };

const MAX = 300;
const ATIVOS = ["aprovado", "ativo"];
const EM_ANALISE = ["solicitado", "em_analise", "pendente"];
const IMOVEL_ATIVO = ["aprovado", "publicado", "em_negociacao"];

/**
 * Proprietários (tela do CRM da Arini Negócios, trazida para Operações):
 * quem é dono de imóvel na plataforma, contato, situação do cadastro e
 * quantos imóveis tem. A linha abre os imóveis daquele proprietário.
 */
export default async function Proprietarios({ searchParams }: PageProps<"/admin/proprietarios">) {
  await exigirSetor("operacoes", "comercial", "juridico");
  const sp = await searchParams;
  const q = termoBusca(sp.q);
  const admin = supabaseAdmin();

  const consulta = q
    ? admin.from("owners").select("id, status, created_at, profile:profiles!inner(nome, telefone)", { count: "exact" }).ilike("profile.nome", `%${q}%`)
    : admin.from("owners").select("id, status, created_at, profile:profiles(nome, telefone)", { count: "exact" });
  const [{ data: donos, count }, { count: ativos }, { count: analise }] = await Promise.all([
    consulta.order("created_at", { ascending: false }).limit(MAX),
    admin.from("owners").select("id", { count: "exact", head: true }).in("status", ATIVOS),
    admin.from("owners").select("id", { count: "exact", head: true }).in("status", EM_ANALISE),
  ]);
  const lista = (donos ?? []) as unknown as { id: string; status: string; created_at: string; profile: { nome: string; telefone: string | null } | null }[];

  // imóveis por proprietário (só dos que aparecem na tela)
  const porDono = new Map<string, { total: number; ativos: number }>();
  if (lista.length) {
    const { data: imoveis } = await admin.from("properties").select("owner_id, status")
      .in("owner_id", lista.map((d) => d.id)).eq("demonstracao", false).limit(5000);
    for (const i of imoveis ?? []) {
      const c = porDono.get(i.owner_id as string) ?? { total: 0, ativos: 0 };
      c.total++; if (IMOVEL_ATIVO.includes(i.status as string)) c.ativos++;
      porDono.set(i.owner_id as string, c);
    }
  }
  const comImovel = [...porDono.values()].filter((c) => c.total > 0).length;

  return (
    <div className="space-y-6">
      <CabecalhoPagina eyebrow="Operações" titulo="Proprietários"
        subtitulo="Donos de imóveis cadastrados, com contato, situação do cadastro e imóveis. Clique na linha para ver os imóveis." />
      <Resumo itens={[
        { rotulo: "Total", valor: count ?? lista.length },
        { rotulo: "Liberados", valor: ativos ?? 0, tom: "verde" },
        { rotulo: "Em análise", valor: analise ?? 0, tom: "ouro", href: "/admin/cadastros" },
        { rotulo: "Com imóvel (na lista)", valor: comImovel },
      ]} />
      <BuscaLista caminho="/admin/proprietarios" valor={q} placeholder="Buscar pelo nome" />
      {count != null && count > lista.length && <p className="text-sm text-texto-2">Mostrando {lista.length} de {count}. Use a busca para achar os demais.</p>}
      {!lista.length ? <Vazio icone={UsersRound} titulo={q ? "Ninguém com esse nome" : "Nenhum proprietário cadastrado"} /> : (
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead><tr className={THEAD}>
              <th className={TH}>Nome</th><th className={TH}>Telefone</th><th className={TH}>Cadastro</th>
              <th className={TH}>Imóveis</th><th className={TH}>Desde</th>
            </tr></thead>
            <tbody className={TBODY}>
              {lista.map((d) => {
                const c = porDono.get(d.id) ?? { total: 0, ativos: 0 };
                return (
                  <LinhaLink key={d.id} href={`/admin/imoveis?filtro=ativos&dono=${d.id}`} rotulo={`Imóveis de ${d.profile?.nome ?? "proprietário"}`} className={TR}>
                    <td className="px-4 py-3.5 font-medium text-texto">{d.profile?.nome || "Sem nome"}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {d.profile?.telefone
                        ? <a className="text-verde hover:underline" href={`https://wa.me/${d.profile.telefone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">{d.profile.telefone}</a>
                        : "—"}
                    </td>
                    <td className="px-4 py-3.5"><Etiqueta tom={ATIVOS.includes(d.status) ? "verde" : EM_ANALISE.includes(d.status) ? "ouro" : "neutro"}>{STATUS_LABEL[d.status] ?? d.status.replace("_", " ")}</Etiqueta></td>
                    <td className="px-4 py-3.5 tabular-nums">{c.total}{c.ativos ? <span className="ml-1 text-sm text-texto-2">({c.ativos} ativo{c.ativos === 1 ? "" : "s"})</span> : null}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-texto-2">{new Date(d.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                  </LinhaLink>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
