import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Regras, { type RegraContato } from "./Regras";

const status: Record<string, string> = {
  painel: "Somente painel",
  pendente: "Aguardando WhatsApp",
  enviando: "Entrega em processamento",
  enviado: "Enviado ao WhatsApp",
  recusado: "Recusado pelo WhatsApp",
  conferir: "Conferir entrega",
  cancelado: "Envio interrompido",
};
export default async function Contatos({ searchParams }: PageProps<"/admin/planos/contatos">) {
  const a = await exigirSetor("comercial", "financeiro", "diretoria");
  const editar = a.setores.includes("financeiro") || a.setores.includes("diretoria");
  const db = supabaseAdmin();
  const pagina = Math.max(1, Math.min(100000, Math.trunc(Number((await searchParams).pagina) || 1)));
  const inicio = (pagina - 1) * 30;
  const [regras, historico, retomadas] = await Promise.all([
    editar
      ? db.from("assinatura_regras_contato").select("*").order("tipo")
      : Promise.resolve({ data: [], error: null }),
    db
      .from("assinatura_contatos")
      .select("id,assinatura,criado_em,texto,status,passo,tipo,profiles!inner(nome)")
      .order("criado_em", { ascending: false })
      .order("id", { ascending: false })
      .range(inicio, inicio + 30),
    db
      .from("retomadas_cadastro")
      .select("id,nome,telefone,plano,status,retomadas_tentativas(passo,status)")
      .order("autorizado_em", { ascending: false })
      .range(inicio, inicio + 30),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CabecalhoPagina titulo="Assinaturas e contatos" eyebrow="Central" />
      <nav className="flex flex-wrap gap-4">
        <Link href="/admin/tarefas" className="underline">
          Distribuir e acompanhar tarefas
        </Link>
        {editar && (
          <Link href="/admin/planos/solicitacoes" className="underline">
            Abrir solicitações de planos
          </Link>
        )}
      </nav>
      {(regras.error || historico.error || retomadas.error) && (
        <p role="alert">Falha ao carregar os registros de contato.</p>
      )}
      {editar && regras.data && <Regras regras={regras.data as RegraContato[]} />}
      {!!retomadas.data?.length && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Cadastros interrompidos</h2>
          {retomadas.data.slice(0, 30).map((r) => (
            <article key={r.id} className="cartao p-4">
              <p>
                {r.nome} · {r.plano} · {r.status}
              </p>
              <p className="text-sm">
                {r.telefone} · Cadastro {r.id}
              </p>
              {r.retomadas_tentativas.map((t: { passo: number; status: string }) => (
                <p key={t.passo} className="text-sm">
                  Tentativa {t.passo} · {status[t.status]}
                </p>
              ))}
            </article>
          ))}
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Histórico de contatos</h2>
        {historico.data?.length === 0 && <p>Nenhuma tentativa registrada nesta página.</p>}
        {(historico.data ?? []).slice(0, 30).map((c) => (
          <article className="cartao p-4" key={c.id}>
            <p className="font-semibold">
              {(c.profiles as unknown as { nome: string }).nome} · {status[c.status]}
            </p>
            <p>{c.texto}</p>
            <p className="text-sm text-texto-2">
              {new Date(c.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Pedido{" "}
              {c.assinatura}
              {c.tipo === "recuperacao" && " · Tentativa " + c.passo}
            </p>
          </article>
        ))}
        <nav aria-label="Páginas do histórico" className="flex gap-4">
          {pagina > 1 && (
            <Link className="underline" href={"?pagina=" + (pagina - 1)}>
              Anterior
            </Link>
          )}
          {Math.max(historico.data?.length ?? 0, retomadas.data?.length ?? 0) > 30 && (
            <Link className="underline" href={"?pagina=" + (pagina + 1)}>
              Próxima
            </Link>
          )}
        </nav>
      </section>
    </div>
  );
}
