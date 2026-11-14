import Link from "next/link";
import { Building2, Clock, CheckCircle2, Handshake, Plus, AlertTriangle, FileWarning, ArrowRight } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { acessoDe } from "@/lib/planos-servidor";
import { formatBRL, STATUS_LABEL } from "@/lib/format";
import { Secao, Estatistica, Vazio, Etiqueta, BotaoLink } from "@/components/ui/Pagina";
import MiniaturaDivisa, { type GeoDivisa } from "@/components/imovel/MiniaturaDivisa";
import { pendenciasIntermediador } from "@/lib/acompanhamento/servidor";
import PendenciasIntermediador from "@/components/acompanhamento/PendenciasIntermediador";

type Tom = "verde" | "ouro" | "alerta" | "critico" | "neutro";
const STATUS_TOM: Record<string, Tom> = {
  rascunho: "neutro",
  pendente: "alerta",
  em_analise: "alerta",
  correcao: "alerta",
  aprovado: "verde",
  publicado: "verde",
  em_negociacao: "ouro",
  vendido: "neutro",
  reprovado: "critico",
};
const EM_ANALISE = ["pendente", "em_analise", "correcao"];

const CAMPOS = "id, codigo, titulo, tipo, status, valor, motivo_correcao, pendencia_tipo, created_at, media:property_media(storage_path, capa, tipo), geo:property_geometries(geom)";

function mediaUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

