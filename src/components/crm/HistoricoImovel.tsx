import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { EVENTO_IMOVEL_LABEL, ORIGEM_DADO_LABEL } from "@/lib/imovel/eventos";
import { formatArea } from "@/lib/format";
import { CAMPO_REVISAO_LABEL, valorRevisao } from "@/lib/imovel/revisao";
import ValidarGeometria from "./ValidarGeometria";
import { Fingerprint, Layers, GitCompare, ScrollText, Eye, type LucideIcon } from "lucide-react";
import { Etiqueta } from "@/components/ui/Pagina";
import { formatPerimetro } from "@/lib/geo/distancia";
import { humanizarCodigo, resumoCampos } from "@/lib/textoTecnico";

/**
 * Histórico e rastreabilidade do imóvel (requisitos cartográficos §1.1–1.5):
 * versões da divisa, origem de cada dado, alterações propostas, trilha de
 * auditoria e os acessos/interações. Tudo lido pelo service role — quem pode
 * ver é decidido pela página que monta o componente (dono, parceiro
 * responsável ou Matriz).
 *
 * `modo="admin"` mostra também os últimos eventos com usuário e IP;
 * `modo="painel"` esconde IP e dados de terceiros.
 */
type Props = { propertyId: string; modo: "admin" | "painel"; tipoImovel?: "urbano" | "rural" };

type Versao = {
  id: string; versao: number; fonte: string; origem: string; situacao: string;
  area_m2: number | null; perimeter_m: number | null; motivo: string | null;
  responsavel: string | null; validada_por: string | null; validada_em: string | null; created_at: string;
};
type Origem = { campo: string; origem: string; detalhe: string | null; user_id: string | null; created_at: string };
type Revisao = {
  id: string; versao: number; dados: Record<string, unknown>; dados_anteriores: Record<string, unknown>;
  status: string; motivo: string | null; created_by: string | null; revisada_por: string | null;
  revisada_em: string | null; created_at: string;
};
type Auditoria = {
  id: string; acao: string; entidade: string; user_id: string | null; created_at: string;
  dados_antes: unknown; dados_depois: unknown;
};
type Evento = { id: string; tipo: string; user_id: string | null; ip: string | null; detalhe: Record<string, unknown>; created_at: string };

export const SITUACAO_DIVISA_LABEL: Record<string, string> = {
  informada: "Informada pelo usuário",
  em_analise: "Em análise pela Matriz",
  validada: "Validada pela Matriz",
  substituida: "Substituída",
};
type Tom = "verde" | "alerta" | "critico" | "neutro";
const SITUACAO_TOM: Record<string, Tom> = {
  informada: "alerta",
  em_analise: "alerta",
  validada: "verde",
  substituida: "neutro",
};
const CAMPO_LABEL: Record<string, string> = {
  geometria: "Divisa", area: "Área", valor: "Valor", cadastro: "Cadastro", documentos: "Documentos",
  consulta_territorial: "Consulta territorial", pois: "Pontos de interesse",
};
const STATUS_REVISAO: Record<string, { label: string; tom: Tom }> = {
  pendente: { label: "Aguardando a Matriz", tom: "alerta" },
  aprovada: { label: "Aprovada e aplicada", tom: "verde" },
  rejeitada: { label: "Rejeitada", tom: "critico" },
  cancelada: { label: "Cancelada pelo anunciante", tom: "neutro" },
};
const CONTADORES: { tipo: string; rotulo: string }[] = [
  { tipo: "visualizacao", rotulo: "Aberturas no mapa" },
  { tipo: "ficha", rotulo: "Visualizações da ficha" },
  { tipo: "tour", rotulo: "Tours 3D" },
  { tipo: "relatorio", rotulo: "Relatórios" },
  { tipo: "interesse", rotulo: "Interesses" },
  { tipo: "consulta", rotulo: "Consultas" },
];

const quando = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

/** Resumo curto de um registro da auditoria (sem despejar o JSON inteiro). */
function resumoAuditoria(a: Auditoria): string {
  const d = (a.dados_depois ?? a.dados_antes) as Record<string, unknown> | null;
  return resumoCampos(d) || humanizarCodigo(a.entidade);
}

