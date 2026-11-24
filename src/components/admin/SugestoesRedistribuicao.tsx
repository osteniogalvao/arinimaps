import Link from "next/link";
import type { SugestaoRedistribuicao } from "@/lib/redistribuicao";
import { setorPorId } from "@/lib/setores";

export default function SugestoesRedistribuicao({ sugestoes, erro }: { sugestoes: SugestaoRedistribuicao[]; erro: string | null }) {
  return <section className="cartao space-y-4 p-5" aria-labelledby="redistribuicao-titulo">
    <h2 id="redistribuicao-titulo" className="text-lg font-semibold">Sugestões de redistribuição</h2>
    <p className="text-sm text-texto-2">Ari compara a carga atual de tarefas, leads e CRM com a capacidade combinada. Sugere colegas do mesmo setor com menor ocupação; em empate, considera o menor tempo médio de conclusão nos últimos 90 dias. Revise o contexto antes de decidir. Nenhuma transferência é automática.</p>
    {erro ? <p role="alert" className="text-alerta">{erro}</p> : !sugestoes.length ? <p className="text-sm text-texto-2">Nenhuma redistribuição elegível com a carga e a capacidade atuais.</p> : <ul className="space-y-4">
      {sugestoes.map(s => <li key={s.id} className="rounded-lg border border-linha p-4 text-sm">
        <p className="font-semibold">{s.titulo} · {setorPorId(s.setor)?.nome ?? s.setor}</p>
        <p className="mt-1">Revisar com {s.origem} ({s.cargaOrigem}/{s.capacidadeOrigem}) a passagem para {s.destino} ({s.cargaDestino}/{s.capacidadeDestino}).</p>
        <p className="mt-1 text-texto-2">{s.mediaDias === null ? "Sem conclusões históricas desta pessoa neste setor; sugestão baseada na carga." : `Tempo médio entre criação e conclusão: ${s.mediaDias.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias, em ${s.amostras} tarefa(s). Inclui espera, não representa horas trabalhadas.`}</p>
        <Link href={`/admin/tarefas/${s.id}`} className="mt-2 inline-block font-semibold text-verde hover:underline">Revisar tarefa</Link>
      </li>)}
    </ul>}
  </section>;
}
