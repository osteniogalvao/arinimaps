import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { CircleCheck, FileText, GitCompareArrows, Inbox, UserCheck } from "lucide-react";
import { STATUS_LABEL, plural } from "@/lib/format";
import { CabecalhoSetor, Indicadores, Secao, TarefasDoSetor, contar, dataBR, LinkAcao } from "@/components/admin/Painel";
import { CODIGO, LINHA_LISTA, LISTA, LISTA_VAZIA } from "@/components/admin/estilos";
import { Etiqueta } from "@/components/ui/Pagina";

const dias = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);

/** Operações: as filas de análise — anúncios, documentos e cadastros. */
export default async function PainelOperacoes() {
  const user = await exigirSetor("operacoes");
  const admin = supabaseAdmin();
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [emAnalise, parceiros, proprietarios, publicadosMes, { data: fila }, { data: docs }, { data: revisoes }] = await Promise.all([
    contar("properties", (q) => q.in("status", ["pendente", "em_analise", "correcao"])),
    contar("partners", (q) => q.in("status", ["solicitado", "em_analise"])),
    contar("owners", (q) => q.in("status", ["solicitado", "em_analise"])),
    contar("properties", (q) => q.gte("published_at", inicioMes)),
    admin.from("properties")
      .select("id, codigo, titulo, tipo, status, created_at, car_codigo, municipality:municipalities!properties_municipality_id_fkey(nome)")
      .in("status", ["pendente", "em_analise", "correcao", "aprovado"])
      .order("created_at").limit(30),
    admin.from("property_documents")
      .select("id, tipo, nome_arquivo, created_at, property:properties(id, codigo, titulo, status)")
      .eq("verificado", false).is("substituido_por", null).order("created_at").limit(40),
    // Fluxograma §9: alterações propostas em anúncios publicados
    admin.from("property_revisions")
      .select("id, versao, dados, created_at, property:properties(id, codigo, titulo)")
      .eq("status", "pendente").order("created_at").limit(30),
  ]);
  type Rev = { id: string; versao: number; dados: Record<string, unknown>; created_at: string; property: { id: string; codigo: string; titulo: string } | null };
  const alteracoes = ((revisoes ?? []) as unknown as Rev[]).filter((r) => r.property);

  type Doc = { id: string; tipo: string; nome_arquivo: string | null; created_at: string; property: { id: string; codigo: string; titulo: string; status: string } | null };
  const pendentes = ((docs ?? []) as unknown as Doc[])
    .filter((d) => d.property && !["reprovado", "inativo", "historico"].includes(d.property.status));

  return (
    <div className="space-y-10 md:space-y-12">
      <CabecalhoSetor setor="operacoes" />

      <Indicadores itens={[
        { rotulo: "Anúncios na fila de análise", icone: Inbox, valor: emAnalise, href: "/admin/imoveis?filtro=analise", destaque: emAnalise > 0 },
        { rotulo: "Documentos sem conferência", icone: FileText, valor: pendentes.length, destaque: pendentes.length > 0 },
        { rotulo: "Alterações propostas", icone: GitCompareArrows, valor: alteracoes.length, href: "/admin/imoveis?revisao=1", destaque: alteracoes.length > 0,
          nota: "anúncios publicados com nova versão" },
        { rotulo: "Cadastros para aprovar", icone: UserCheck, valor: parceiros + proprietarios, href: "/admin/cadastros", destaque: parceiros + proprietarios > 0,
          nota: `${plural(parceiros, "parceiro")} · ${plural(proprietarios, "proprietário")}` },
        { rotulo: "Publicados neste mês", icone: CircleCheck, valor: publicadosMes },
      ]} />

      <Secao titulo="Anúncios aguardando decisão" acao={<LinkAcao href="/admin/imoveis">Todos os imóveis</LinkAcao>}>
        <div className={LISTA}>
          {(fila ?? []).map((p) => {
            const espera = dias(p.created_at);
            return (
              <Link key={p.id} href={`/admin/imoveis/${p.id}`}
                className={LINHA_LISTA}>
                <span className={CODIGO}>{p.codigo}</span>
                <span className="flex-1 min-w-48 font-medium text-texto">
                  {p.titulo}
                  <span className="font-normal text-texto-2 text-sm">
                    {" · "}{(p.municipality as unknown as { nome: string } | null)?.nome ?? "sem município"} · {p.tipo}
                    {p.car_codigo && " · divisa do CAR"}
                  </span>
                </span>
                <Etiqueta>{STATUS_LABEL[p.status] ?? p.status}</Etiqueta>
                <span className={"text-xs font-medium tabular-nums whitespace-nowrap " + (espera >= 3 ? "text-alerta" : "text-texto-2")}>
                  {espera === 0 ? "hoje" : `há ${espera} dia${espera === 1 ? "" : "s"}`}
                </span>
              </Link>
            );
          })}
          {!fila?.length && <p className={LISTA_VAZIA}>Fila vazia: nenhum anúncio esperando análise.</p>}
        </div>
      </Secao>

      <Secao titulo="Documentos aguardando conferência">
        <p className="-mt-1 text-[0.95rem] leading-relaxed text-texto-2">
          Sem a matrícula conferida o sistema não deixa aprovar nem publicar o imóvel.
        </p>
        <div className={LISTA}>
          {pendentes.map((d) => (
            <Link key={d.id} href={`/admin/imoveis/${d.property!.id}`}
              className={LINHA_LISTA}>
              <span className={CODIGO}>{d.property!.codigo}</span>
              <span className="flex-1 min-w-48">
                <span className="font-medium text-texto capitalize">{d.tipo.replace(/_/g, " / ")}</span>
                <span className="text-sm text-texto-2"> · {d.nome_arquivo ?? "arquivo"} · {d.property!.titulo}</span>
              </span>
              <span className="text-xs text-texto-2">{dataBR(d.created_at)}</span>
            </Link>
          ))}
          {!pendentes.length && <p className={LISTA_VAZIA}>Nenhum documento esperando conferência.</p>}
        </div>
      </Secao>

      <Secao titulo="Alterações propostas em anúncios publicados" acao={<LinkAcao href="/admin/imoveis?revisao=1">Ver fila</LinkAcao>}>
        <p className="-mt-1 text-[0.95rem] leading-relaxed text-texto-2">
          O anúncio atual continua no ar até a decisão; aprovar aplica a nova versão.
        </p>
        <div className={LISTA}>
          {alteracoes.map((r) => {
            const espera = dias(r.created_at);
            return (
              <Link key={r.id} href={`/admin/imoveis/${r.property!.id}`}
                className={LINHA_LISTA}>
                <span className={CODIGO}>{r.property!.codigo}</span>
                <span className="flex-1 min-w-48 font-medium text-texto">
                  {r.property!.titulo}
                  <span className="font-normal text-texto-2 text-sm"> · versão {r.versao} · {Object.keys(r.dados ?? {}).join(", ")}</span>
                </span>
                <span className={"text-xs font-medium tabular-nums whitespace-nowrap " + (espera >= 3 ? "text-alerta" : "text-texto-2")}>
                  {espera === 0 ? "hoje" : `há ${espera} dia${espera === 1 ? "" : "s"}`}
                </span>
              </Link>
            );
          })}
          {!alteracoes.length && <p className={LISTA_VAZIA}>Nenhuma alteração esperando decisão.</p>}
        </div>
      </Secao>

      <TarefasDoSetor setor="operacoes" souEu={user.id} />
    </div>
  );
}
