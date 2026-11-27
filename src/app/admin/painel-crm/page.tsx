import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { setorPorId } from "@/lib/setores";
import { formatBRL, STATUS_LABEL } from "@/lib/format";
import { menuCrm } from "@/lib/paineis";
import { contar, Indicadores, Secao } from "@/components/admin/Painel";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { lerEmLotes } from "@/lib/supabase/lotes";
import { ArrowRight, Building2, CircleAlert, FileCheck2, TrendingUp, Users } from "lucide-react";

/**
 * Dashboard do CRM Arini Brasil, no desenho do Dashboard do CRM da Arini
 * Negócios: quatro números no topo (imóveis, leads ativos, aprovações
 * pendentes, contas vencidas), fechamentos do mês, atalhos e imóveis por
 * etapa. Cada número abre a tela correspondente, se o setor da pessoa tem
 * acesso a ela.
 */

const FECHADAS = "(fechado,pos_venda,perdido)";
// ordem das etapas do imóvel, do cadastro à venda
const ETAPAS = ["rascunho", "pendente", "em_analise", "correcao", "aprovado", "publicado", "em_negociacao", "vendido", "suspenso", "inativo", "reprovado"];

export default async function PainelCrm() {
  const user = await exigirEquipe();
  const menu = new Set(menuCrm(user.setores).map((i) => i.href));
  const pode = (href: string) => (menu.has(href) ? href : undefined);
  const admin = supabaseAdmin();

  const inicioMes = new Date();
  inicioMes.setDate(1);
  const mes = inicioMes.toISOString().slice(0, 10);
  const verFechamentos = ["financeiro", "comercial", "diretoria"].some((s) => user.setores.includes(s as never));

  const [imoveis, leads, analise, marketing, vencidas, porEtapa, vendas] = await Promise.all([
    contar("properties", (q) => q.eq("demonstracao", false).neq("status", "rascunho")),
    contar("oportunidades_oficiais", (q) => q.not("etapa", "in", FECHADAS)),
    contar("properties", (q) => q.eq("demonstracao", false).in("status", ["pendente", "em_analise"])),
    contar("properties", (q) => q.eq("marketing_status", "aguardando_aprovacao")),
    contar("invoices", (q) => q.eq("status", "vencida")),
    Promise.all(ETAPAS.map((st) => contar("properties", (q) => q.eq("demonstracao", false).eq("status", st)).then((n) => [st, n] as const))),
    verFechamentos
      ? lerEmLotes<{ valor_final: number }>((de, ate) =>
          admin.from("vendas_oficiais").select("valor_final").gte("data_venda", mes).order("id").range(de, ate))
      : Promise.resolve({ data: [] as { valor_final: number }[], error: null }),
  ]);

  const etapas = porEtapa.filter(([, n]) => n > 0);
  const maior = Math.max(1, ...etapas.map(([, n]) => n));
  const fechadoMes = vendas.data.reduce((s, v) => s + Number(v.valor_final ?? 0), 0);
  const nomesSetores = user.role === "admin_central" ? "Diretoria (todos os setores)"
    : user.setores.map((s) => setorPorId(s)?.nome ?? s).join(", ") || "sem setor";

  const atalhos = [
    { href: "/painel/novo", rotulo: "Nova captação", ok: !!pode("/admin/imoveis") },
    { href: "/admin/funil", rotulo: "Funil de leads", ok: !!pode("/admin/funil") },
    { href: "/admin/aprovacoes", rotulo: "Inbox de aprovações", ok: !!pode("/admin/aprovacoes") },
    { href: "/admin/financeiro", rotulo: "Financeiro empresarial", ok: !!pode("/admin/financeiro") },
    { href: "/admin/consulta-imoveis", rotulo: "Consultar imóveis", ok: !!pode("/admin/consulta-imoveis") },
    { href: "/admin/atendimento", rotulo: "Atendimento", ok: true },
  ].filter((a) => a.ok);

  return (
    <div className="space-y-10">
      <CabecalhoPagina eyebrow="CRM Arini Brasil" titulo="Dashboard"
        subtitulo={<>Olá, {(user.nome ?? "").split(" ")[0] || "equipe"}. Setor: <span className="text-ouro">{nomesSetores}</span></>} />

      <Indicadores itens={[
        { rotulo: "Imóveis", valor: imoveis, icone: Building2, href: pode("/admin/consulta-imoveis") },
        { rotulo: "Leads ativos", valor: leads, icone: Users, href: pode("/admin/leads") },
        { rotulo: "Aprovações pendentes", valor: analise + marketing, icone: FileCheck2, destaque: analise + marketing > 0,
          href: pode("/admin/aprovacoes") ?? pode("/admin/imoveis"), nota: `${analise} anúncio(s) · ${marketing} no marketing` },
        { rotulo: "Contas vencidas", valor: vencidas, icone: CircleAlert, destaque: vencidas > 0, href: pode("/admin/financeiro") },
      ]} />

      <div className="grid gap-5 lg:grid-cols-2">
        {verFechamentos && (
          <section className="cartao p-6">
            <h2 className="flex items-center gap-2 font-semibold text-texto"><TrendingUp className="size-5 text-verde" /> Fechamentos este mês</h2>
            <p className="lp-display mt-4 text-4xl text-ouro tabular-nums">{formatBRL(fechadoMes)}</p>
            <p className="mt-1 text-sm text-texto-2">Soma das vendas registradas desde o dia 1º.</p>
          </section>
        )}
        <section className="cartao p-6">
          <h2 className="font-semibold text-texto">Atalhos</h2>
          <ul className="mt-3 space-y-2">
            {atalhos.map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="inline-flex items-center gap-2 text-texto hover:text-ouro">
                  <ArrowRight className="size-4 text-verde" /> {a.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Secao titulo="Imóveis por etapa">
        <div className="cartao space-y-3 p-6">
          {etapas.length === 0 && <p className="text-texto-2">Nenhum imóvel cadastrado ainda.</p>}
          {etapas.map(([st, n]) => (
            <div key={st} className="grid grid-cols-[minmax(8rem,12rem)_1fr_3rem] items-center gap-4 text-sm">
              <span className="text-texto-2">{STATUS_LABEL[st] ?? st}</span>
              <span className="h-2 rounded-full bg-texto/10">
                <span className="block h-2 rounded-full bg-ouro" style={{ width: `${Math.max(3, (n / maior) * 100)}%` }} />
              </span>
              <span className="text-right font-semibold tabular-nums text-texto">{n}</span>
            </div>
          ))}
        </div>
      </Secao>
    </div>
  );
}
