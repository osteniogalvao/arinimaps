import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { formatBRL } from "@/lib/format";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { aba, CAMPO_COMPACTO, CODIGO, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";
import { marcarTrazido } from "./acoes";

export const metadata = { title: "CRM antigo" };

type Registro = { id_antigo: string; dados: Record<string, unknown>; criado_em_antigo: string | null; trazido_em: string | null };
const ABAS = [
  { id: "properties", rotulo: "Imóveis" }, { id: "leads", rotulo: "Leads" }, { id: "clients", rotulo: "Clientes" },
  { id: "owners", rotulo: "Proprietários" }, { id: "expenses", rotulo: "Despesas" },
] as const;
const STATUS_ANTIGO: Record<string, string> = {
  publicado: "Publicado", aguardando_aprovacao_captacao: "Aguardando aprovação", em_marketing: "No marketing", vendido: "Vendido",
};
const txt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const dia = (v: unknown) => (typeof v === "string" && v ? new Date(v).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * CRM antigo (fase 6 do porte): o que veio do CRM da Arini Negócios e não
 * entra direto no sistema novo (migration 0180). As conversas já estão no
 * Atendimento; aqui ficam imóveis, leads, clientes, proprietários e despesas
 * para consulta, e a Captação marca cada imóvel quando o cadastra de novo.
 */
export default async function CrmAntigo({ searchParams }: PageProps<"/admin/crm-antigo">) {
  await exigirSetor("operacoes", "comercial");
  const sp = await searchParams;
  const tab = ABAS.find((a) => a.id === sp.aba)?.id ?? "properties";
  const busca = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const admin = supabaseAdmin();

  const [{ data, error }, contagens] = await Promise.all([
    admin.from("crm_antigo_registros").select("id_antigo, dados, criado_em_antigo, trazido_em").eq("tabela", tab)
      .order("criado_em_antigo", { ascending: false }).limit(2000),
    Promise.all(ABAS.map((a) => admin.from("crm_antigo_registros").select("id_antigo", { count: "exact", head: true }).eq("tabela", a.id).then((r) => [a.id, r.count ?? 0] as const))),
  ]);
  const total = Object.fromEntries(contagens);
  const termo = semAcento(busca);
  const linhas = ((data ?? []) as Registro[]).filter((r) => !busca || semAcento(JSON.stringify(r.dados)).includes(termo));
  const link = (extra: Record<string, string>) => "?" + new URLSearchParams({ aba: tab, ...(busca ? { q: busca } : {}), ...extra });

  return (
    <div className="space-y-6">
      <CabecalhoPagina variante="simples" eyebrow="CRM · Importação" titulo="CRM antigo"
        subtitulo="O que veio do CRM da Arini Negócios. As conversas e os leads já estão no Atendimento (etiqueta crm-antigo); aqui ficam os cadastros para consulta." />

      {error && (
        <p className="cartao p-4 text-sm text-alerta" role="alert">
          {/crm_antigo_registros|42P01|does not exist/.test(error.message) ? "Falta rodar a migration 0180 e o SQL de importação do CRM antigo." : "Falha ao carregar."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {ABAS.map((a) => (
          <Link key={a.id} href={`?aba=${a.id}`} className={aba(a.id === tab)}>
            {a.rotulo} <span className="tabular-nums opacity-80">{total[a.id] ?? 0}</span>
          </Link>
        ))}
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="aba" value={tab} />
          <input name="q" defaultValue={busca} placeholder="Buscar…" aria-label="Buscar" className={CAMPO_COMPACTO} />
        </form>
      </div>

      {tab === "properties" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {linhas.map((r) => {
            const d = r.dados;
            const foto = typeof d.foto_principal_url === "string" && /^https:\/\//.test(d.foto_principal_url) ? d.foto_principal_url : null;
            return (
              <article key={r.id_antigo} className={"cartao overflow-hidden !p-0 " + (r.trazido_em ? "opacity-60" : "")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {foto ? <img src={foto} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" /> : <div className="aspect-[16/9] bg-superficie-2" />}
                <div className="space-y-2 p-4">
                  <p className="flex items-center justify-between gap-2">
                    <span className={CODIGO}>{txt(d.codigo)}</span>
                    <span className="rounded-full border border-linha px-2 text-[11px] text-texto-2">{STATUS_ANTIGO[String(d.status)] ?? txt(d.status)}</span>
                  </p>
                  <h2 className="font-semibold leading-snug text-texto">{txt(d.titulo)}</h2>
                  <p className="text-sm text-texto-2">
                    {[d.cidade, d.uf].filter(Boolean).map(String).map((s) => s.trim()).join("/")} · {d.valor ? formatBRL(Number(d.valor)) : "sem valor"}
                    {d.area_total ? ` · ${Number(d.area_total).toLocaleString("pt-BR")} m²` : ""}
                  </p>
                  {typeof d.descricao === "string" && d.descricao && <p className="line-clamp-3 text-sm text-texto-2">{d.descricao}</p>}
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-sm">
                    {r.trazido_em
                      ? <span className="text-verde">Já cadastrado no sistema novo em {dia(r.trazido_em)}</span>
                      : <Link href="/painel/novo" className="font-semibold text-verde hover:underline underline-offset-4">Cadastrar na captação</Link>}
                    <form action={marcarTrazido} className="ml-auto">
                      <input type="hidden" name="id" value={r.id_antigo} />
                      {r.trazido_em && <input type="hidden" name="desfazer" value="1" />}
                      <button className="text-xs text-texto-2 underline-offset-4 hover:text-texto hover:underline">{r.trazido_em ? "Desfazer" : "Marcar como cadastrado"}</button>
                    </form>
                  </div>
                </div>
              </article>
            );
          })}
          {!linhas.length && !error && <p className="cartao p-8 text-center text-texto-2 sm:col-span-2 xl:col-span-3">Nada por aqui.</p>}
        </div>
      ) : (
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead className={THEAD}>
              {tab === "leads" && <tr><th className={TH}>Nome</th><th className={TH}>Telefone</th><th className={TH}>Origem</th><th className={TH}>Etapa</th><th className={TH}>Entrou em</th><th className={TH} /></tr>}
              {(tab === "clients" || tab === "owners") && <tr><th className={TH}>Nome</th><th className={TH}>Telefone</th><th className={TH}>E-mail</th><th className={TH}>Observações</th><th className={TH}>Cadastro</th></tr>}
              {tab === "expenses" && <tr><th className={TH}>Vencimento</th><th className={TH}>Descrição</th><th className={TH}>Fornecedor</th><th className={TH + " text-right"}>Valor</th><th className={TH}>Status</th></tr>}
            </thead>
            <tbody className={TBODY}>
              {linhas.slice(0, 500).map((r) => {
                const d = r.dados;
                const tel = String(d.telefone ?? d.whatsapp ?? "").replace(/\D/g, "");
                if (tab === "leads") return (
                  <tr key={r.id_antigo} className={TR}>
                    <td className={TD}>{txt(d.nome)}</td><td className={TD + " tabular-nums"}>{tel ? "+" + tel : "—"}</td>
                    <td className={TD}>{txt(d.origem)}</td><td className={TD}>{txt(d.stage)}{d.descartado ? " (descartado)" : ""}</td>
                    <td className={TD}>{dia(r.criado_em_antigo)}</td>
                    <td className={TD + " text-right"}>{tel && <Link href={`/admin/atendimento/contatos?q=${tel}`} className="text-sm font-semibold text-verde hover:underline underline-offset-4">Ver contato</Link>}</td>
                  </tr>
                );
                if (tab === "expenses") return (
                  <tr key={r.id_antigo} className={TR}>
                    <td className={TD}>{dia(d.vencimento)}</td><td className={TD}>{txt(d.descricao)}</td><td className={TD}>{txt(d.fornecedor)}</td>
                    <td className={TD + " text-right tabular-nums"}>{d.valor ? formatBRL(Number(d.valor)) : "—"}</td><td className={TD}>{txt(d.status)}</td>
                  </tr>
                );
                return (
                  <tr key={r.id_antigo} className={TR}>
                    <td className={TD}>{txt(d.nome)}</td><td className={TD + " tabular-nums"}>{tel ? "+" + tel : "—"}</td><td className={TD}>{txt(d.email)}</td>
                    <td className={TD + " max-w-md text-sm text-texto-2"}>{txt(d.observacoes)}</td><td className={TD}>{dia(r.criado_em_antigo)}</td>
                  </tr>
                );
              })}
              {!linhas.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-texto-2">Nada por aqui.</td></tr>}
            </tbody>
          </table>
          {linhas.length > 500 && <p className="px-4 py-3 text-sm text-texto-2">Mostrando 500 de {linhas.length}. Use a busca. <Link href={link({})} className="text-verde underline">Atualizar</Link></p>}
        </div>
      )}
    </div>
  );
}