export default async function MeusImoveis({ searchParams }: PageProps<"/painel">) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const sp = await searchParams;
  const umParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const enviado = umParam(sp.enviado).replace(/[^A-Za-z0-9-]/g, "").slice(0, 30);
  const videosFalharam = Math.max(0, Math.min(99, Number(umParam(sp.videos_falharam)) || 0));
  const docsFalharam = Math.max(0, Math.min(99, Number(umParam(sp.docs_falharam)) || 0));

  // cadastro (owner/partner) do PRÓPRIO usuário — a equipe enxerga todos pela RLS
  const [{ data: owner }, { data: partner }, acesso] = user
    ? await Promise.all([
        supabase.from("owners").select("id, status").eq("profile_id", user.id).maybeSingle(),
        supabase.from("partners").select("id, status").eq("profile_id", user.id).maybeSingle(),
        acessoDe(user.id).catch(() => null),
      ])
    : [{ data: null }, { data: null }, null];
  const anunciar = acesso?.recursos.has("anunciar") ?? false;
  const statusCadastro = owner?.status ?? partner?.status;

  // A RLS libera anúncio publicado para todos: o filtro pelo dono é obrigatório
  // (auditoria 09/11/2026 — "Meus imóveis" listava imóveis de outros anunciantes)
  const filtroDono = [owner?.id && `owner_id.eq.${owner.id}`, partner?.id && `partner_id.eq.${partner.id}`]
    .filter(Boolean).join(",");
  const [{ data: imoveis }, { data: publicados }] = filtroDono
    ? await Promise.all([
        supabase.from("properties").select(CAMPOS).or(filtroDono)
          .not("status", "in", '("publicado","em_negociacao","vendido","historico")')
          .order("created_at", { ascending: false }).limit(200),
        supabase.from("properties").select(CAMPOS).or(filtroDono)
          .in("status", ["publicado", "em_negociacao", "vendido"])
          .order("created_at", { ascending: false }).limit(200),
      ])
    : [{ data: [] }, { data: [] }];
  const aguardando = statusCadastro && !["aprovado", "ativo"].includes(statusCadastro);

  const meus = [...(imoveis ?? []), ...(publicados ?? [])];

  // Fluxograma §9: anúncios publicados com alteração aguardando a Matriz
  const { data: revisoes } = meus.length
    ? await supabaseAdmin().from("property_revisions").select("property_id")
        .in("property_id", meus.map((p) => p.id)).eq("status", "pendente")
    : { data: [] };
  const comRevisao = new Set((revisoes ?? []).map((r) => r.property_id));

  // RLS: só as oportunidades encaminhadas a esta conta
  const { count: oportunidades } = await supabase
    .from("opportunities").select("id", { count: "exact", head: true });

  const emAnalise = meus.filter((p) => EM_ANALISE.includes(p.status)).length;
  const noAr = meus.filter((p) => ["publicado", "em_negociacao"].includes(p.status)).length;

  // item 28: o corretor parceiro vê as pendências com os proprietários
  const pendencias = partner?.id && ["aprovado", "ativo"].includes(partner.status)
    ? await pendenciasIntermediador({ partnerId: partner.id }).catch(() => null)
    : null;

  return (
    <div className="space-y-10 md:space-y-12">
      {enviado && (
        <div className="flex items-start gap-3 rounded-2xl border border-verde/30 bg-verde/10 px-5 py-4 text-base text-verde">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
          <p>Imóvel <strong className="font-mono">{enviado}</strong> enviado. A Arini analisa o cadastro antes de publicar.</p>
        </div>
      )}
      {(videosFalharam > 0 || docsFalharam > 0) && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-alerta/40 bg-alerta/10 px-5 py-4 text-base text-alerta">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p>
            O imóvel foi criado, mas {[
              videosFalharam > 0 && (videosFalharam === 1 ? "1 vídeo não foi enviado" : `${videosFalharam} vídeos não foram enviados`),
              docsFalharam > 0 && (docsFalharam === 1 ? "1 documento não foi enviado" : `${docsFalharam} documentos não foram enviados`),
            ].filter(Boolean).join(" e ")}. Abra o imóvel abaixo e envie de novo nas seções de vídeos e documentos.
          </p>
        </div>
      )}
      {aguardando && (
        <div className="flex items-start gap-3 rounded-2xl border border-alerta/40 bg-alerta/10 px-5 py-4 text-base text-alerta">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p>
            Seu cadastro está <strong>{STATUS_LABEL[statusCadastro!] ?? statusCadastro}</strong> na análise da Arini.
            {anunciar && " A equipe acompanhará os anúncios enviados para análise."}
          </p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        <Estatistica icone={Clock} valor={emAnalise} rotulo="Em análise pela Arini" urgente={emAnalise > 0} />
        <Estatistica icone={CheckCircle2} valor={noAr} rotulo="Publicados no site" />
        <Estatistica icone={Handshake} valor={oportunidades ?? 0} rotulo="Oportunidades encaminhadas" href="/painel/oportunidades" />
      </div>

      {pendencias && <PendenciasIntermediador pendencias={pendencias} hrefOportunidade="/painel/oportunidades" />}

      <Secao
        eyebrow="Seus anúncios"
        titulo="Meus imóveis"
        subtitulo="Acompanhe seus anúncios e o status de análise."
        acao={anunciar && <BotaoLink href="/painel/novo" seta={false}><Plus /> Anunciar imóvel</BotaoLink>}
      >
        {meus.length === 0 ? (
          <Vazio
            icone={Building2}
            titulo="Nenhum imóvel ainda"
            texto={anunciar ? <>Clique em <strong>Anunciar imóvel</strong> para começar. A Arini analisa o cadastro antes de publicar.</> : undefined}
            acao={anunciar && <BotaoLink href="/painel/novo">Anunciar imóvel</BotaoLink>}
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {meus.map((p) => {
              const fotos = ((p.media ?? []) as { storage_path: string; capa: boolean | null; tipo: string | null }[])
                .filter((m) => m.tipo !== "video");
              const capa = fotos.find((m) => m.capa) ?? fotos[0];
              const geo = p.geo as unknown as { geom: GeoDivisa } | { geom: GeoDivisa }[] | null;
              const geom = (Array.isArray(geo) ? geo[0] : geo)?.geom;
              const complemento = p.status === "correcao" && p.pendencia_tipo === "complemento";
              return (
                <Link key={p.id} href={`/painel/imoveis/${p.id}`}
                  className="cartao cartao-link group flex flex-col overflow-hidden">
                  <div className="relative h-44 overflow-hidden bg-superficie-2">
                    {!capa && geom ? (
                      // sem foto: o próprio terreno visto do satélite, com a divisa
                      <MiniaturaDivisa geom={geom}
                        className={"h-full w-full transition-transform duration-500 group-hover:scale-105" + (p.status === "vendido" ? " grayscale" : "")} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={capa ? mediaUrl(capa.storage_path) : p.tipo === "rural" ? "/img/aerea-campo.jpg" : "/img/casa-urbana.jpg"}
                        alt={p.titulo}
                        className={"h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 " + (capa ? "" : "opacity-60") + (p.status === "vendido" ? " grayscale" : "")} />
                    )}
                    <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                      <Etiqueta tom={STATUS_TOM[p.status] ?? "neutro"} className="!bg-superficie shadow-sm">
                        {complemento ? "Aguardando complemento" : STATUS_LABEL[p.status] ?? p.status}
                      </Etiqueta>
                      {comRevisao.has(p.id) && (
                        <Etiqueta tom="alerta" className="!bg-superficie shadow-sm">alteração em análise</Etiqueta>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <p className="font-mono text-xs text-texto-2">{p.codigo} · <span className="capitalize">{p.tipo}</span></p>
                    <p className="lp-display mt-1.5 text-lg leading-snug text-texto group-hover:text-verde transition-colors">{p.titulo}</p>
                    <p className="mt-2 text-base font-semibold tabular-nums text-texto">{formatBRL(p.valor)}</p>
                    {p.motivo_correcao && (
                      <p className="mt-4 flex gap-2 rounded-xl border border-alerta/30 bg-alerta/10 px-3 py-2.5 text-sm text-alerta">
                        <FileWarning className="mt-0.5 size-4 shrink-0" />
                        <span>
                          <strong>{complemento ? "Complemento solicitado" : "Correção solicitada"}:</strong> {p.motivo_correcao}
                        </span>
                      </p>
                    )}
                    <span className="mt-auto flex items-center gap-1.5 pt-4 text-sm font-semibold text-verde">
                      Abrir imóvel <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Secao>
    </div>
  );
}
