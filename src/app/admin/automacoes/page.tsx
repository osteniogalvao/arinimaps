import Link from "next/link";
import { Bot } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { lerConfiguracoes, numero } from "@/lib/settings";
import { setorPorId } from "@/lib/setores";
import { CabecalhoPagina, Etiqueta } from "@/components/ui/Pagina";
import { LISTA, LINHA_LISTA } from "@/components/admin/estilos";
import RodarAutomacoes from "@/components/admin/RodarAutomacoes";

/**
 * Regras automáticas da Central (bloco 1). Cada regra observa um evento e cria
 * no máximo uma tarefa por ocorrência; toda ação automática vai para a
 * auditoria. O worker roda a cada 10 min; aqui a Diretoria roda na hora.
 */
export default async function Automacoes() {
  await exigirSetor("diretoria");
  const cfg = await lerConfiguracoes();
  const n = (k: string, alt: number) => numero(cfg, k, alt);

  const regras = [
    { nome: "Lead novo vai para o próximo corretor", setor: "comercial",
      quando: "Assim que o lead chega pelo site (e, a cada 10 min, os que ficaram sem corretor).",
      faz: "Entrega ao próximo da fila do rodízio e avisa por e-mail." },
    { nome: "Lead sem atendimento", setor: "comercial",
      quando: `Sem primeiro contato em ${n("rodizio_minutos", 30)} min.`,
      faz: `Passa ao próximo corretor; depois de ${n("rodizio_max_repasses", 3)} repasses, cria tarefa de alta prioridade para o Comercial.` },
    { nome: "Visita sem relatório", setor: "comercial",
      quando: `${n("visita_relatorio_horas", 3)} h depois do horário da visita, sem relatório.`,
      faz: "Cria tarefa para o corretor da visita. Ela se fecha sozinha quando o relatório é salvo." },
    { nome: "Encaminhamento sem aceite", setor: "diretoria",
      quando: `Tarefa encaminhada que ninguém aceitou em ${n("tarefa_aceite_horas", 24)} h.`,
      faz: "Marca como prioridade alta e cria tarefa para a Diretoria." },
    { nome: "Cadastro parado", setor: "operacoes",
      quando: `Imóvel aguardando análise há mais de ${n("cadastro_parado_dias", 2)} dia(s).`,
      faz: "Cria tarefa para Operações analisar o cadastro." },
    { nome: "Despesa vencida ou sem aprovação", setor: "financeiro",
      quando: "Despesa aprovada que passou do vencimento, ou pedida há mais de 2 dias sem aprovação.",
      faz: "Cria tarefa para o Financeiro pagar ou para a Diretoria aprovar. Ela se fecha sozinha quando a despesa é paga ou aprovada." },
    { nome: "Ponto incompleto e ajuste parado", setor: "diretoria",
      quando: "Dia anterior com marcação sem par, ou pedido de ajuste sem decisão há 2 dias.",
      faz: "Avisa a pessoa no sino; o ajuste parado vira tarefa da Diretoria." },
    { nome: "Publicação esperando aprovação", setor: "marketing",
      quando: "Publicação mandada para aprovação há mais de 1 dia.",
      faz: "Cria tarefa para o Marketing aprovar ou devolver." },
    { nome: "WhatsApp sem resposta", setor: "comercial",
      quando: "Cliente mandou mensagem e ninguém respondeu em 2 h (das 8 h às 18 h).",
      faz: "Cria tarefa de alta prioridade para o corretor do lead. Fecha sozinha quando ele responde." },
    { nome: "Prazo da etapa do CRM do setor", setor: "diretoria",
      quando: "Item de um CRM de setor passou do prazo definido para a etapa em que está.",
      faz: "Cria tarefa no setor do funil para o responsável do item. Fecha sozinha quando o item avança." },
  ];

  const { data: recentes, error } = await supabaseAdmin().from("tasks")
    .select("id, codigo, titulo, setor, regra, status, created_at")
    .eq("origem", "automatica").order("created_at", { ascending: false }).limit(20);

  return (
    <div className="max-w-5xl space-y-8">
      <CabecalhoPagina eyebrow="Diretoria" titulo="Automações"
        subtitulo={<>Regras que cobram o que ficou parado. Cada ocorrência gera uma tarefa só, e toda ação automática fica na auditoria.
          Os prazos ficam em <Link href="/admin/configuracoes" className="font-semibold text-verde hover:underline">Configurações › Central operacional</Link>.</>}
        acoes={<RodarAutomacoes />} />

      <div className={LISTA}>
        {regras.map((r) => (
          <div key={r.nome} className="flex flex-wrap items-start gap-4 px-5 py-4">
            <Bot className="mt-0.5 size-5 shrink-0 text-ouro" />
            <div className="min-w-60 flex-1">
              <p className="font-medium text-texto">{r.nome}</p>
              <p className="mt-1 text-sm text-texto-2"><strong className="font-semibold text-texto">Quando:</strong> {r.quando}</p>
              <p className="text-sm text-texto-2"><strong className="font-semibold text-texto">O que faz:</strong> {r.faz}</p>
            </div>
            <Etiqueta tom="neutro">{setorPorId(r.setor)?.nome}</Etiqueta>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="lp-display text-xl text-texto">Últimas tarefas criadas pelas regras</h2>
        {error ? (
          <p className="text-sm text-texto-2">Disponível depois da migration 0065.</p>
        ) : (
          <div className={LISTA}>
            {(recentes ?? []).map((t) => (
              <Link key={t.id} href={`/admin/tarefas/${t.id}`} className={LINHA_LISTA}>
                <span className="font-mono text-xs text-texto-2">{t.codigo}</span>
                <span className="min-w-48 flex-1 font-medium text-texto">{t.titulo}</span>
                <span className="text-xs text-texto-2">{t.regra}</span>
                <Etiqueta tom={t.status === "concluida" ? "verde" : "ouro"}>{t.status}</Etiqueta>
              </Link>
            ))}
            {!recentes?.length && <p className="px-5 py-8 text-center text-sm text-texto-2">Nenhuma tarefa automática ainda.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
