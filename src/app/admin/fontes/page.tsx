import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { SeloClassificacao, SeloSituacao } from "@/components/rural/Selos";
import VerificarFontes from "./VerificarFontes";
import { Activity, AlertTriangle, ChevronRight, Clock, Database, FileDown, Table2 } from "lucide-react";
import { CabecalhoPagina, Estatistica, Etiqueta, NavegacaoInterna, Secao } from "@/components/ui/Pagina";

type Ficha = Partial<Record<
  "endereco_oficial" | "documentacao" | "acesso" | "autenticacao" | "custo" | "limites" | "licenca" |
  "atualizacao" | "campos" | "crs" | "consulta_por_geometria" | "cache" | "situacao_sondagem" | "sondado_em", string>>;

type FontePainel = {
  id: string; nome: string; orgao: string; tipo: string; mecanismo: string | null;
  endpoint: string | null; camada: string | null; ativa: boolean; observacao: string | null;
  classificacao: string; situacao: string; situacao_desde: string | null;
  ultima_verificacao: string | null; ultima_consulta: string | null; sonda_url: string | null;
  ficha: Ficha; verificacoes_7d: number; disponibilidade_7d: number | null;
  latencia_media_7d: number | null; ultimo_erro: string | null; ultimo_ok: boolean | null;
};

/** Ordem e rótulos da matriz técnica (PENDENCIAS 3.14) — a mesma de docs/FONTES.md. */
const CAMPOS_FICHA: [keyof Ficha, string][] = [
  ["endereco_oficial", "Endereço oficial"], ["documentacao", "Documentação / serviço"], ["acesso", "Tipo de acesso"],
  ["autenticacao", "Autenticação"], ["custo", "Custo"], ["limites", "Limites"], ["licenca", "Licença e termos"],
  ["atualizacao", "Atualização"], ["campos", "Campos usados"], ["crs", "Sistema de referência"],
  ["consulta_por_geometria", "Consulta por geometria"], ["cache", "Cache"],
  ["situacao_sondagem", "Situação na sondagem"], ["sondado_em", "Sondado em"],
];

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

/**
 * Fontes oficiais (PENDENCIAS 3.14 e 3.16): catálogo com a matriz técnica,
 * situação medida, última verificação e latência média dos últimos 7 dias.
 * A verificação roda sozinha a cada 6 h pelo worker; o botão roda na hora.
 */
