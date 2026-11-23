import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock, Inbox, MessageCircleWarning, Timer } from "lucide-react";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CabecalhoPagina, Estatistica, Secao } from "@/components/ui/Pagina";
import { canalDoContatoRotulo, falta0156, nomeSetor, papelAtendimento } from "@/lib/atendimento";

export const metadata = { title: "Relatórios do atendimento" };

const PERIODOS = [7, 30, 90] as const;
const FUSO = "America/Sao_Paulo";

type Conv = {
  id: string; setor: string | null; responsavel: string | null; status: string; telefone: string;
  etiquetas: string[] | null; created_at: string; resolvida_em: string | null;
  ultima_entrada_em: string | null; ultima_saida_em: string | null;
};
type Msg = { conversa_id: string; direcao: "entrada" | "saida"; enviado_por: string | null; created_at: string };

const mediana = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const duracao = (min: number | null) => {
  if (min == null) return "—";
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  if (min < 60 * 24) return `${(min / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
  return `${(min / 1440).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`;
};
const inicioDoPeriodo = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString();
const horaLocal = (iso: string) => Number(new Date(iso).toLocaleString("pt-BR", { timeZone: FUSO, hour: "2-digit", hour12: false }).slice(0, 2)) % 24;

/**
 * Relatórios do atendimento: volume, resolução, fila sem resposta e tempo da
 * primeira resposta humana, por setor, atendente, canal e hora do dia. Só lê
 * as tabelas da 0156/0157; não precisa de migration. Diretoria e recepção.
 */
export default async function RelatoriosAtendimento({ searchParams }: PageProps<"/admin/atendimento/relatorios">) {
  const a = await ator();
  if (!a) redirect("/entrar");
  if (!a.ehArini) redirect("/");
  if ((await papelAtendimento(a)) === "atendente") redirect("/admin/atendimento");
  const q = await searchParams;
  const dias = PERIODOS.find((p) => String(p) === q.dias) ?? 30;
  const desde = inicioDoPeriodo(dias);
  const admin = supabaseAdmin();

  const campos = "id, setor, responsavel, status, telefone, etiquetas, created_at, resolvida_em, ultima_entrada_em, ultima_saida_em";
  const [novasR, abertasR, resolvidasR] = await Promise.all([
    admin.from("atendimento_conversas").select(campos).gte("created_at", desde).limit(10000),
    admin.from("atendimento_conversas").select(campos).neq("status", "resolvida").limit(10000),
    admin.from("atendimento_conversas").select(campos).gte("resolvida_em", desde).limit(10000),
  ]);
  const erro = novasR.error ?? abertasR.error ?? resolvidasR.error;
  if (erro) {
    return (
      <div className="space-y-4">
        <CabecalhoPagina titulo="Relatórios do atendimento" eyebrow="Central · Atendimento" />
        <p className="cartao p-5" role="alert">{falta0156(erro.message) ? "Falta rodar a migration 0156 (Atendimento por setores) no Supabase." : "Falha ao carregar os relatórios."}</p>
      </div>
    );
  }
  const novas = (novasR.data ?? []) as Conv[];
  const abertas = (abertasR.data ?? []) as Conv[];
  const resolvidas = (resolvidasR.data ?? []) as Conv[];
  const semResposta = abertas.filter((c) => c.ultima_entrada_em && (!c.ultima_saida_em || c.ultima_entrada_em > c.ultima_saida_em));

  // mensagens do período das conversas novas: primeira entrada x primeira resposta de alguém da equipe
  const msgs: Msg[] = [];
  const ids = novas.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("whatsapp_mensagens").select("conversa_id, direcao, enviado_por, created_at")
      .in("conversa_id", ids.slice(i, i + 200)).gte("created_at", desde).order("created_at").limit(20000);
    msgs.push(...((data ?? []) as Msg[]));
  }
  const primeira = new Map<string, { entrada?: string; resposta?: string; quem?: string }>();
  const entradasPorHora = Array<number>(24).fill(0);
  for (const m of msgs) {
    const p = primeira.get(m.conversa_id) ?? {};
    if (m.direcao === "entrada") {
      entradasPorHora[horaLocal(m.created_at)]++;
      if (!p.entrada) p.entrada = m.created_at;
    } else if (m.enviado_por && p.entrada && !p.resposta) {
      p.resposta = m.created_at; p.quem = m.enviado_por;
    }
    primeira.set(m.conversa_id, p);
  }
  const tempos = novas.flatMap((c) => {
    const p = primeira.get(c.id);
    return p?.entrada && p.resposta ? [{ c, quem: p.quem!, min: (Date.parse(p.resposta) - Date.parse(p.entrada)) / 60000 }] : [];
  });
  const resolucao = resolvidas.map((c) => (Date.parse(c.resolvida_em!) - Date.parse(c.created_at)) / 60000).filter((m) => m >= 0);

  // por setor
  const setores = [...new Set([...novas, ...abertas, ...resolvidas].map((c) => c.setor ?? ""))]
    .sort((x, y) => (x === "" ? -1 : y === "" ? 1 : nomeSetor(x).localeCompare(nomeSetor(y))));
  const porSetor = setores.map((s) => {
    const de = (l: Conv[]) => l.filter((c) => (c.setor ?? "") === s);
    return {
      s, novas: de(novas).length, resolvidas: de(resolvidas).length, abertas: de(abertas).length, semResposta: de(semResposta).length,
      resposta: mediana(tempos.filter((t) => (t.c.setor ?? "") === s).map((t) => t.min)),
    };
  });

  // por atendente (quem respondeu primeiro e quem é responsável)
  const pessoas = new Set<string>([...tempos.map((t) => t.quem), ...abertas.map((c) => c.responsavel ?? ""), ...resolvidas.map((c) => c.responsavel ?? "")].filter(Boolean));
  const { data: perfis } = pessoas.size ? await admin.from("profiles").select("user_id, nome").in("user_id", [...pessoas]) : { data: [] };
  const nomeDe = new Map((perfis ?? []).map((p) => [p.user_id as string, (p.nome as string) || "Sem nome"]));
  const porPessoa = [...pessoas].map((u) => ({
    u, nome: nomeDe.get(u) ?? "Sem nome",
    primeiras: tempos.filter((t) => t.quem === u).length,
    resposta: mediana(tempos.filter((t) => t.quem === u).map((t) => t.min)),
    abertas: abertas.filter((c) => c.responsavel === u).length,
    resolvidas: resolvidas.filter((c) => c.responsavel === u).length,
  })).sort((x, y) => y.resolvidas + y.abertas - (x.resolvidas + x.abertas));

  const porCanal = Object.entries(novas.reduce<Record<string, number>>((acc, c) => {
    const k = canalDoContatoRotulo(c.telefone); acc[k] = (acc[k] ?? 0) + 1; return acc;
  }, {})).sort((x, y) => y[1] - x[1]);
  const porEtiqueta = Object.entries(novas.flatMap((c) => c.etiquetas ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e] = (acc[e] ?? 0) + 1; return acc;
  }, {})).sort((x, y) => y[1] - x[1]).slice(0, 12);
  const maxHora = Math.max(1, ...entradasPorHora);

  const th = "px-3 py-3 text-right";
  const td = "px-3 py-3 text-right tabular-nums";

  return (
    <div className="mx-auto max-w-[1280px] space-y-10">
      <CabecalhoPagina
        eyebrow="Central · Atendimento"
        titulo="Relatórios do atendimento"
        subtitulo="Volume, fila e tempo de resposta por setor e por pessoa. A primeira resposta conta a partir da primeira mensagem do cliente até a primeira resposta de alguém da equipe (o menu automático não conta)."
        acoes={<Link href="/admin/atendimento" className="btn-contorno px-4 py-2 text-sm">Voltar ao atendimento</Link>}
      />

      <nav aria-label="Período" className="flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <Link key={p} href={`?dias=${p}`} aria-current={p === dias ? "page" : undefined}
            className={"rounded-full border px-4 py-1.5 text-sm " + (p === dias ? "border-verde bg-verde/12 font-semibold text-texto" : "border-linha text-texto-2 hover:bg-superficie-2")}>
            Últimos {p} dias
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-5">
        <Estatistica icone={Inbox} valor={novas.length} rotulo="Conversas novas" />
        <Estatistica icone={CheckCircle2} valor={resolvidas.length} rotulo="Resolvidas" />
        <Estatistica icone={Clock} valor={abertas.length} rotulo="Em aberto agora" />
        <Estatistica icone={MessageCircleWarning} valor={semResposta.length} rotulo="Esperando resposta" urgente={semResposta.length > 0} href="/admin/atendimento?caixa=todas" />
        <Estatistica icone={Timer} valor={<span className="text-3xl">{duracao(mediana(tempos.map((t) => t.min)))}</span>} rotulo="1ª resposta (mediana)" />
      </div>

      <Secao eyebrow="Filas" titulo="Por setor" subtitulo={<>Tempo até resolver (mediana do período): <strong className="text-texto">{duracao(mediana(resolucao))}</strong>.</>}>
        <div className="cartao overflow-x-auto">
          <table className="w-full min-w-[680px] text-[0.95rem]">
            <thead className="bg-superficie-2">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-texto-2">
                <th className="px-5 py-3">Setor</th><th className={th}>Novas</th><th className={th}>Resolvidas</th>
                <th className={th}>Em aberto</th><th className={th}>Esperando resposta</th><th className="px-5 py-3 text-right">1ª resposta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linha">
              {porSetor.map((l) => (
                <tr key={l.s || "central"}>
                  <td className="px-5 py-3 font-semibold text-texto">{nomeSetor(l.s || null)}</td>
                  <td className={td}>{l.novas}</td><td className={td}>{l.resolvidas}</td><td className={td}>{l.abertas}</td>
                  <td className={td + (l.semResposta ? " font-semibold text-ouro" : "")}>{l.semResposta}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{duracao(l.resposta)}</td>
                </tr>
              ))}
              {!porSetor.length && <tr><td colSpan={6} className="px-5 py-6 text-center text-texto-2">Nenhuma conversa no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao eyebrow="Equipe" titulo="Por atendente">
        <div className="cartao overflow-x-auto">
          <table className="w-full min-w-[620px] text-[0.95rem]">
            <thead className="bg-superficie-2">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-texto-2">
                <th className="px-5 py-3">Pessoa</th><th className={th}>Em aberto</th><th className={th}>Resolvidas</th>
                <th className={th}>Primeiras respostas</th><th className="px-5 py-3 text-right">1ª resposta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linha">
              {porPessoa.map((l) => (
                <tr key={l.u}>
                  <td className="px-5 py-3 font-semibold text-texto">{l.nome}</td>
                  <td className={td}>{l.abertas}</td><td className={td}>{l.resolvidas}</td><td className={td}>{l.primeiras}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{duracao(l.resposta)}</td>
                </tr>
              ))}
              {!porPessoa.length && <tr><td colSpan={5} className="px-5 py-6 text-center text-texto-2">Ninguém da equipe atendeu no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </Secao>

      <div className="grid gap-10 lg:grid-cols-2">
        <Secao eyebrow="Origem" titulo="Por canal e assunto">
          <div className="cartao space-y-4 p-5">
            <ul className="flex flex-wrap gap-2">
              {porCanal.map(([k, n]) => <li key={k} className="rounded-full bg-superficie-2 px-3 py-1 text-sm"><strong>{n}</strong> {k}</li>)}
              {!porCanal.length && <li className="text-sm text-texto-2">Sem conversas novas.</li>}
            </ul>
            {!!porEtiqueta.length && (
              <ul className="divide-y divide-linha text-sm">
                {porEtiqueta.map(([e, n]) => <li key={e} className="flex justify-between py-1.5"><span>{e}</span><span className="tabular-nums">{n}</span></li>)}
              </ul>
            )}
          </div>
        </Secao>

        <Secao eyebrow="Movimento" titulo="Mensagens recebidas por hora" subtitulo="Horário de Brasília. Ajuda a definir escala e horário de atendimento.">
          <div className="cartao p-5">
            <div className="flex h-40 items-end gap-1" role="img" aria-label="Mensagens recebidas por hora do dia">
              {entradasPorHora.map((n, h) => (
                <div key={h} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${h}h: ${n}`}>
                  <div className="w-full rounded-t bg-verde/70" style={{ height: `${(n / maxHora) * 100}%`, minHeight: n ? 2 : 0 }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-texto-2"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
          </div>
        </Secao>
      </div>
    </div>
  );
}
