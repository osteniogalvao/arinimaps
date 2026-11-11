import Link from "next/link";
import { ArrowRight, BellRing, CircleCheck } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SetorId } from "@/lib/setores";

type Excecao = { rotulo: string; n: number; href: string; critico?: boolean };

/** count tolerante: coluna nova ausente (migration 0065) = 0, sem derrubar a Matriz. */
async function contar(monta: () => PromiseLike<{ count: number | null; error: unknown }>) {
  try {
    const { count, error } = await monta();
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Painel de exceções da Matriz (Central de CRMs, bloco 1): só o que exige
 * intervenção agora, já filtrado pelos setores de quem está vendo.
 */
export default async function Excecoes({ userId, setores }: { userId: string; setores: SetorId[] }) {
  const admin = supabaseAdmin();
  const hoje = new Date().toISOString().slice(0, 10);
  const agora = new Date().toISOString();
  const abertos = ["aberta", "andamento", "aguardando", "bloqueada"];
  const comercial = setores.includes("comercial") || setores.includes("diretoria");
  const diretoria = setores.includes("diretoria");

  const tarefas = () => admin.from("tasks").select("id", { count: "exact", head: true });
  const [caixa, atrasadas, bloqueadas, escalonadas, meusLeads, leadsVencidos, semRelatorio] = await Promise.all([
    contar(() => tarefas().eq("origem", "encaminhada").is("aceite_em", null).eq("status", "aberta").in("setor", setores)),
    contar(() => tarefas().in("status", abertos).lt("prazo", hoje).in("setor", setores)),
    contar(() => tarefas().eq("status", "bloqueada").in("setor", setores)),
    diretoria ? contar(() => tarefas().not("escalonada_em", "is", null).in("status", ["aberta", "andamento"])) : Promise.resolve(0),
    contar(() => admin.from("opportunities").select("id", { count: "exact", head: true })
      .eq("responsavel_user_id", userId).is("primeiro_atendimento_em", null).eq("etapa", "novo_lead")),
    comercial ? contar(() => admin.from("opportunities").select("id", { count: "exact", head: true })
      .is("primeiro_atendimento_em", null).eq("etapa", "novo_lead").lt("prazo_atendimento", agora)) : Promise.resolve(0),
    comercial ? contar(() => tarefas().like("chave_evento", "visita_sem_relatorio:%").in("status", abertos)) : Promise.resolve(0),
  ]);

  const lista: Excecao[] = [
    { rotulo: "tarefas encaminhadas esperando o seu setor aceitar", n: caixa, href: "/admin/tarefas?caixa=1", critico: true },
    { rotulo: "leads seus esperando o primeiro contato", n: meusLeads, href: "/admin/leads?meus=1", critico: true },
    { rotulo: "leads com o prazo de atendimento vencido", n: leadsVencidos, href: "/admin/leads?vencidos=1", critico: true },
    { rotulo: "visitas sem relatório", n: semRelatorio, href: "/admin/tarefas?setor=comercial" },
    { rotulo: "tarefas atrasadas nos seus setores", n: atrasadas, href: "/admin/tarefas?atrasadas=1" },
    { rotulo: "tarefas bloqueadas", n: bloqueadas, href: "/admin/tarefas?status=bloqueada" },
    { rotulo: "tarefas que ninguém assumiu e subiram para a Diretoria", n: escalonadas, href: "/admin/tarefas?escalonadas=1", critico: true },
  ].filter((e) => e.n > 0);

  return (
    <section className="space-y-4">
      <h2 className="lp-display flex items-center gap-2 text-xl md:text-2xl text-texto">
        <BellRing className="size-5 text-ouro" /> Pede a sua atenção
      </h2>
      {lista.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((e) => (
            <Link key={e.rotulo} href={e.href}
              className={"flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors " +
                (e.critico ? "border-critico/40 bg-critico/8 hover:border-critico" : "border-ouro/45 bg-ouro/10 hover:border-ouro")}>
              <span className="text-sm font-semibold text-texto">{e.rotulo}</span>
              <span className="flex items-center gap-1.5">
                <span className={"lp-display text-xl leading-none tabular-nums " + (e.critico ? "text-critico" : "text-ouro")}>{e.n}</span>
                <ArrowRight className="size-4 text-texto-2" />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-xl border border-linha bg-superficie-2/60 px-4 py-3 text-sm text-texto-2">
          <CircleCheck className="size-4 text-verde" /> Nada parado: sem tarefa esperando aceite, lead sem contato ou prazo vencido.
        </p>
      )}
    </section>
  );
}
