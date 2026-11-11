import Link from "next/link";
import { exigirEquipe } from "@/lib/setores-servidor";
import { SETORES, type SetorId } from "@/lib/setores";
import { buscarTarefas } from "@/lib/central";
import Tarefas, { type Tarefa } from "@/components/admin/Tarefas";
import { equipeAtiva } from "@/components/admin/Painel";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { aba } from "@/components/admin/estilos";

const ABERTOS = ["aberta", "andamento", "aguardando", "bloqueada"];

/**
 * Tarefas de todos os setores em que o membro atua (Central operacional, 0065).
 * Visões: caixa de entrada (encaminhadas esperando aceite), enviadas pelos meus
 * setores, só as minhas, atrasadas, bloqueadas e as que subiram para a Diretoria.
 */
export default async function AdminTarefas({ searchParams }: PageProps<"/admin/tarefas">) {
  const user = await exigirEquipe();
  const sp = await searchParams;
  const filtro = typeof sp.setor === "string" && user.setores.includes(sp.setor as SetorId) ? (sp.setor as SetorId) : null;
  const visao = sp.caixa === "1" ? "caixa" : sp.enviadas === "1" ? "enviadas" : sp.atrasadas === "1" ? "atrasadas"
    : sp.escalonadas === "1" ? "escalonadas" : sp.status === "bloqueada" ? "bloqueadas" : sp.minhas === "1" ? "minhas" : "todas";
  const hoje = new Date().toISOString().slice(0, 10);
  const setores = filtro ? [filtro] : user.setores;

  const [tarefas, equipe] = await Promise.all([
    buscarTarefas((q, nova) => {
      if (visao === "enviadas") {
        if (!nova) return q.eq("id", "00000000-0000-0000-0000-000000000000");
        q = q.in("setor_origem", setores).in("status", ABERTOS);
      } else {
        q = q.in("setor", setores).neq("status", "cancelada");
      }
      if (visao === "caixa") q = nova ? q.eq("origem", "encaminhada").is("aceite_em", null).eq("status", "aberta") : q.eq("id", "00000000-0000-0000-0000-000000000000");
      if (visao === "minhas") q = q.eq("responsavel", user.id);
      if (visao === "atrasadas") q = q.lt("prazo", hoje).in("status", ABERTOS);
      if (visao === "bloqueadas") q = q.eq("status", "bloqueada");
      if (visao === "escalonadas") q = nova ? q.not("escalonada_em", "is", null).in("status", ABERTOS) : q.eq("id", "00000000-0000-0000-0000-000000000000");
      return q.order("status").order("prazo", { ascending: true, nullsFirst: false });
    }),
    equipeAtiva(),
  ]);

  const nome = new Map(equipe.map((m) => [m.user_id, m.nome]));
  const lista: Tarefa[] = tarefas.map((t) => ({ ...t, responsavel_nome: t.responsavel ? nome.get(t.responsavel) ?? null : null }));
  const link = (setor: string | null, v: string) => {
    const p = new URLSearchParams();
    if (setor) p.set("setor", setor);
    if (v === "caixa") p.set("caixa", "1");
    if (v === "enviadas") p.set("enviadas", "1");
    if (v === "minhas") p.set("minhas", "1");
    if (v === "atrasadas") p.set("atrasadas", "1");
    if (v === "escalonadas") p.set("escalonadas", "1");
    if (v === "bloqueadas") p.set("status", "bloqueada");
    const s = p.toString();
    return "/admin/tarefas" + (s ? `?${s}` : "");
  };
  const VISOES: [string, string][] = [
    ["todas", "Todas"], ["caixa", "Caixa de entrada"], ["minhas", "Só as minhas"], ["enviadas", "Enviadas a outros setores"],
    ["atrasadas", "Atrasadas"], ["bloqueadas", "Bloqueadas"],
    ...(user.setores.includes("diretoria") ? [["escalonadas", "Subiram para a Diretoria"] as [string, string]] : []),
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <CabecalhoPagina eyebrow="Geral" titulo="Tarefas"
        subtitulo="O que cada setor tem para fazer, com responsável e prazo. Uma tarefa pode ser encaminhada a outro setor, que precisa aceitar ou devolver com o motivo." />

      <div className="flex flex-wrap items-center gap-2">
        <Link href={link(null, visao)} className={aba(!filtro)}>Todos os meus setores</Link>
        {SETORES.filter((s) => user.setores.includes(s.id)).map((s) => (
          <Link key={s.id} href={link(s.id, visao)} className={aba(filtro === s.id)}>{s.nome}</Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {VISOES.map(([v, rotulo]) => (
          <Link key={v} href={link(filtro, v)} className={aba(visao === v)}>{rotulo}</Link>
        ))}
      </div>

      <Tarefas
        setor={visao === "todas" || visao === "minhas" ? filtro : null}
        tarefas={lista}
        equipe={equipe}
        souEu={user.id}
        mostrarSetor={!filtro || visao === "enviadas"}
        setoresNome={Object.fromEntries(SETORES.map((s) => [s.id, s.nome]))}
        meusSetores={user.setores}
      />
      {!filtro && (visao === "todas" || visao === "minhas") && (
        <p className="text-sm text-texto-2">
          Para criar ou encaminhar uma tarefa, escolha o setor de onde ela sai.
        </p>
      )}
    </div>
  );
}
