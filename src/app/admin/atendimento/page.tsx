import Link from "next/link";
import { redirect } from "next/navigation";
import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import {
  canalDoContatoRotulo, contatoRotulo, falta0156, nomeSetor, papelAtendimento, podeVer, PERFIL_LABEL, SETORES_ATENDIMENTO, STATUS_LABEL, type Conversa,
} from "@/lib/atendimento";
import ConversaAtendimento from "@/components/atendimento/ConversaAtendimento";

export const metadata = { title: "Atendimento" };

const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) === d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return d.toLocaleString("pt-BR", hoje ? { timeZone: "America/Sao_Paulo", timeStyle: "short" } : { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
};

/**
 * Atendimento por setores (migration 0156): caixa central, filas dos setores,
 * "minhas" e resolvidas, com a conversa aberta ao lado. Mesmo desenho do
 * atendimento do CRM da Arini Negócios Imobiliários.
 */
export default async function Atendimento({ searchParams }: PageProps<"/admin/atendimento">) {
  const a = await ator();
  if (!a) redirect("/entrar");
  if (!a.ehArini) redirect("/");
  const q = await searchParams;
  const papel = await papelAtendimento(a);
  const triagem = papel !== "atendente";
  const meusSetores = SETORES_ATENDIMENTO.filter((s) => triagem || a.setores.includes(s));
  const admin = supabaseAdmin();

  // contagem das caixas (conversas em aberto que a pessoa enxerga)
  const { data: abertas, error } = await admin.from("atendimento_conversas")
    .select("setor, responsavel, nao_lidas, status").neq("status", "resolvida").limit(5000);
  if (error) {
    return (
      <div className="space-y-4">
        <CabecalhoPagina titulo="Atendimento" eyebrow="Central" />
        <p className="cartao p-5" role="alert">
          {falta0156(error.message) ? "Falta rodar a migration 0156 (Atendimento por setores) no Supabase." : "Falha ao carregar o atendimento."}
        </p>
      </div>
    );
  }
  const visiveis = (abertas ?? []).filter((c) => podeVer(a, papel, c));
  const conta = (f: (c: (typeof visiveis)[number]) => boolean) => {
    const l = visiveis.filter(f);
    return { total: l.length, naoLidas: l.reduce((s, c) => s + (c.nao_lidas ? 1 : 0), 0) };
  };
  const caixas: { id: string; rotulo: string; total?: number; naoLidas?: number }[] = [
    { id: "minhas", rotulo: "Minhas conversas", ...conta((c) => c.responsavel === a.userId) },
    ...(triagem ? [{ id: "central", rotulo: "Caixa central (triagem)", ...conta((c) => !c.setor) }] : []),
    ...meusSetores.map((s) => ({ id: "setor:" + s, rotulo: nomeSetor(s), ...conta((c) => c.setor === s) })),
    ...(triagem ? [{ id: "todas", rotulo: "Todas em aberto", ...conta(() => true) }] : []),
    { id: "resolvidas", rotulo: "Resolvidas" },
  ];
  const padrao = triagem && conta((c) => !c.setor).total ? "central"
    : conta((c) => c.responsavel === a.userId).total ? "minhas"
    : meusSetores[0] ? "setor:" + meusSetores[0] : "minhas";
  const caixa = typeof q.caixa === "string" && caixas.some((c) => c.id === q.caixa) ? q.caixa : padrao;
  const busca = typeof q.q === "string" ? q.q.trim().slice(0, 60) : "";

  let consulta = admin.from("atendimento_conversas").select("*");
  if (caixa === "resolvidas") consulta = consulta.eq("status", "resolvida");
  else consulta = consulta.neq("status", "resolvida");
  if (caixa === "minhas") consulta = consulta.eq("responsavel", a.userId);
  else if (caixa === "central") consulta = consulta.is("setor", null);
  else if (caixa.startsWith("setor:")) consulta = consulta.eq("setor", caixa.slice(6));
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    const termo = busca.replace(/[%_,()]/g, " ");
    consulta = digitos.length >= 4 ? consulta.ilike("telefone", `%${digitos}%`) : consulta.or(`nome.ilike.%${termo}%,codigo.ilike.%${termo}%`);
  }
  const { data: lista } = await consulta.order("ultima_mensagem_em", { ascending: false }).limit(150);
  const conversas = ((lista ?? []) as Conversa[]).filter((c) => podeVer(a, papel, c));
  const ids = [...new Set(conversas.map((c) => c.responsavel).filter(Boolean))] as string[];
  const { data: pessoas } = ids.length ? await admin.from("profiles").select("user_id, nome").in("user_id", ids) : { data: [] };
  const nomeDe = new Map((pessoas ?? []).map((p) => [p.user_id as string, (p.nome as string) || "Sem nome"]));
  const aberta = typeof q.conversa === "string" && /^[0-9a-f-]{36}$/i.test(q.conversa) ? q.conversa : null;
  const link = (extra: Record<string, string>) => "?" + new URLSearchParams({ caixa, ...(busca ? { q: busca } : {}), ...extra }).toString();

  return (
    <div className="space-y-5">
      <CabecalhoPagina titulo="Atendimento" eyebrow="Central · WhatsApp" />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-texto-2">
        <span>Você atua como <strong className="text-texto">{papel === "administrador" ? "administrador" : papel === "recepcao" ? "recepção" : "atendente"}</strong>.</span>
        {temSetor(a, "diretoria") && <Link href="/admin/atendimento/configurar" className="font-semibold text-verde underline-offset-4 hover:underline">Menu automático, respostas prontas e recepção</Link>}
        {temSetor(a, "diretoria") && <Link href="/admin/comercial/whatsapp/conexao" className="font-semibold text-verde underline-offset-4 hover:underline">Conexão do número</Link>}
      </p>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className={"space-y-3 " + (aberta ? "hidden lg:block" : "")}>
          <nav aria-label="Caixas" className="cartao divide-y divide-linha overflow-hidden">
            {caixas.map((c) => (
              <Link key={c.id} href={"?" + new URLSearchParams({ caixa: c.id }).toString()}
                className={"flex items-center justify-between gap-2 px-4 py-2.5 text-sm transition-colors " + (c.id === caixa ? "bg-verde/12 font-semibold text-texto" : "text-texto-2 hover:bg-superficie-2")}>
                <span>{c.rotulo}</span>
                {c.total !== undefined && (
                  <span className="flex items-center gap-1.5">
                    {!!c.naoLidas && <span className="rounded-full bg-ouro px-1.5 text-[11px] font-bold text-fundo">{c.naoLidas}</span>}
                    <span className="tabular-nums text-xs">{c.total}</span>
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <form className="flex gap-2">
            <input type="hidden" name="caixa" value={caixa} />
            <input name="q" defaultValue={busca} placeholder="Nome, telefone ou código" className={CAMPO_COMPACTO + " flex-1"} />
            <button className="btn-contorno px-3 py-2 text-sm">Buscar</button>
          </form>
          <ul className="cartao max-h-[70vh] divide-y divide-linha overflow-y-auto">
            {conversas.map((c) => (
              <li key={c.id}>
                <Link href={link({ conversa: c.id })}
                  className={"block px-4 py-3 transition-colors " + (c.id === aberta ? "bg-verde/12" : "hover:bg-superficie-2")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className={"truncate " + (c.nao_lidas ? "font-bold text-texto" : "font-semibold text-texto")}>{c.nome || contatoRotulo(c.telefone)}</span>
                    <span className="shrink-0 text-[11px] text-texto-2">{quando(c.ultima_mensagem_em)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-texto-2">{c.ultimo_texto}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-texto-2">
                    {canalDoContatoRotulo(c.telefone) !== "WhatsApp" && <span className="rounded-full bg-verde/15 px-2 font-semibold text-verde">{canalDoContatoRotulo(c.telefone)}</span>}
                    <span className="rounded-full border border-linha px-2">{nomeSetor(c.setor)}</span>
                    {c.responsavel && <span className="rounded-full border border-linha px-2">{nomeDe.get(c.responsavel) ?? "Responsável"}</span>}
                    {c.perfil_tipo && <span className="rounded-full border border-linha px-2">{PERFIL_LABEL[c.perfil_tipo] ?? c.perfil_tipo}</span>}
                    {c.status === "pendente" && <span className="rounded-full border border-linha px-2">{STATUS_LABEL.pendente}</span>}
                    {!!c.nao_lidas && <span className="rounded-full bg-ouro px-2 font-bold text-fundo">{c.nao_lidas} nova{c.nao_lidas > 1 ? "s" : ""}</span>}
                  </span>
                </Link>
              </li>
            ))}
            {!conversas.length && <li className="px-4 py-10 text-center text-sm text-texto-2">Nenhuma conversa nesta caixa.</li>}
          </ul>
        </aside>
        <section className={aberta ? "" : "hidden lg:block"}>
          {aberta
            ? <ConversaAtendimento key={aberta} id={aberta} voltar={link({})} />
            : <p className="cartao px-5 py-16 text-center text-texto-2">Escolha uma conversa à esquerda.</p>}
        </section>
      </div>
    </div>
  );
}
