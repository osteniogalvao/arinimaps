import { notFound } from "next/navigation";
import { FileWarning, PencilLine, FolderLock, Video, type LucideIcon } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatBRL, STATUS_LABEL } from "@/lib/format";
import DocumentosImovel from "@/components/crm/DocumentosImovel";
import VideosImovel from "@/components/crm/VideosImovel";
import HistoricoImovel from "@/components/crm/HistoricoImovel";
import ProporAlteracao from "./ProporAlteracao";
import { Etiqueta } from "@/components/ui/Pagina";
import { exigirAnunciante } from "@/lib/imovel/anunciante";

const TOM: Record<string, "verde" | "ouro" | "alerta" | "critico" | "neutro"> = {
  rascunho: "neutro", pendente: "alerta", em_analise: "alerta", correcao: "alerta", aprovado: "verde",
  publicado: "verde", em_negociacao: "ouro", vendido: "neutro", reprovado: "critico",
};

export default async function MeuImovel({ params }: PageProps<"/painel/imoveis/[id]">) {
  const { id } = await params;
  // A RLS libera anúncio publicado para todos: o dono é conferido aqui (auditoria 09/11)
  await exigirAnunciante(id);
  const supabase = await supabaseServer();
  const { data: p } = await supabase
    .from("properties")
    .select("id, codigo, titulo, descricao, tipo, status, valor, area_declarada, condicoes_venda, aceita_permuta, aceita_financiamento, motivo_correcao, pendencia_tipo, caracteristicas")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();
  const admin = supabaseAdmin();
  const [{ data: midia }, { data: revisao }] = await Promise.all([
    supabase.from("property_media").select("id, storage_path").eq("property_id", id).eq("tipo", "video").order("ordem"),
    // Fluxograma §9: proposta de alteração aguardando a Matriz
    admin.from("property_revisions").select("id, versao, dados, created_at")
      .eq("property_id", id).eq("status", "pendente").maybeSingle(),
  ]);
  const videos = (midia ?? []).map((m) => ({
    id: m.id, url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${m.storage_path}`,
  }));

  // Fluxograma §7: mesmo status `correcao`, pendência diferente
  const complemento = p.status === "correcao" && p.pendencia_tipo === "complemento";
  const rotuloStatus = complemento ? "Aguardando complemento" : STATUS_LABEL[p.status];
  const publicado = ["publicado", "em_negociacao"].includes(p.status);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        {/* voltar, código, título e abas ficam no layout do imóvel */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-lg font-semibold tabular-nums text-texto">{formatBRL(p.valor)}</span>
          <Etiqueta tom={TOM[p.status] ?? "neutro"}>{rotuloStatus}</Etiqueta>
          {revisao && <Etiqueta tom="alerta">alteração em análise</Etiqueta>}
        </div>
        {p.motivo_correcao && (
          <p className="mt-5 flex items-start gap-3 rounded-2xl border border-alerta/40 bg-alerta/10 px-5 py-4 text-base text-alerta">
            <FileWarning className="mt-0.5 size-5 shrink-0" />
            <span>{complemento ? "A Arini pediu informações complementares" : "A Arini pediu correção"}: {p.motivo_correcao}</span>
          </p>
        )}
      </div>

      {publicado && (
        <Bloco icone={PencilLine} titulo="Alteração do anúncio">
          <ProporAlteracao
            propertyId={p.id}
            tipo={p.tipo as "urbano" | "rural"}
            atual={{
              titulo: p.titulo, descricao: p.descricao ?? "", valor: p.valor, area_declarada: p.area_declarada,
              condicoes_venda: p.condicoes_venda, aceita_permuta: !!p.aceita_permuta, aceita_financiamento: !!p.aceita_financiamento,
              tour_virtual_url: typeof p.caracteristicas?.tour_virtual_url === "string" ? p.caracteristicas.tour_virtual_url : null,
            }}
            pendente={revisao ? { id: revisao.id, versao: revisao.versao, dados: (revisao.dados ?? {}) as Record<string, unknown>, created_at: revisao.created_at } : null}
          />
        </Bloco>
      )}

      <Bloco icone={FolderLock} titulo="Documentos do imóvel"
        texto={<>Matrícula, CAR, ITR, planta DWG, autorização de venda — quanto mais completo, mais rápida a aprovação.
          Os arquivos ficam num cofre privado; só você e a Arini acessam.</>}>
        <DocumentosImovel propertyId={p.id} />
      </Bloco>

      <Bloco icone={Video} titulo="Vídeos do imóvel"
        texto="Um vídeo curto da sede, do acesso ou das benfeitorias ajuda muito na decisão. Ele entra na galeria do anúncio.">
        <VideosImovel propertyId={p.id} videos={videos} />
      </Bloco>

      {/* §1: histórico do imóvel — versões da divisa, origem dos dados, alterações e auditoria */}
      <HistoricoImovel propertyId={p.id} modo="painel" tipoImovel={p.tipo as "urbano" | "rural"} />
    </div>
  );
}

function Bloco({ icone: Icone, titulo, texto, children }: {
  icone: LucideIcon; titulo: string; texto?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="cartao p-5 md:p-7">
      <header className="mb-5 flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde">
          <Icone className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="lp-display text-xl md:text-2xl text-texto">{titulo}</h2>
          {texto && <p className="mt-1.5 text-base leading-relaxed text-texto-2">{texto}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}
