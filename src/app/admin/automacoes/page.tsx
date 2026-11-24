import Link from "next/link";
import { Bot } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { lerConfiguracoes, numero } from "@/lib/settings";
import { setorPorId } from "@/lib/setores";
import { CabecalhoPagina, Etiqueta } from "@/components/ui/Pagina";
import { LISTA, LINHA_LISTA } from "@/components/admin/estilos";
import RodarAutomacoes from "@/components/admin/RodarAutomacoes";
import PrazosMatriz from "@/components/admin/PrazosMatriz";
import { lerPrazos } from "@/lib/matriz-servidor";
import { removerExcecao, salvarPrazo } from "./acoes";
import EditorAutomacoes, { type RegraAutomacao } from "@/components/admin/EditorAutomacoes";

/**
 * Regras automáticas da Central (bloco 1). Cada regra observa um evento e cria
 * no máximo uma tarefa por ocorrência; toda ação automática vai para a
 * auditoria. O worker roda a cada 10 min; aqui a Diretoria roda na hora.
 */
export default async function Automacoes({ searchParams }: PageProps<"/admin/automacoes">) {
  await exigirSetor("diretoria");
  const avisoPrazos = (await searchParams).prazos;
  const cfg = await lerConfiguracoes();
  const n = (k: string, alt: number) => numero(cfg, k, alt);

  const regras = [
    { nome: "Imóvel publicado com material incompleto", setor: "marketing",
      quando: "Imóvel publicado ou em negociação sem foto de capa ou sem descrição.",
      faz: "Abre tarefa de material, com prazo do setor. Confere novamente o imóvel antes de concluir a tarefa; não tira o anúncio do ar." },
    { nome: "Autorização vencendo", setor: "juridico",
      quando: "Autorização de imóvel ativo vencida ou que vence nos próximos 30 dias.",
      faz: "Cria tarefa com a validade registrada como prazo. Renovação, encerramento ou retirada do imóvel da fila encerram a pendência com evidência; nenhuma renovação é automática." },
    { nome: "Pedido de titular recebido", setor: "juridico",
      quando: "Pedido LGPD recebido ou em análise.",
      faz: "Cria tarefa com o prazo já registrado no pedido. Fecha quando a decisão humana é registrada; a Ari não responde nem decide pelo Jurídico." },
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
    { nome: "Cobrança por níveis", setor: "diretoria",
      quando: "Toda tarefa aberta, pelo prazo dela (quem não dá prazo recebe o padrão do setor, abaixo).",
      faz: "Nível 1 na metade do prazo: lembrete ao responsável. Nível 2 no vencimento: aviso ao gestor do setor (sem gestor, à Diretoria). Nível 3 além do limite do setor: fila de gargalos da Matriz e um aviso por dia à Diretoria. Prazo novo e mais longo zera a cobrança." },
    { nome: "Resumo diário da Ari", setor: "diretoria",
      quando: "Uma vez por dia, a partir das 7 h (e sempre que você clica em Rodar agora).",
      faz: "Mostra na Matriz o que está aberto, vencido e concluído em cada setor, e aponta o setor com déficit (mais demanda do que a equipe consegue entregar). Gestores recebem o resumo do próprio setor quando há algo vencido." },
    { nome: "Saída da equipe", setor: "diretoria",
      quando: "Pessoa desativada, que deixou a equipe ou que saiu de um setor.",
      faz: "As tarefas abertas dela naquele setor vão para o gestor do setor; sem gestor, voltam para a fila do setor e o aviso vai para quem responde por ele." },
  ];
  const prazos = await lerPrazos();
  const { data: regrasUsadas } = await supabaseAdmin().from("tasks").select("regra").not("regra", "is", null)
    .order("created_at", { ascending: false }).limit(500);
  const tipos = [...new Set((regrasUsadas ?? []).map((r) => String(r.regra)))].filter((r) => /^[a-z0-9_]+$/.test(r)).sort();

  // Editor de regras da Diretoria (0168). Sem a migration, a seção avisa e some o resto.
  const [regrasCfg, catalogo] = await Promise.all([
    supabaseAdmin().from("automacao_regras")
      .select("id, versao, nome, gatilho, evento, condicao_campo, condicao_valor, setor, titulo, descricao, prazo_dias, prioridade, intervalo_dias, proxima_data, ativa")
      .order("created_at"),
    supabaseAdmin().from("automacao_catalogo").select("evento, nome, campos").order("nome"),
  ]);
  const editorPronto = !regrasCfg.error && !catalogo.error;

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

      <EditorAutomacoes pronto={editorPronto} regras={(regrasCfg.data ?? []) as RegraAutomacao[]}
        catalogo={(catalogo.data ?? []) as { evento: string; nome: string; campos: string[] }[]} />

      <section id="prazos" className="scroll-mt-24 space-y-3">
        <h2 className="lp-display text-xl text-texto">Prazos e limites por setor</h2>
        <p className="text-sm text-texto-2">
          Prazo: dias que uma tarefa sem prazo recebe ao nascer. Limite: dias de atraso até a tarefa ir para a fila de gargalos (nível 3).
          Atenção e crítico: quantas vencidas mudam a cor do bloco do setor na Matriz.
        </p>
        {avisoPrazos === "salvo" && <p className="rounded-lg border border-verde/40 bg-verde/10 px-4 py-2 text-sm text-verde">Salvo. Vale na próxima rodada do motor.</p>}
        {avisoPrazos === "erro" && <p className="rounded-lg border border-critico/40 bg-critico/10 px-4 py-2 text-sm text-critico">Não foi possível salvar. Confira os números.</p>}
        {!prazos.pronto ? (
          <p className="text-sm text-texto-2">Disponível depois da migration 0162.</p>
        ) : (
          <PrazosMatriz linhas={prazos.linhas} tipos={tipos} salvar={salvarPrazo} remover={removerExcecao} />
        )}
      </section>

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
