import Conversa from "@/components/admin/Conversa";
import { notFound } from "next/navigation";
import { urlArquivo } from "@/lib/seguranca/link-arquivo";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatBRL, formatArea, STATUS_LABEL, plural } from "@/lib/format";
import MiniMapa from "@/components/map/MiniMapa";
import DecisaoBotoes from "./DecisaoBotoes";
import RevisaoBotoes from "./RevisaoBotoes";
import MatriculaAdmin from "./MatriculaAdmin";
import MatriculaSigef from "@/components/rural/MatriculaSigef";
import DocumentosImovel from "@/components/crm/DocumentosImovel";
import HistoricoImovel from "@/components/crm/HistoricoImovel";
import MinhaAreaCliente from "@/components/imovel/MinhaAreaCliente";
import { CAMPO_REVISAO_LABEL, valorRevisao } from "@/lib/imovel/revisao";
import ConsultaRural from "@/components/rural/ConsultaRural";
import { exigirSetor } from "@/lib/setores-servidor";
import SecaoAvaliacaoAdmin from "@/components/avaliacao/SecaoAvaliacaoAdmin";
import { TABELA, TBODY, TH, THEAD } from "@/components/admin/estilos";
import {
  Camera, CircleAlert, CircleCheck, CircleX, ExternalLink, Gavel, Hourglass, Map as IconeMapa, UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Etiqueta } from "@/components/ui/Pagina";

type Estado = "ok" | "aviso" | "erro" | "espera" | "info";
const ICONE_ESTADO: Record<Estado, { icone: LucideIcon; cor: string }> = {
  ok: { icone: CircleCheck, cor: "text-verde" },
  aviso: { icone: CircleAlert, cor: "text-alerta" },
  erro: { icone: CircleX, cor: "text-critico" },
  espera: { icone: Hourglass, cor: "text-ouro" },
  info: { icone: CircleAlert, cor: "text-texto-2" },
};

/** Linha do checklist: ícone de estado + texto. */
function Item({ estado, icone, children }: { estado: Estado; icone?: LucideIcon; children: React.ReactNode }) {
  const { icone: Padrao, cor } = ICONE_ESTADO[estado];
  const Icone = icone ?? Padrao;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icone className={`mt-0.5 size-[18px] shrink-0 ${icone ? "text-texto-2" : cor}`} />
      <span className="min-w-0 leading-relaxed">{children}</span>
    </li>
  );
}

/** Seção do dossiê do imóvel: cartão com título no padrão do site. */
function Bloco({ titulo, subtitulo, children, className = "" }: {
  titulo: string; subtitulo?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`cartao p-6 space-y-4 ${className}`}>
      <div>
        <h2 className="lp-display text-xl md:text-2xl text-texto">{titulo}</h2>
        {subtitulo && <p className="mt-1.5 text-[0.95rem] leading-relaxed text-texto-2">{subtitulo}</p>}
      </div>
      {children}
    </section>
  );
}

function mediaUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

