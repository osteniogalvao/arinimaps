import Link from "next/link";
import { Shuffle } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { lerConfiguracoes, numero } from "@/lib/settings";
import { CabecalhoPagina, Vazio } from "@/components/ui/Pagina";
import { TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";
import RodizioToggle from "@/components/admin/RodizioToggle";
import RegrasRodizio from "@/components/crm-comercial/RegrasRodizio";

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

  // regras do corretor (0147); sem a migration, a lista de antes
  const COLS = "user_id, nome, role, setores, rodizio_leads, rodizio_ultimo_em";
  const lerMembros = (cols: string) => admin.from("profiles").select(cols)
    .in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("nome");
  const comRegras = await lerMembros(`${COLS}, rodizio_peso, rodizio_tipos, rodizio_ufs, rodizio_limite_dia, rodizio_pausa_ate`);
  const temRegras = !comRegras.error;
  const { data: brutos, error } = temRegras ? comRegras : await lerMembros(COLS);
  const membros = brutos as unknown as {
    user_id: string; nome: string; role: string; setores: string[] | null; rodizio_leads: boolean; rodizio_ultimo_em: string | null;
    rodizio_peso?: number; rodizio_tipos?: string[]; rodizio_ufs?: string[]; rodizio_limite_dia?: number | null; rodizio_pausa_ate?: string | null;
  }[] | null;
  const semFila = cfg.rodizio_sem_fila_equipe !== false;
  const carteira = cfg.rodizio_carteira !== false;
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
  const { data: opps } = await admin.from("oportunidades_oficiais")
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
  const pausado = (m: { rodizio_pausa_ate?: string | null }) => !!m.rodizio_pausa_ate && +new Date(m.rodizio_pausa_ate) > Date.now();
  const fila = comercial.filter((m) => m.rodizio_leads && !pausado(m))
    .sort((a, b) => +new Date(a.rodizio_ultimo_em ?? 0) - +new Date(b.rodizio_ultimo_em ?? 0));
  const proximo = fila[0]?.user_id;

  return (
    <div className="max-w-5xl space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Rodízio de leads"
        subtitulo={<>Cada lead novo vai para o próximo corretor ligado abaixo. Sem primeiro contato em {minutos} min, o lead passa
          para o seguinte; depois de {repasses} repasses vira tarefa da gerência. O prazo conta só no horário de expediente.
          Prazos, expediente e as regras gerais ficam em{" "}
          <Link href="/admin/configuracoes" className="font-semibold text-verde hover:underline">Configurações › Central operacional</Link>.</>} />

      {temRegras && (
        <ul className="cartao grid gap-2 p-4 text-sm text-texto-2 sm:grid-cols-2">
          <li><b className="text-texto">Carteira:</b> {carteira ? "ligada. Cliente que já tem corretor (mesmo telefone ou e-mail) volta para ele." : "desligada."}</li>
          <li><b className="text-texto">Fila vazia:</b> {semFila ? "o lead vai para quem é do setor Comercial, um de cada vez." : "o lead fica sem corretor."}</li>
          <li><b className="text-texto">Ordem:</b> quem recebeu menos leads nos últimos 7 dias (dividido pelo peso) e há mais tempo.</li>
          <li><b className="text-texto">Regras por corretor:</b> tipo de imóvel, UF, limite por dia e pausa de férias, na coluna “Regras”.</li>
        </ul>
      )}

      {!fila.length && (
        <p className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          {temRegras && semFila
            ? comercial.some((m) => m.role === "analista_arini")
              ? "Ninguém ligado no rodízio: os leads vão para quem é do setor Comercial, em ordem. Ligue os corretores abaixo para usar a fila com regras."
              : "Ninguém ligado no rodízio e ninguém da equipe no setor Comercial: os leads ficam sem corretor. Coloque a equipe no Comercial em Equipe e usuários."
            : "Ninguém está no rodízio: os leads ficam com a equipe, sem corretor definido, como era antes."}
        </p>
      )}

      <div className={TABELA_CAIXA}>
        <table className={TABELA}>
          <thead className={THEAD}>
            <tr>
              <th className={TH}>Corretor</th>
              <th className={TH}>No rodízio</th>
              {temRegras && <th className={TH}>Regras</th>}
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
                  {temRegras && (
                    <td className={TD}>
                      <RegrasRodizio userId={m.user_id} regras={{ peso: m.rodizio_peso ?? 1, tipos: m.rodizio_tipos ?? [], ufs: m.rodizio_ufs ?? [],
                        limite_dia: m.rodizio_limite_dia ?? null, pausa_ate: m.rodizio_pausa_ate ?? null }} />
                    </td>
                  )}
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