export default async function HistoricoImovel({ propertyId, modo, tipoImovel = "rural" }: Props) {
  const admin = supabaseAdmin();
  const [{ data: versoes }, { data: origens }, { data: revisoes }, { data: auditoria }, { data: eventos }, ...contagens] =
    await Promise.all([
      admin.from("property_geometry_versions")
        .select("id, versao, fonte, origem, situacao, area_m2, perimeter_m, motivo, responsavel, validada_por, validada_em, created_at")
        .eq("property_id", propertyId).order("versao", { ascending: false }),
      admin.from("property_data_sources")
        .select("campo, origem, detalhe, user_id, created_at")
        .eq("property_id", propertyId).order("created_at", { ascending: false }),
      admin.from("property_revisions")
        .select("id, versao, dados, dados_anteriores, status, motivo, created_by, revisada_por, revisada_em, created_at")
        .eq("property_id", propertyId).order("versao", { ascending: false }),
      admin.from("audit_log")
        .select("id, acao, entidade, user_id, created_at, dados_antes, dados_depois")
        .eq("property_id", propertyId).order("created_at", { ascending: false }).limit(50),
      modo === "admin" ? admin.from("property_events")
        .select("id, tipo, user_id, ip, detalhe, created_at")
        .eq("property_id", propertyId).order("created_at", { ascending: false }).limit(20) : { data: [] },
      ...CONTADORES.map((c) =>
        admin.from("property_events").select("id", { count: "exact", head: true })
          .eq("property_id", propertyId).eq("tipo", c.tipo)
      ),
    ]);

  const lista = (versoes ?? []) as Versao[];
  const atual = lista.find((v) => v.situacao !== "substituida") ?? lista[0] ?? null;
  // a origem mais recente de cada campo é a que vale (§1.5)
  const origemPorCampo = new Map<string, Origem>();
  for (const o of (origens ?? []) as Origem[]) if (!origemPorCampo.has(o.campo)) origemPorCampo.set(o.campo, o);
  const revs = (revisoes ?? []) as Revisao[];
  const audit = (auditoria ?? []) as Auditoria[];
  const evs = (eventos ?? []) as Evento[];
  const contadores = CONTADORES.map((c, i) => ({ ...c, n: contagens[i]?.count ?? 0 }));

  // nomes de quem aparece (responsável, validou, propôs, revisou, agiu)
  const ids = new Set<string>();
  for (const v of lista) { if (v.responsavel) ids.add(v.responsavel); if (v.validada_por) ids.add(v.validada_por); }
  for (const r of revs) { if (r.created_by) ids.add(r.created_by); if (r.revisada_por) ids.add(r.revisada_por); }
  for (const a of audit) if (a.user_id) ids.add(a.user_id);
  for (const e of evs) if (e.user_id) ids.add(e.user_id);
  const nomes = new Map<string, string>();
  if (ids.size) {
    const { data: perfis } = await admin.from("profiles").select("user_id, nome").in("user_id", [...ids]);
    for (const p of perfis ?? []) nomes.set(p.user_id, p.nome || "Usuário");
  }
  const nome = (id: string | null) => (id ? nomes.get(id) ?? "Usuário" : modo === "admin" ? "Sistema" : "—");

  return (
    <div className="space-y-8">
      {/* ---------- rastreabilidade ---------- */}
      <Bloco icone={Fingerprint} titulo="Rastreabilidade"
        texto="Versão atual da divisa, origem de cada dado e o que já aconteceu com este imóvel.">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-superficie-2 p-4">
            {atual ? (
              <>
                <span className="text-base text-texto">Divisa — versão <strong>{atual.versao}</strong></span>
                <Etiqueta tom={SITUACAO_TOM[atual.situacao] ?? "neutro"}>
                  {SITUACAO_DIVISA_LABEL[atual.situacao] ?? atual.situacao}
                </Etiqueta>
                <span className="text-sm text-texto-2">{ORIGEM_DADO_LABEL[atual.origem] ?? atual.origem} · fonte {atual.fonte}</span>
                {atual.validada_em && (
                  <span className="text-sm text-texto-2">validada em {quando(atual.validada_em)}{atual.validada_por ? ` por ${nome(atual.validada_por)}` : ""}</span>
                )}
                {modo === "admin" && atual.situacao !== "validada" && (
                  <span className="ml-auto"><ValidarGeometria propertyId={propertyId} /></span>
                )}
              </>
            ) : (
              <span className="text-base text-texto-2">Imóvel sem divisa registrada.</span>
            )}
          </div>

          {origemPorCampo.size > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-texto-2">Origem por dado</p>
              <ul className="grid gap-x-8 text-[0.95rem] sm:grid-cols-2">
                {[...origemPorCampo.values()].map((o) => (
                  <li key={o.campo} className="flex justify-between gap-3 border-b border-linha py-2.5">
                    <span className="text-texto">{CAMPO_LABEL[o.campo] ?? o.campo}</span>
                    <span className="text-right text-texto-2" title={o.detalhe ?? undefined}>
                      {ORIGEM_DADO_LABEL[o.origem] ?? o.origem}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {contadores.map((c) => (
              <div key={c.tipo} className="rounded-xl border border-linha border-l-4 border-l-verde/60 p-4">
                <p className="lp-display text-2xl leading-none tabular-nums text-texto">{c.n}</p>
                <p className="mt-2 text-xs text-texto-2">{c.rotulo}</p>
              </div>
            ))}
          </div>
        </div>
      </Bloco>

      {/* ---------- versões da divisa ---------- */}
      <Bloco icone={Layers} titulo="Versões da divisa">
        {!lista.length ? (
          <p className="text-base text-texto-2">Nenhuma versão registrada.</p>
        ) : (
          <ul className="divide-y divide-linha rounded-xl border border-linha">
            {lista.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5">
                <span className="w-8 font-mono text-sm text-texto-2">v{v.versao}</span>
                <Etiqueta tom={SITUACAO_TOM[v.situacao] ?? "neutro"}>
                  {SITUACAO_DIVISA_LABEL[v.situacao] ?? v.situacao}
                </Etiqueta>
                <span className="text-[0.95rem] font-semibold tabular-nums text-texto">{formatArea(v.area_m2, tipoImovel)}</span>
                {v.perimeter_m != null && (
                  <span className="text-xs text-texto-2 tabular-nums">perímetro {formatPerimetro(v.perimeter_m)}</span>
                )}
                <span className="text-xs text-texto-2">{ORIGEM_DADO_LABEL[v.origem] ?? v.origem} · {v.fonte}</span>
                <span className="ml-auto text-xs text-texto-2 tabular-nums">{quando(v.created_at)}{v.responsavel ? ` · ${nome(v.responsavel)}` : ""}</span>
                {v.motivo && <p className="w-full text-sm text-texto-2">{v.motivo}</p>}
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      {/* ---------- alterações propostas ---------- */}
      <Bloco icone={GitCompare} titulo="Alterações propostas">
        {!revs.length ? (
          <p className="text-base text-texto-2">Nenhuma alteração proposta depois da publicação.</p>
        ) : (
          <div className="space-y-5">
            {revs.map((r) => {
              const campos = Object.keys(r.dados ?? {});
              const st = STATUS_REVISAO[r.status] ?? { label: r.status, tom: "neutro" as const };
              return (
                <div key={r.id} className="space-y-3 rounded-xl border border-linha p-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-base font-semibold text-texto">Versão {r.versao}</span>
                    <Etiqueta tom={st.tom}>{st.label}</Etiqueta>
                    <span className="ml-auto text-xs text-texto-2">
                      proposta em {quando(r.created_at)}{r.created_by ? ` por ${nome(r.created_by)}` : ""}
                      {r.revisada_em ? ` · decidida em ${quando(r.revisada_em)}${r.revisada_por ? ` por ${nome(r.revisada_por)}` : ""}` : ""}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="border-b border-linha text-left text-[11px] uppercase tracking-[0.12em] text-texto-2">
                          <th className="py-2.5 pr-3 font-semibold">Campo</th>
                          <th className="py-2.5 pr-3 font-semibold">Antes</th>
                          <th className="py-2.5 font-semibold">Proposto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-linha">
                        {campos.map((c) => (
                          <tr key={c} className="transition-colors hover:bg-superficie-2/60">
                            <td className="py-3 pr-3 font-semibold text-texto">{CAMPO_REVISAO_LABEL[c as keyof typeof CAMPO_REVISAO_LABEL] ?? c}</td>
                            <td className="py-3 pr-3 text-texto-2 whitespace-pre-line">{valorRevisao(c, r.dados_anteriores?.[c])}</td>
                            <td className="py-3 text-texto whitespace-pre-line">{valorRevisao(c, r.dados[c])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {r.motivo && <p className="text-sm text-critico">Motivo da Matriz: {r.motivo}</p>}
                </div>
              );
            })}
          </div>
        )}
      </Bloco>

      {/* ---------- trilha de auditoria ---------- */}
      <Bloco icone={ScrollText} titulo="Trilha de auditoria">
        {!audit.length ? (
          <p className="text-base text-texto-2">Nenhuma ação registrada.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-linha overflow-y-auto rounded-xl border border-linha">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3">
                <span className="text-[0.95rem] font-semibold text-texto">{humanizarCodigo(a.acao)}</span>
                <span className="text-xs text-texto-2">{nome(a.user_id)}</span>
                <span className="ml-auto text-xs text-texto-2 tabular-nums">{quando(a.created_at)}</span>
                <p className="w-full truncate text-xs text-texto-2" title={resumoAuditoria(a)}>{resumoAuditoria(a)}</p>
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      {/* ---------- últimos acessos (só Matriz) ---------- */}
      {modo === "admin" && (
        <Bloco icone={Eye} titulo="Últimos acessos e interações">
          {!evs.length ? (
            <p className="text-base text-texto-2">Nenhum acesso registrado ainda.</p>
          ) : (
            <ul className="divide-y divide-linha rounded-xl border border-linha">
              {evs.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-3">
                  <span className="text-[0.95rem] text-texto">{EVENTO_IMOVEL_LABEL[e.tipo] ?? e.tipo}</span>
                  <span className="text-xs text-texto-2">{e.user_id ? nome(e.user_id) : "visitante"}</span>
                  {e.ip && <span className="font-mono text-xs text-texto-2">{e.ip}</span>}
                  {e.detalhe && Object.keys(e.detalhe).length > 0 && (
                    <span className="max-w-xs truncate text-xs text-texto-2">
                      {resumoCampos(e.detalhe as Record<string, unknown>)}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-texto-2 tabular-nums">{quando(e.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloco>
      )}
    </div>
  );
}

function Bloco({ icone: Icone, titulo, texto, children }: {
  icone: LucideIcon; titulo: string; texto?: string; children: React.ReactNode;
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
