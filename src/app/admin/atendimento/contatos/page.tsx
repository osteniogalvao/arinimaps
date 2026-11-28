import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerEmLotes } from "@/lib/supabase/lotes";
import { acessoAtendimento } from "@/lib/atendimento-acesso";
import { podeVer, type Conversa } from "@/lib/atendimento";
import { canalDoContatoRotulo, contatoRotulo, nomeSetor, PERFIL_LABEL, STATUS_LABEL } from "@/lib/atendimento-rotulos";
import NavAtendimento from "@/components/atendimento/NavAtendimento";
import { CAMPO_COMPACTO, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";

export const metadata = { title: "Contatos do atendimento" };

const FUSO = "America/Sao_Paulo";
const CANAIS = ["WhatsApp", "Instagram", "Messenger", "Telegram", "Chat do site"];
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Contato = {
  telefone: string; nome: string | null; perfil_tipo: string | null; etiquetas: string[];
  ultima: Conversa; conversas: number; abertas: number;
};

/**
 * Contatos do atendimento (porte do CRM da Arini Negócios): uma linha por
 * pessoa que já falou com a empresa, juntando as conversas pelo telefone (ou
 * pela conta da rede social). Cada pessoa vê só os contatos das conversas que
 * já pode ver no atendimento.
 */
export default async function ContatosAtendimento({ searchParams }: PageProps<"/admin/atendimento/contatos">) {
  const { a, papel, triagem, diretoria } = await acessoAtendimento();
  const sp = await searchParams;
  const busca = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const canal = typeof sp.canal === "string" && CANAIS.includes(sp.canal) ? sp.canal : "";
  const perfil = typeof sp.perfil === "string" && sp.perfil in PERFIL_LABEL ? sp.perfil : "";

  const { data, error } = await lerEmLotes<Conversa>((de, ate) => supabaseAdmin().from("atendimento_conversas")
    .select("id, codigo, telefone, nome, perfil_tipo, setor, responsavel, status, etiquetas, ultima_mensagem_em, ultimo_texto")
    .order("ultima_mensagem_em", { ascending: false }).order("id").range(de, ate) as never, { maximo: 20_000 });

  const porContato = new Map<string, Contato>();
  for (const c of data) {
    if (!podeVer(a, papel, c)) continue;
    const x = porContato.get(c.telefone);
    if (!x) porContato.set(c.telefone, { telefone: c.telefone, nome: c.nome, perfil_tipo: c.perfil_tipo, etiquetas: [...(c.etiquetas ?? [])], ultima: c, conversas: 1, abertas: c.status !== "resolvida" ? 1 : 0 });
    else {
      x.conversas++; if (c.status !== "resolvida") x.abertas++;
      x.nome ??= c.nome; x.perfil_tipo ??= c.perfil_tipo;
      for (const e of c.etiquetas ?? []) if (!x.etiquetas.includes(e)) x.etiquetas.push(e);
    }
  }
  const termo = semAcento(busca), digitos = busca.replace(/\D/g, "");
  const contatos = [...porContato.values()].filter((c) =>
    (!busca || semAcento(c.nome ?? "").includes(termo) || (digitos.length >= 4 && c.telefone.includes(digitos)) || c.etiquetas.some((e) => semAcento(e).includes(termo)))
    && (!canal || canalDoContatoRotulo(c.telefone) === canal)
    && (!perfil || c.perfil_tipo === perfil));
  const mostrados = contatos.slice(0, 300);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="lp-display text-2xl text-texto">Contatos</h1>
        <p className="text-sm text-texto-2">{contatos.length.toLocaleString("pt-BR")} contato(s){contatos.length > mostrados.length ? `, mostrando ${mostrados.length}` : ""}</p>
      </div>
      <NavAtendimento atual="contatos" triagem={triagem} diretoria={diretoria} />

      <form className="cartao flex flex-wrap items-end gap-3 p-4 text-sm">
        <label className="min-w-56 flex-1 text-xs text-texto-2">Buscar
          <input name="q" defaultValue={busca} placeholder="Nome, telefone ou etiqueta…" className={CAMPO_COMPACTO + " mt-1 block w-full"} />
        </label>
        <label className="text-xs text-texto-2">Canal
          <select name="canal" defaultValue={canal} className={CAMPO_COMPACTO + " mt-1 block"}>
            <option value="">Todos</option>{CANAIS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs text-texto-2">Perfil
          <select name="perfil" defaultValue={perfil} className={CAMPO_COMPACTO + " mt-1 block"}>
            <option value="">Todos</option>
            {Object.entries(PERFIL_LABEL).filter(([k]) => !["analista_arini", "consulta"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button className="btn-verde px-4 py-2">Filtrar</button>
        {(busca || canal || perfil) && <Link href="?" className="px-2 py-2 text-texto-2 hover:text-texto">Limpar</Link>}
      </form>

      {error && <p className="cartao p-4 text-sm text-alerta" role="alert">Falha ao carregar os contatos.</p>}

      <div className={TABELA_CAIXA}>
        <table className={TABELA}>
          <thead className={THEAD}>
            <tr><th className={TH}>Contato</th><th className={TH}>Perfil</th><th className={TH}>Etiquetas</th><th className={TH}>Última conversa</th><th className={TH + " text-right"}>Conversas</th><th className={TH} /></tr>
          </thead>
          <tbody className={TBODY}>
            {mostrados.map((c) => {
              const nome = c.nome || contatoRotulo(c.telefone);
              const u = c.ultima;
              return (
                <tr key={c.telefone} className={TR}>
                  <td className={TD}>
                    <span className="flex items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-verde/15 text-sm font-semibold text-verde">{nome.replace(/^\+/, "").trim()[0]?.toUpperCase() ?? "?"}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-texto">{nome}</span>
                        <span className="block text-xs text-texto-2">{canalDoContatoRotulo(c.telefone)}{canalDoContatoRotulo(c.telefone) === "WhatsApp" ? " · +" + c.telefone : ""}</span>
                      </span>
                    </span>
                  </td>
                  <td className={TD + " text-sm text-texto-2"}>{c.perfil_tipo ? PERFIL_LABEL[c.perfil_tipo] ?? c.perfil_tipo : "Cliente"}</td>
                  <td className={TD}><span className="flex flex-wrap gap-1">{c.etiquetas.slice(0, 4).map((e) => <span key={e} className="rounded-full bg-superficie-2 px-2 text-[11px]">#{e}</span>)}</span></td>
                  <td className={TD + " text-sm"}>
                    <span className="block text-texto">{new Date(u.ultima_mensagem_em).toLocaleString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="block text-xs text-texto-2">{nomeSetor(u.setor)} · {STATUS_LABEL[u.status] ?? u.status}</span>
                  </td>
                  <td className={TD + " text-right tabular-nums"}>{c.conversas}{c.abertas ? <span className="block text-xs text-ouro">{c.abertas} aberta(s)</span> : null}</td>
                  <td className={TD + " text-right"}>
                    <Link href={`/admin/atendimento?${new URLSearchParams({ caixa: u.status === "resolvida" ? "resolvidas" : "todas", conversa: u.id })}`}
                      className="text-sm font-semibold text-verde hover:underline underline-offset-4">Abrir conversa</Link>
                  </td>
                </tr>
              );
            })}
            {!mostrados.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-texto-2">Nenhum contato encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