export default async function AnaliseImovel
({ params }: PageProps<"/admin/imoveis/[id]">) {
  await exigirSetor("operacoes");
  const { id } = await params;
  const admin = supabaseAdmin();

  const { data: p } = await admin
    .from("properties")
    .select(`
      id, codigo, titulo, descricao, tipo, status, valor, area_declarada,
      caracteristicas, condicoes_venda, aceita_permuta, aceita_financiamento, exclusividade, motivo_correcao,
      pendencia_tipo, created_at, car_codigo, modalidade, leilao,
      municipality:municipalities!properties_municipality_id_fkey(nome, uf),
      owner:owners(id, profile:profiles(nome, telefone)),
      partner:partners(id, razao_social, tipo, profile:profiles(nome, telefone))
    `)
    .eq("id", id)
    .single();
  if (!p) notFound();

  const [{ data: geo }, { data: media }, { data: geoJson }, { data: autorizacao }, { data: documentos }, { data: revisao }] = await Promise.all([
    admin.from("property_geometries").select("area_m2, perimeter_m, fonte").eq("property_id", id).maybeSingle(),
    admin.from("property_media").select("tipo, storage_path").eq("property_id", id).order("ordem"),
    admin.rpc("fn_property_admin_geometry", { p_property_id: id }).then(
      (r) => r,
      () => ({ data: null })
    ),
    admin.from("property_authorizations")
      .select("tipo, validade, aceite_at, versao, aceite_ip, selfie_path")
      .eq("property_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("property_documents").select("tipo, verificado").eq("property_id", id).is("substituido_por", null),
    // Fluxograma §9: alteração proposta pelo anunciante, aguardando decisão
    admin.from("property_revisions").select("id, versao, dados, dados_anteriores, created_at, created_by")
      .eq("property_id", id).eq("status", "pendente").maybeSingle(),
  ]);
  const camposRevisao = revisao ? Object.keys((revisao.dados ?? {}) as Record<string, unknown>) : [];
  const { data: autorRevisao } = revisao?.created_by
    ? await admin.from("profiles").select("nome").eq("user_id", revisao.created_by).maybeSingle()
    : { data: null };
  const docs = documentos ?? [];
  // leilão é conferido pelo edital; venda comum, pela matrícula
  const ehLeilao = p.modalidade === "leilao";
  const docChave = ehLeilao ? "edital" : "matricula";
  const nomeDoc = ehLeilao ? "edital" : "matrícula";
  const matriculaConferida = docs.some((d) => d.tipo === docChave && d.verificado);
  const temMatricula = docs.some((d) => d.tipo === docChave);
  const lei = (p.leilao ?? {}) as Record<string, string | number | null>;
  const selfieUrl = autorizacao?.selfie_path
    ? urlArquivo(autorizacao.selfie_path)
    : null;
  const { data: matricula } = await admin.from("property_matriculas")
    .select("numero, cartorio, conferida_em").eq("property_id", p.id).maybeSingle();
  const car = p.car_codigo
    ? ((await admin.rpc("fn_car_imovel", { p_cod: p.car_codigo })).data as { properties?: { area_ha?: number; condicao?: string } } | null)
    : null;
  const CONDICAO: Record<string, string> = {
    autorizacao: "Autorização de venda (sem exclusividade)",
    exclusividade: "Exclusividade Arini",
    parceiro: "Imóvel de parceiro",
  };

  const owner = p.owner as unknown as { profile: { nome: string; telefone: string | null } } | null;
  const partner = p.partner as unknown as { razao_social: string; tipo: string; profile: { nome: string; telefone: string | null } } | null;
  const municipio = p.municipality as unknown as { nome: string; uf: string } | null;

  const areaDeclaradaM2 =
    p.area_declarada != null
      ? p.tipo === "rural" ? Number(p.area_declarada) * 10000 : Number(p.area_declarada)
      : null;
  const divergencia =
    geo?.area_m2 && areaDeclaradaM2
      ? Math.abs(geo.area_m2 - areaDeclaradaM2) / areaDeclaradaM2
      : null;

  const tomStatus = ["publicado", "aprovado", "em_negociacao"].includes(p.status) ? "verde"
    : ["pendente", "em_analise"].includes(p.status) ? "ouro"
    : p.status === "correcao" ? "alerta" : p.status === "reprovado" ? "critico" : "neutro";

  return (
    <div className="space-y-8 max-w-5xl">
      <header>
        <p className="lp-eyebrow text-xs">Análise do imóvel <span className="font-mono tracking-normal">{p.codigo}</span></p>
        <h1 className="lp-display mt-2 text-3xl md:text-[2.5rem] text-texto text-balance">{p.titulo}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-base text-texto-2">
          <span>{municipio ? `${municipio.nome} · ${municipio.uf}` : "Sem município"}</span>
          <span aria-hidden>·</span>
          <span className="capitalize">{p.tipo}</span>
          <Etiqueta tom={tomStatus}>
            {p.status === "correcao" && p.pendencia_tipo === "complemento" ? "Aguardando complemento" : STATUS_LABEL[p.status]}
          </Etiqueta>
        </p>
      </header>

      {revisao && (
        <Bloco titulo={`Alteração proposta pela versão ${revisao.versao}`} className="border-ouro/50 border-l-4 border-l-ouro"
          subtitulo={<>
            Enviada em {new Date(revisao.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
            {autorRevisao?.nome ? ` por ${autorRevisao.nome}` : ""}. O anúncio publicado continua no ar como está;
            aprovar substitui os campos abaixo.
          </>}>
          <div className="overflow-x-auto rounded-xl border border-linha">
            <table className={TABELA}>
              <thead>
                <tr className={THEAD}>
                  <th className={TH}>Campo</th>
                  <th className={TH}>Atual</th>
                  <th className={TH}>Proposto</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {camposRevisao.map((c) => (
                  <tr key={c} className="align-top">
                    <td className="px-4 py-3.5 font-semibold text-texto">{CAMPO_REVISAO_LABEL[c as keyof typeof CAMPO_REVISAO_LABEL] ?? c}</td>
                    <td className="px-4 py-3.5 text-texto-2 whitespace-pre-line">{valorRevisao(c, (p as unknown as Record<string, unknown>)[c])}</td>
                    <td className="px-4 py-3.5 text-texto whitespace-pre-line bg-verde/5">{valorRevisao(c, (revisao.dados as Record<string, unknown>)[c])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <RevisaoBotoes revisaoId={revisao.id} />
        </Bloco>
      )}

      <Bloco titulo="Checklist de análise">
        <ul className="divide-y divide-linha text-[0.95rem] text-texto">
          <Item estado={p.descricao ? "ok" : "aviso"}>Descrição {p.descricao ? "preenchida" : "vazia"}</Item>
          {typeof (p.caracteristicas as { medidas_informadas?: unknown } | null)?.medidas_informadas === "string" && (
            <Item estado="aviso">
              Medidas informadas pelo anunciante (conferir com a divisa):{" "}
              <span className="whitespace-pre-line">{(p.caracteristicas as { medidas_informadas: string }).medidas_informadas}</span>
            </Item>
          )}
          <Item estado={p.valor ? "ok" : "aviso"}>Valor: <span className="tabular-nums">{formatBRL(p.valor)}</span></Item>
          <Item estado={geo ? "ok" : "erro"}>Geometria {geo ? `(${geo.fonte}) — ${formatArea(geo.area_m2, p.tipo as "urbano" | "rural")}` : "ausente"}</Item>
          {divergencia != null && (
            <Item estado={divergencia > 0.1 ? "aviso" : "ok"}>
              Área medida vs declarada:{" "}
              <span className="tabular-nums">{(divergencia * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span> de diferença
              {divergencia > 0.1 && " — confirmar com o anunciante"}
            </Item>
          )}
          <Item estado={media?.length ? "ok" : "aviso"}>{plural(media?.length ?? 0, "foto")}</Item>
          <Item estado={matriculaConferida ? "ok" : temMatricula ? "espera" : "erro"}>
            {ehLeilao ? "Documento do leilão" : "Comprovação de propriedade"}:{" "}
            {matriculaConferida
              ? `${nomeDoc} conferid${ehLeilao ? "o" : "a"}`
              : temMatricula
                ? `${nomeDoc} enviad${ehLeilao ? "o" : "a"}, falta conferir (aprovar e publicar ficam bloqueados)`
                : `${nomeDoc} não enviad${ehLeilao ? "o" : "a"} — peça correção`}
            {" "}· {docs.length} documento(s), {docs.filter((d) => d.verificado).length} conferido(s)
          </Item>
          {selfieUrl && (
            <Item estado="info" icone={Camera}>
              Selfie do aceite da exclusividade:{" "}
              <a href={selfieUrl} target="_blank" className="inline-flex items-center gap-1 font-semibold text-verde hover:underline">abrir <ExternalLink className="size-3.5" /></a>
              {" — confira com o documento do proprietário."}
            </Item>
          )}
          {ehLeilao && (
            <Item estado="info" icone={Gavel}>
              Leilão{lei.comitente ? ` de ${lei.comitente}` : ""}
              {lei.praca1_data && ` — 1ª praça em ${new Date(String(lei.praca1_data)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`}
              {lei.praca1_lance != null && ` (lance mínimo ${formatBRL(Number(lei.praca1_lance))})`}
              {lei.praca2_data && `; 2ª praça em ${new Date(String(lei.praca2_data)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`}
              {lei.praca2_lance != null && ` (${formatBRL(Number(lei.praca2_lance))})`}
              {lei.processo && ` · ${lei.processo}`}
            </Item>
          )}
          {p.car_codigo && (
            <Item estado="info" icone={IconeMapa}>
              Divisa trazida do CAR <span className="font-mono text-xs">{p.car_codigo}</span>
              {car?.properties?.area_ha != null && <> — {Number(car.properties.area_ha).toLocaleString("pt-BR")} ha no CAR</>}
              {car?.properties?.condicao && <> ({car.properties.condicao})</>}
              {". Confira se a matrícula descreve a mesma área."}
            </Item>
          )}
          <Item estado={autorizacao?.aceite_at ? "ok" : "aviso"}>
            {autorizacao
              ? <>
                  {CONDICAO[autorizacao.tipo] ?? autorizacao.tipo}
                  {autorizacao.aceite_at
                    ? <> — aceite eletrônico em {new Date(autorizacao.aceite_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        {autorizacao.aceite_ip && ` (IP ${autorizacao.aceite_ip})`}, versão {autorizacao.versao}
                        {autorizacao.validade && `, válida até ${new Date(autorizacao.validade + "T12:00:00").toLocaleDateString("pt-BR")}`}</>
                    : " — sem aceite eletrônico: confira a autorização assinada nos documentos"}
                </>
              : p.exclusividade ? "Exclusividade (cadastro anterior aos termos, sem aceite registrado)" : "Sem autorização registrada (cadastro anterior aos termos)"}
          </Item>
          <Item estado="info" icone={UserRound}>
            Responsável:{" "}
            {partner
              ? `${partner.razao_social} (${partner.tipo}) — ${partner.profile?.telefone ?? "sem telefone"}`
              : owner
                ? `${owner.profile?.nome} (proprietário) — ${owner.profile?.telefone ?? "sem telefone"}`
                : "—"}
          </Item>
        </ul>
        {p.motivo_correcao && (
          <p className="flex items-start gap-2.5 rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-[0.95rem] text-alerta">
            <CircleAlert className="mt-0.5 size-[18px] shrink-0" />
            <span>Última observação enviada: {p.motivo_correcao}</span>
          </p>
        )}
      </Bloco>

      {geoJson && (
        <MiniMapa
          geometry={geoJson as GeoJSON.Geometry}
          status={p.status}
          className="h-80 md:h-96 w-full rounded-[1.25rem] overflow-hidden border border-linha"
        />
      )}

      {!!media?.length && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {/* lazy + tamanho reservado: a ficha não baixa as fotos fora da tela nem pula
              quando elas chegam. O projeto não usa a transformação de imagem do
              Supabase (plano), então a miniatura ainda é o arquivo original; o
              clique abre o original em outra aba para conferir. */}
          {media.map((m) => m.tipo === "video" ? (
            <video key={m.storage_path} src={mediaUrl(m.storage_path)} preload="none" controls
              className="h-32 w-full rounded-xl border border-linha bg-superficie-2 object-cover" />
          ) : (
            <a key={m.storage_path} href={mediaUrl(m.storage_path)} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(m.storage_path)} alt="" loading="lazy" decoding="async" width={320} height={128}
                className="h-32 w-full object-cover rounded-xl border border-linha" />
            </a>
          ))}
        </div>
      )}

      {p.tipo === "rural" && (
        <Bloco titulo="Consulta territorial"
          subtitulo={<>Cruza a área do imóvel com mineração (ANM), terras indígenas (FUNAI), desmatamento (INPE)
            e pontos de interesse. Cada resultado guarda a origem e a data.</>}>
          <ConsultaRural propertyId={p.id} />
        </Bloco>
      )}

      {/* 5.3/5.4: pré-avaliação e aptidão (a equipe sempre pode testar) */}
      <SecaoAvaliacaoAdmin propertyId={p.id} tipo={p.tipo as "rural" | "urbano"} />

      {/* §1: histórico, versões da divisa, origem dos dados e auditoria */}
      <HistoricoImovel propertyId={p.id} modo="admin" tipoImovel={p.tipo as "urbano" | "rural"} />

      <Bloco titulo="Matrícula">
        <MatriculaAdmin propertyId={p.id} atual={matricula ?? null} />
        {p.car_codigo && <div className="mt-5 border-t border-linha pt-4"><MatriculaSigef cod={p.car_codigo} /></div>}
      </Bloco>

      <Bloco titulo="Documentos">
        <DocumentosImovel propertyId={p.id} podeConferir />
      </Bloco>

      {/* item 29: desenhos e projetos privados do anunciante — a Central só consulta */}
      <Bloco titulo="Minha área do anunciante">
        <MinhaAreaCliente propertyId={p.id} somenteLeitura />
      </Bloco>

      <Bloco titulo="Decisão" className="border-l-4 border-l-verde">
        <DecisaoBotoes propertyId={p.id} />
      </Bloco>

      <Conversa entidade="properties" id={p.id} />
    </div>
  );
}
