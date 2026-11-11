import Link from "next/link";
import { Shuffle } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { lerConfiguracoes, numero } from "@/lib/settings";
import { CabecalhoPagina, Vazio } from "@/components/ui/Pagina";
import { TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";
import RodizioToggle from "@/components/admin/RodizioToggle";

/**
 * Rodízio de leads (Central de CRMs, bloco 1). Cada lead novo vai para o
 * próximo corretor da fila; sem primeiro contato no prazo, passa adiante.
 */
export default async function Rodizio() {
  await exigirSetor("comercial", "diretoria");
  const admin = supabaseAdmin();
  const cfg = await lerConfiguracoes();
  const minutos = numero(cfg, "rodizio_minutos", 30);
  const repasses = numero(cfg, "rodizio_max_repasses", 3);
  const ha30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data: membros, error } = await admin.from("profiles")
    .select("user_id, nome, role, setores, rodizio_leads, rodizio_ultimo_em")
    .in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("nome");
  if (error) {
    return (
      <div className="max-w-4xl space-y-6">
        <CabecalhoPagina eyebrow="Comercial" titulo="Rodízio de leads" />
        <Vazio icone={Shuffle} titulo="Falta atualizar o banco"
          texto="O rodízio precisa da migration 0065 (Central operacional). Depois de rodá-la, esta tela aparece." />
      </div>
    );
  }
  const comercial = (membros ?? []).filter((m) => m.role === "admin_central" || (m.setores ?? []).includes("comercial"));

  // números dos últimos 30 dias por corretor
  const { data: opps } = await admin.from("opportunities")
    .select("responsavel_user_id, atribuida_em, primeiro_atendimento_em, etapa, created_at")
    .gte("created_at", ha30).not("responsavel_user_id", "is", null);
  const stats = new Map<string, { leads: number; atendidos: number; minutos: number[]; ganhos: number }>();
  for (const o of opps ?? []) {
    const s = stats.get(o.responsavel_user_id) ?? { leads: 0, atendidos: 0, minutos: [], ganhos: 0 };
    s.leads++;
    if (o.primeiro_atendimento_em) {
      s.atendidos++;
      if (o.atribuida_em) s.minutos.push((+new Date(o.primeiro_atendimento_em) - +new Date(o.atribuida_em)) / 60_000);
    }
    if (["fechado", "pos_venda"].includes(o.etapa)) s.ganhos++;
    stats.set(o.responsavel_user_id, s);
  }
  const fila = comercial.filter((m) => m.rodizio_leads)
    .sort((a, b) => +new Date(a.rodizio_ultimo_em ?? 0) - +new Date(b.rodizio_ultimo_em ?? 0));
  const proximo = fila[0]?.user_id;

  return (
    <div className="max-w-5xl space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Rodízio de leads"
        subtitulo={<>Cada lead novo vai para o próximo corretor ligado abaixo. Sem primeiro contato em {minutos} min, o lead passa
          para o seguinte; depois de {repasses} repasses vira tarefa da gerência. Os prazos ficam em{" "}
          <Link href="/admin/configuracoes" className="font-semibold text-verde hover:underline">Configurações › Central operacional</Link>.</>} />

      {!fila.length && (
        <p className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          Ninguém está no rodízio: os leads ficam com a equipe, sem corretor definido, como era antes.
        </p>
      )}

      <div className={TABELA_CAIXA}>
        <table className={TABELA}>
          <thead className={THEAD}>
            <tr>
              <th className={TH}>Corretor</th>
              <th className={TH}>No rodízio</th>
              <th className={TH}>Leads (30 dias)</th>
              <th className={TH}>Atendidos</th>
              <th className={TH}>Tempo médio até o contato</th>
              <th className={TH}>Vendas</th>
              <th className={TH}>Último lead</th>
            </tr>
          </thead>
          <tbody className={TBODY}>
            {comercial.map((m) => {
              const s = stats.get(m.user_id);
              const media = s?.minutos.length ? Math.round(s.minutos.reduce((x, y) => x + y, 0) / s.minutos.length) : null;
              return (
                <tr key={m.user_id} className={TR}>
                  <td className={TD}>
                    <span className="font-medium text-texto">{m.nome || "—"}</span>
                    {m.user_id === proximo && <span className="ml-2 text-xs font-semibold text-ouro">próximo da fila</span>}
                  </td>
                  <td className={TD}><RodizioToggle userId={m.user_id} ligado={!!m.rodizio_leads} /></td>
                  <td className={TD + " tabular-nums"}>{s?.leads ?? 0}</td>
                  <td className={TD + " tabular-nums"}>{s ? `${s.atendidos} (${Math.round((s.atendidos / s.leads) * 100)}%)` : "—"}</td>
                  <td className={TD + " tabular-nums"}>{media == null ? "—" : media < 60 ? `${media} min` : `${(media / 60).toFixed(1)} h`}</td>
                  <td className={TD + " tabular-nums"}>{s?.ganhos ?? 0}</td>
                  <td className={TD + " text-xs text-texto-2"}>
                    {m.rodizio_ultimo_em ? new Date(m.rodizio_ultimo_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!comercial.length && (
        <p className="text-sm text-texto-2">Ninguém da equipe está no setor Comercial. Defina em Equipe e usuários.</p>
      )}
    </div>
  );
}
