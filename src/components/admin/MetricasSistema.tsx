import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerEmLotes } from "@/lib/supabase/lotes";
import { PAPEL_LABEL } from "@/lib/perfis";
import { contar, Indicadores, Secao } from "@/components/admin/Painel";
import { CartaoGrafico, GraficoArea, GraficoBarras, GraficoColunas, type Ponto } from "@/components/admin/Graficos";
import { LogIn, ShieldAlert, UserPlus, Users } from "lucide-react";

/**
 * Métricas do sistema (pedido do Stenio, 27/11/2026): usuários, acessos e uso,
 * com gráficos. Só para a Diretoria e a Segurança (quem decide e quem vigia).
 *
 * Fontes: profiles (cadastros e perfis), auth_events (entradas, falhas) e
 * consultas_area_log (consultas de área no mapa). Tudo dos últimos 30 dias,
 * menos os cadastros por semana (12 semanas).
 */

const FUSO = "America/Sao_Paulo";
const DIA = 86_400_000;
const diaDe = (iso: string | Date) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: FUSO });
const rotuloDia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Últimos `n` dias (no fuso de Brasília), do mais antigo para hoje. */
function ultimosDias(n: number, agora: number) {
  return Array.from({ length: n }, (_, i) => diaDe(new Date(agora - (n - 1 - i) * DIA)));
}

function porDia(datas: string[], dias: string[], nome: string): Ponto[] {
  const conta = new Map(dias.map((d) => [d, 0]));
  for (const d of datas) { const k = diaDe(d); if (conta.has(k)) conta.set(k, conta.get(k)! + 1); }
  return dias.map((d) => ({ rotulo: rotuloDia(d), valor: conta.get(d)!, dica: `${rotuloDia(d)}: ${conta.get(d)!.toLocaleString("pt-BR")} ${nome}` }));
}

export default async function MetricasSistema({ agora }: { agora: number }) {
  const admin = supabaseAdmin();
  const desde30 = new Date(agora - 30 * DIA).toISOString();
  const desde7 = agora - 7 * DIA;
  const desde12s = new Date(agora - 84 * DIA).toISOString();
  const papeis = Object.keys(PAPEL_LABEL);

  const [total, novos30, porPapel, eventos, cadastros, consultas] = await Promise.all([
    contar("profiles"),
    contar("profiles", (q) => q.gte("created_at", desde30)),
    Promise.all(papeis.map((r) => contar("profiles", (q) => q.eq("role", r)).then((n) => [r, n] as const))),
    lerEmLotes<{ created_at: string; evento: string; user_id: string | null }>((de, ate) =>
      admin.from("auth_events").select("created_at, evento, user_id")
        .in("evento", ["login_ok", "login_falhou", "login_bloqueado"]).gte("created_at", desde30)
        .order("created_at").order("id").range(de, ate), { maximo: 50_000 }),
    lerEmLotes<{ created_at: string }>((de, ate) =>
      admin.from("profiles").select("created_at").gte("created_at", desde12s).order("created_at").order("user_id").range(de, ate), { maximo: 50_000 }),
    lerEmLotes<{ created_at: string }>((de, ate) =>
      admin.from("consultas_area_log").select("created_at").gte("created_at", desde30).order("created_at").order("id").range(de, ate), { maximo: 50_000 }),
  ]);

  const dias = ultimosDias(30, agora);
  const entradas = eventos.data.filter((e) => e.evento === "login_ok");
  const falhas = eventos.data.length - entradas.length;
  const ativos7 = new Set(entradas.filter((e) => e.user_id && new Date(e.created_at).getTime() >= desde7).map((e) => e.user_id)).size;
  const unicos30 = new Set(entradas.map((e) => e.user_id).filter(Boolean)).size;

  // pessoas diferentes que entraram em cada dia
  const unicosPorDia = (() => {
    const m = new Map(dias.map((d) => [d, new Set<string>()]));
    for (const e of entradas) { const s = m.get(diaDe(e.created_at)); if (s && e.user_id) s.add(e.user_id); }
    return dias.map((d) => ({ rotulo: rotuloDia(d), valor: m.get(d)!.size, dica: `${rotuloDia(d)}: ${m.get(d)!.size} pessoa(s) diferentes` }));
  })();

  // cadastros novos por semana (12 semanas, a última termina hoje)
  const semanas: Ponto[] = Array.from({ length: 12 }, (_, i) => {
    const fim = agora - (11 - i) * 7 * DIA, ini = fim - 7 * DIA;
    const n = cadastros.data.filter((c) => { const t = new Date(c.created_at).getTime(); return t > ini && t <= fim; }).length;
    const r = rotuloDia(diaDe(new Date(ini + DIA)));
    return { rotulo: r, valor: n, dica: `Semana de ${r}: ${n} cadastro(s)` };
  });

  const perfis = porPapel.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    .map(([r, n]) => ({ rotulo: PAPEL_LABEL[r] ?? r, valor: n }));

  return (
    <Secao titulo="Métricas do sistema">
      <Indicadores itens={[
        { rotulo: "Usuários cadastrados", valor: total.toLocaleString("pt-BR"), icone: Users, nota: `${novos30} novos em 30 dias` },
        { rotulo: "Ativos nos últimos 7 dias", valor: ativos7, icone: LogIn, nota: `${unicos30} pessoas entraram em 30 dias` },
        { rotulo: "Entradas em 30 dias", valor: entradas.length.toLocaleString("pt-BR"), icone: UserPlus, href: "/admin/seguranca" },
        { rotulo: "Tentativas recusadas", valor: falhas, icone: ShieldAlert, destaque: falhas > 50, href: "/admin/seguranca",
          nota: "senha errada ou conta bloqueada, 30 dias" },
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <CartaoGrafico titulo="Entradas no sistema por dia" destaque={entradas.length.toLocaleString("pt-BR")} nota="Últimos 30 dias · passe o mouse para ver cada dia">
          <GraficoArea titulo="Entradas no sistema por dia" pontos={porDia(entradas.map((e) => e.created_at), dias, "entrada(s)")} />
        </CartaoGrafico>
        <CartaoGrafico titulo="Pessoas diferentes por dia" destaque={String(unicos30)} nota="Quem entrou pelo menos uma vez no dia">
          <GraficoArea titulo="Pessoas diferentes por dia" pontos={unicosPorDia} cor="text-ouro" />
        </CartaoGrafico>
        <CartaoGrafico titulo="Novos cadastros por semana" destaque={String(cadastros.data.length)} nota="Últimas 12 semanas">
          <GraficoColunas titulo="Novos cadastros por semana" pontos={semanas} />
        </CartaoGrafico>
        <CartaoGrafico titulo="Consultas de área no mapa" destaque={consultas.data.length.toLocaleString("pt-BR")} nota="Últimos 30 dias">
          <GraficoColunas titulo="Consultas de área no mapa por dia" pontos={porDia(consultas.data.map((c) => c.created_at), dias, "consulta(s)")} cor="text-verde" />
        </CartaoGrafico>
      </div>
      <CartaoGrafico titulo="Usuários por perfil" destaque={total.toLocaleString("pt-BR")}>
        <GraficoBarras titulo="Usuários por perfil" pontos={perfis} />
      </CartaoGrafico>
    </Secao>
  );
}
