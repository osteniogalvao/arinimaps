import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { Activity, Building2, GitCompareArrows } from "lucide-react";
import { STATUS_LABEL } from "@/lib/format";
import { humanizarCodigo } from "@/lib/textoTecnico";
import { contar, Indicadores, Secao } from "@/components/admin/Painel";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { CODIGO, LISTA, LISTA_VAZIA } from "@/components/admin/estilos";

export const metadata = { title: "Movimentações" };

const FUSO = "America/Sao_Paulo";
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const status = (s: string | null) => (s ? STATUS_LABEL[s] ?? humanizarCodigo(s) : "—");

/**
 * Movimentações (porte do CRM da Arini Negócios): a visão da Diretoria do que
 * andou no sistema. Imóveis que mudaram, o fluxo de cada imóvel entre etapas e
 * setores e a linha do tempo da auditoria.
 */
export default async function Movimentacoes() {
  await exigirSetor("diretoria");
  const admin = supabaseAdmin();
  const agora = new Date();
  const semana = new Date(agora.getTime() - 7 * 86_400_000).toISOString();

  const [imoveis, fluxo, auditoria, n1, n2, n3] = await Promise.all([
    admin.from("properties").select("id, codigo, titulo, status, updated_at").eq("demonstracao", false)
      .order("updated_at", { ascending: false }).limit(40),
    admin.from("imovel_fluxo_eventos").select("id, acao, de_status, para_status, para_setor, texto, autor, created_at, property:properties(id, codigo)")
      .order("created_at", { ascending: false }).limit(60),
    admin.from("audit_log").select("id, acao, entidade, created_at, user_id").order("created_at", { ascending: false }).limit(100),
    contar("properties", (q) => q.eq("demonstracao", false).gte("updated_at", semana)),
    contar("imovel_fluxo_eventos", (q) => q.gte("created_at", semana)),
    contar("audit_log", (q) => q.gte("created_at", semana)),
  ]);

  const ids = [...new Set([...(fluxo.data ?? []).map((f) => f.autor), ...(auditoria.data ?? []).map((a) => a.user_id)].filter(Boolean))] as string[];
  const { data: pessoas } = ids.length ? await admin.from("profiles").select("user_id, nome").in("user_id", ids) : { data: [] };
  const nome = new Map((pessoas ?? []).map((p) => [p.user_id as string, (p.nome as string) || "Sem nome"]));

  return (
    <div className="space-y-8">
      <CabecalhoPagina variante="simples" eyebrow="CRM · Diretoria" titulo="Movimentações"
        subtitulo="Histórico de etapas e ações dos últimos dias." />

      <Indicadores itens={[
        { rotulo: "Imóveis alterados em 7 dias", valor: n1, icone: Building2, href: "/admin/consulta-imoveis" },
        { rotulo: "Passos no fluxo em 7 dias", valor: n2, icone: GitCompareArrows },
        { rotulo: "Ações registradas em 7 dias", valor: n3, icone: Activity, href: "/admin/auditoria" },
      ]} />

      <div className="grid gap-8 xl:grid-cols-2">
        <Secao titulo="Imóveis por etapa">
          <div className={LISTA}>
            {(imoveis.data ?? []).map((p) => (
              <Link key={p.id} href={`/admin/imoveis/${p.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-superficie-2/70">
                <span className={CODIGO + " w-24 shrink-0"}>{p.codigo}</span>
                <span className="min-w-0 flex-1 truncate text-texto">{p.titulo}</span>
                <span className="rounded-full border border-linha px-2 py-0.5 text-xs text-texto-2">{status(p.status)}</span>
                <span className="w-24 shrink-0 text-right text-xs text-texto-2">{quando(p.updated_at)}</span>
              </Link>
            ))}
            {!imoveis.data?.length && <p className={LISTA_VAZIA}>Nenhum imóvel ainda.</p>}
          </div>
        </Secao>

        <Secao titulo="Fluxo dos imóveis">
          <div className={LISTA}>
            {(fluxo.data ?? []).map((f) => {
              const p = f.property as unknown as { id: string; codigo: string } | null;
              return (
                <div key={f.id} className="px-5 py-3 text-sm">
                  <p className="flex flex-wrap items-center gap-x-2 text-texto">
                    <span className={CODIGO}>{p?.codigo}</span>
                    <strong className="font-semibold">{humanizarCodigo(f.acao)}</strong>
                    {(f.de_status || f.para_status) && <span className="text-texto-2">{status(f.de_status)} → {status(f.para_status)}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-texto-2">
                    {f.autor ? nome.get(f.autor) ?? "Equipe" : "Sistema"} · {quando(f.created_at)}{f.texto ? ` · ${f.texto}` : ""}
                  </p>
                </div>
              );
            })}
            {!fluxo.data?.length && <p className={LISTA_VAZIA}>Nenhum passo de fluxo registrado ainda.</p>}
          </div>
        </Secao>
      </div>

      <Secao titulo="Linha do tempo (auditoria)" acao={<Link href="/admin/auditoria" className="text-sm font-semibold text-verde hover:underline underline-offset-4">Abrir auditoria</Link>}>
        <div className={LISTA}>
          {(auditoria.data ?? []).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-x-3 px-5 py-2.5 text-sm">
              <span className="w-24 shrink-0 text-xs text-texto-2">{quando(a.created_at)}</span>
              <span className="font-medium text-texto">{humanizarCodigo(a.acao)}</span>
              <span className="text-texto-2">{humanizarCodigo(a.entidade ?? "")}</span>
              <span className="ml-auto text-xs text-texto-2">{a.user_id ? nome.get(a.user_id) ?? "Equipe" : "Sistema"}</span>
            </div>
          ))}
          {!auditoria.data?.length && <p className={LISTA_VAZIA}>Nada registrado ainda.</p>}
        </div>
      </Secao>
    </div>
  );
}