export default async function AdminFontes() {
  await exigirSetor("cartografia");
  const { data } = await supabaseAdmin().rpc("fn_fontes_painel");
  const fontes = (data ?? []) as FontePainel[];
  const ativas = fontes.filter((f) => f.ativa);
  const instaveis = ativas.filter((f) => f.situacao === "instavel");
  const ultima = ativas.map((f) => f.ultima_verificacao).filter((v): v is string => !!v).sort().pop() ?? null;

  return (
    <div className="mx-auto max-w-[1280px] space-y-10">
      <CabecalhoPagina
        variante="simples"
        eyebrow="Central · Cartografia"
        titulo="Fontes oficiais"
        subtitulo="A cada 6 horas, o sistema consulta as fontes ativas que têm sonda configurada. Três falhas seguidas marcam a fonte como instável e geram um aviso no relatório territorial."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <Estatistica icone={Database} valor={ativas.length} rotulo="Ativas" />
        <Estatistica icone={AlertTriangle} valor={instaveis.length} rotulo="Instáveis" urgente={instaveis.length > 0} />
        <Estatistica icone={FileDown} valor={fontes.length - ativas.length} rotulo="Dependem de importação" />
        <Estatistica icone={Clock} valor={<span className="text-xl tabular-nums">{quando(ultima)}</span>} rotulo="Última verificação" />
      </div>

      <NavegacaoInterna itens={[
        { href: "#situacao", rotulo: "Situação das fontes ativas", icone: Activity, contagem: ativas.length },
        { href: "#matriz", rotulo: "Matriz técnica", icone: Table2, contagem: fontes.length },
      ]} />

      <div id="situacao" className="scroll-mt-36">
      <Secao
        eyebrow="Monitoramento"
        titulo="Situação das fontes ativas"
        acao={<VerificarFontes />}
      >
        <div className="cartao overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[0.95rem]">
              <thead className="bg-superficie-2">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-texto-2">
                  <th className="px-5 py-3">Fonte</th>
                  <th className="px-3 py-3">Tipo</th>
                  <th className="px-3 py-3">Situação</th>
                  <th className="px-3 py-3">Última verificação</th>
                  <th className="px-3 py-3 text-right">Latência 7 d</th>
                  <th className="px-5 py-3 text-right">No ar 7 d</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linha">
                {ativas.map((f) => (
                  <tr key={f.id} className="align-top transition-colors hover:bg-superficie-2/60">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-texto">{f.nome}</p>
                      <p className="mt-0.5 text-sm text-texto-2">{f.orgao} · {f.mecanismo ?? f.tipo}</p>
                      {f.ultimo_ok === false && f.ultimo_erro && (
                        <p className="mt-1 flex items-start gap-1.5 text-sm text-alerta">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Última falha: {f.ultimo_erro}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3.5"><SeloClassificacao valor={f.classificacao} /></td>
                    <td className="px-3 py-3.5">
                      <SeloSituacao valor={f.situacao} />
                      {!f.sonda_url && <p className="mt-1 text-xs text-texto-2">Sem sonda configurada</p>}
                      {f.situacao_desde && <p className="mt-1 text-xs text-texto-2 tabular-nums">desde {quando(f.situacao_desde)}</p>}
                    </td>
                    <td className="px-3 py-3.5 text-sm text-texto-2 tabular-nums">{quando(f.ultima_verificacao)}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-texto">
                      {f.latencia_media_7d != null ? `${f.latencia_media_7d.toLocaleString("pt-BR")} ms` : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-texto">
                      {f.disponibilidade_7d != null ? `${f.disponibilidade_7d.toLocaleString("pt-BR")}%` : "—"}
                      <p className="text-xs text-texto-2">{f.verificacoes_7d} verif.</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Secao>
      </div>

      <div id="matriz" className="scroll-mt-36">
      <Secao
        eyebrow="Catálogo"
        titulo="Matriz técnica"
        subtitulo={<>
          Para cada fonte: órgão, endereço, acesso, autenticação, custo, limites, licença, atualização e campos —
          a mesma tabela de <code className="font-mono text-sm">docs/FONTES.md</code>. As inativas não têm consulta pública por área e
          aparecem no relatório como “dependem de importação”.
        </>}
      >
        <div className="cartao divide-y divide-linha overflow-hidden">
          {fontes.map((f) => (
            <details key={f.id} className="group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 transition-colors hover:bg-superficie-2/60 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 shrink-0 text-texto-2 transition-transform group-open:rotate-90" />
                <span className="font-semibold text-texto">{f.nome}</span>
                <span className="text-sm text-texto-2">{f.orgao}</span>
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  <SeloClassificacao valor={f.classificacao} />
                  {f.ativa ? <SeloSituacao valor={f.situacao} />
                    : <Etiqueta tom="neutro">depende de importação</Etiqueta>}
                </span>
              </summary>
              <dl className="grid gap-x-6 gap-y-2.5 border-t border-linha bg-superficie-2/40 px-5 py-5 text-[0.95rem] sm:grid-cols-[13rem_1fr] sm:pl-12">
                {f.observacao && (<><dt className="text-sm font-semibold text-texto-2">Observação</dt><dd className="text-texto">{f.observacao}</dd></>)}
                {f.endpoint && (<><dt className="text-sm font-semibold text-texto-2">Serviço</dt><dd className="text-texto break-all font-mono text-sm">{f.endpoint}</dd></>)}
                {f.camada && (<><dt className="text-sm font-semibold text-texto-2">Camadas</dt><dd className="text-texto font-mono text-sm">{f.camada}</dd></>)}
                {CAMPOS_FICHA.filter(([k]) => f.ficha?.[k]).map(([k, rotulo]) => (
                  <div key={k} className="contents">
                    <dt className="text-sm font-semibold text-texto-2">{rotulo}</dt>
                    <dd className="text-texto break-words">{f.ficha[k]}</dd>
                  </div>
                ))}
                {f.sonda_url && (<><dt className="text-sm font-semibold text-texto-2">Sonda de saúde</dt><dd className="text-texto-2 break-all font-mono text-xs">{f.sonda_url}</dd></>)}
                <dt className="text-sm font-semibold text-texto-2">Última consulta real</dt><dd className="text-texto tabular-nums">{quando(f.ultima_consulta)}</dd>
              </dl>
            </details>
          ))}
        </div>
      </Secao>
      </div>
    </div>
  );
}
