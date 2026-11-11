import Link from "next/link";
import { Megaphone } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { formatBRL } from "@/lib/format";
import { CabecalhoPagina, Etiqueta, Vazio } from "@/components/ui/Pagina";
import { Secao } from "@/components/admin/Painel";
import { LISTA, LISTA_VAZIA, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";
import { CANAIS_PUBLICACAO, PUBLICACAO_STATUS } from "@/lib/registros";

/**
 * Tráfego e resultados (Central de CRMs, marketing em dois ambientes): o que
 * a edição publicou e o que cada campanha paga trouxe de lead, oportunidade e
 * venda, com custo por lead.
 */
export default async function Trafego() {
  await exigirSetor("marketing", "diretoria");
  const admin = supabaseAdmin();
  const [{ data: campanhas, error }, { data: resultado }, { data: pubs }] = await Promise.all([
    admin.from("campanhas").select("*").order("created_at", { ascending: false }).limit(100),
    admin.rpc("fn_campanhas_resultado"),
    admin.from("publicacoes").select("id, codigo, canal, status, publicado_em, link_externo, property:properties(codigo, titulo)")
      .order("updated_at", { ascending: false }).limit(20),
  ]);
  if (error) return <Vazio icone={Megaphone} titulo="Falta atualizar o banco" texto="Esta tela precisa da migration 0068." />;
  const res = new Map(((resultado ?? []) as { campanha_id: string; leads: number; oportunidades: number; vendas: number }[]).map((r) => [r.campanha_id, r]));
  const canal = Object.fromEntries(CANAIS_PUBLICACAO);

  return (
    <div className="max-w-6xl space-y-10">
      <CabecalhoPagina eyebrow="Marketing" titulo="Tráfego e resultados"
        subtitulo={<>Leads que chegaram pelo link de cada campanha (utm_campaign). Para cadastrar ou atualizar o gasto, use <Link href="/admin/registros/campanhas" className="font-semibold text-verde hover:underline">Campanhas</Link>.</>} />
      <Secao titulo="Campanhas">
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead className={THEAD}><tr>
              <th className={TH}>Campanha</th><th className={TH}>Gasto</th><th className={TH}>Leads</th><th className={TH}>Custo por lead</th>
              <th className={TH}>Oportunidades</th><th className={TH}>Vendas</th>
            </tr></thead>
            <tbody className={TBODY}>
              {(campanhas ?? []).map((c) => {
                const r = res.get(c.id);
                const leads = Number(r?.leads ?? 0);
                return (
                  <tr key={c.id} className={TR}>
                    <td className={TD}><span className="font-medium text-texto">{c.nome}</span>
                      <span className="mt-0.5 block font-mono text-xs text-texto-2">{c.utm_campaign ?? "sem utm"}{!c.ativa && " · encerrada"}</span></td>
                    <td className={TD + " tabular-nums"}>{c.gasto ? formatBRL(Number(c.gasto)) : "—"}</td>
                    <td className={TD + " tabular-nums"}>{leads}</td>
                    <td className={TD + " tabular-nums"}>{c.gasto && leads ? formatBRL(Number(c.gasto) / leads) : "—"}</td>
                    <td className={TD + " tabular-nums"}>{Number(r?.oportunidades ?? 0)}</td>
                    <td className={TD + " tabular-nums"}>{Number(r?.vendas ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!campanhas?.length && <p className={LISTA_VAZIA}>Nenhuma campanha cadastrada.</p>}
        </div>
      </Secao>
      <Secao titulo="Últimas publicações">
        <div className={LISTA}>
          {(pubs ?? []).map((p) => {
            const im = p.property as unknown as { codigo: string; titulo: string } | null;
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="font-mono text-xs text-texto-2">{p.codigo}</span>
                <span className="min-w-48 flex-1 text-texto">{im?.titulo ?? im?.codigo}</span>
                <span className="text-xs text-texto-2">{canal[p.canal] ?? p.canal}</span>
                {p.link_externo && <a href={p.link_externo} target="_blank" rel="noreferrer" className="text-xs font-semibold text-verde hover:underline">abrir</a>}
                <Etiqueta tom={p.status === "publicada" ? "verde" : p.status === "erro" ? "critico" : "ouro"}>{PUBLICACAO_STATUS[p.status] ?? p.status}</Etiqueta>
              </div>
            );
          })}
          {!pubs?.length && <p className={LISTA_VAZIA}>Nenhuma publicação ainda.</p>}
        </div>
      </Secao>
    </div>
  );
}
