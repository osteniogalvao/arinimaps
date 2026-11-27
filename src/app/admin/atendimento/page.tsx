import { redirect } from "next/navigation";
import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import {
  falta0156, naAutomatica, nomeSetor, papelAtendimento, podeVer, SETORES_ATENDIMENTO, type Conversa,
} from "@/lib/atendimento";
import InboxAtendimento from "@/components/atendimento/InboxAtendimento";

export const metadata = { title: "Atendimento" };

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
    .select("setor, responsavel, nao_lidas, status, menu_enviado_em, menu_respondido_em, ari_ativa_em").neq("status", "resolvida").limit(5000);
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
    // só o que precisa de uma pessoa decidir; quem está no menu ou com a Ari fica em "Automático"
    ...(triagem ? [{ id: "central", rotulo: "Caixa central (triagem)", ...conta((c) => !c.setor && !naAutomatica(c)) }] : []),
    ...meusSetores.map((s) => ({ id: "setor:" + s, rotulo: nomeSetor(s), ...conta((c) => c.setor === s) })),
    ...(triagem ? [{ id: "automatico", rotulo: "Automático (menu e Ari)", ...conta((c) => naAutomatica(c)) }] : []),
    ...(triagem ? [{ id: "todas", rotulo: "Todas em aberto", ...conta(() => true) }] : []),
    { id: "resolvidas", rotulo: "Resolvidas" },
  ];
  const padrao = triagem && conta((c) => !c.setor && !naAutomatica(c)).total ? "central"
    : conta((c) => c.responsavel === a.userId).total ? "minhas"
    : meusSetores[0] ? "setor:" + meusSetores[0] : "minhas";
  const caixa = typeof q.caixa === "string" && caixas.some((c) => c.id === q.caixa) ? q.caixa : padrao;
  const busca = typeof q.q === "string" ? q.q.trim().slice(0, 60) : "";

  let consulta = admin.from("atendimento_conversas").select("*");
  if (caixa === "resolvidas") consulta = consulta.eq("status", "resolvida");
  else consulta = consulta.neq("status", "resolvida");
  if (caixa === "minhas") consulta = consulta.eq("responsavel", a.userId);
  else if (caixa === "central" || caixa === "automatico") consulta = consulta.is("setor", null).is("responsavel", null);
  else if (caixa.startsWith("setor:")) consulta = consulta.eq("setor", caixa.slice(6));
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    const termo = busca.replace(/[%_,()]/g, " ");
    consulta = digitos.length >= 4 ? consulta.ilike("telefone", `%${digitos}%`) : consulta.or(`nome.ilike.%${termo}%,codigo.ilike.%${termo}%`);
  }
  const { data: lista } = await consulta.order("ultima_mensagem_em", { ascending: false }).limit(150);
  const conversas = ((lista ?? []) as Conversa[]).filter((c) => podeVer(a, papel, c))
    .filter((c) => caixa === "central" ? !naAutomatica(c) : caixa === "automatico" ? naAutomatica(c) : true);
  const ids = [...new Set(conversas.map((c) => c.responsavel).filter(Boolean))] as string[];
  const { data: pessoas } = ids.length ? await admin.from("profiles").select("user_id, nome").in("user_id", ids) : { data: [] };
  const nomeDe = new Map((pessoas ?? []).map((p) => [p.user_id as string, (p.nome as string) || "Sem nome"]));
  const aberta = typeof q.conversa === "string" && /^[0-9a-f-]{36}$/i.test(q.conversa) ? q.conversa : null;

  return (
    <InboxAtendimento papel={papel} triagem={triagem} diretoria={temSetor(a, "diretoria")} caixas={caixas} caixa={caixa}
      busca={busca} conversas={conversas} nomes={Object.fromEntries(nomeDe)} aberta={aberta} />
  );
}
