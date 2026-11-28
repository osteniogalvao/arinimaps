import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, BookOpen, CircleHelp, MessagesSquare, Settings } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { acessoAtendimento } from "@/lib/atendimento-acesso";
import { iaConfigurada, modeloIa } from "@/lib/ia/config";
import { contar, Indicadores } from "@/components/admin/Painel";
import NavAtendimento from "@/components/atendimento/NavAtendimento";

export const metadata = { title: "Agentes IA do atendimento" };

/**
 * Agentes IA (porte do CRM da Arini Negócios). Aqui o agente é a Ari: atende
 * pelo menu do WhatsApp (opção "Consultar imóveis") ou quando a primeira
 * mensagem já é uma busca clara, consulta os imóveis e passa ao Comercial.
 * A tela mostra se ela está ligada, o que fez e onde se ajusta.
 */
export default async function AgentesIA() {
  const { triagem, diretoria } = await acessoAtendimento();
  if (!diretoria) redirect("/admin/atendimento");
  const admin = supabaseAdmin();
  const mes = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [{ data: menu }, comAri, com30, artigos, lacunas] = await Promise.all([
    admin.from("atendimento_menu").select("ativo, ari_ativo, ari_limite_dia").eq("id", 1).maybeSingle(),
    contar("atendimento_conversas", (q) => q.not("ari_ativa_em", "is", null).is("setor", null).is("responsavel", null).neq("status", "resolvida")),
    contar("atendimento_conversas", (q) => q.gte("ari_ativa_em", mes)),
    contar("kb_artigos", (q) => q.eq("status", "publicado")),
    contar("ia_lacunas", (q) => q.eq("status", "aberta")),
  ]);
  const chave = iaConfigurada();
  const ligada = chave && !!menu?.ativo && menu?.ari_ativo !== false;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="lp-display text-2xl text-texto">Agentes IA</h1>
        <p className="mt-1 max-w-3xl text-sm text-texto-2">Agentes que respondem sozinhos no atendimento e passam a conversa para a equipe na hora certa.</p>
      </div>
      <NavAtendimento atual="agentes" triagem={triagem} diretoria={diretoria} />

      <section className="cartao p-6">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-verde/15 text-verde"><Bot className="size-7" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-texto">
              Ari · consulta de imóveis
              <span className={"rounded-full px-2.5 py-0.5 text-xs font-semibold " + (ligada ? "bg-verde/15 text-verde" : "bg-ouro/15 text-ouro")}>{ligada ? "Ligada" : "Desligada"}</span>
            </h2>
            <p className="mt-1 text-sm text-texto-2">
              Atende no WhatsApp quando o cliente escolhe a opção da Ari no menu ou quando a primeira mensagem já é uma busca clara
              (ex.: “fazenda de 100 ha em Iturama”). Procura nos imóveis publicados, responde e para assim que alguém da equipe responde.
              Depois de {menu?.ari_limite_dia ?? 40} respostas no dia para o mesmo cliente, passa para o Comercial.
            </p>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div><dt className="inline text-texto-2">Modelo: </dt><dd className="inline font-mono text-xs text-texto">{modeloIa()}</dd></div>
              <div><dt className="inline text-texto-2">Chave da IA: </dt><dd className="inline text-texto">{chave ? "configurada" : "falta ANTHROPIC_API_KEY no servidor"}</dd></div>
              <div><dt className="inline text-texto-2">Menu automático: </dt><dd className="inline text-texto">{menu?.ativo ? "ligado" : "desligado"}</dd></div>
            </dl>
          </div>
          <Link href="/admin/atendimento/configurar" className="btn-contorno inline-flex items-center gap-1.5 px-4 py-2 text-sm"><Settings className="size-4" /> Ajustar</Link>
        </div>
      </section>

      <Indicadores itens={[
        { rotulo: "Conversas com a Ari agora", valor: comAri, icone: MessagesSquare, href: "/admin/atendimento?caixa=automatico" },
        { rotulo: "Atendidas pela Ari em 30 dias", valor: com30, icone: Bot },
        { rotulo: "Artigos que ela consulta", valor: artigos, icone: BookOpen, href: "/admin/atendimento/ajuda" },
        { rotulo: "Perguntas sem resposta", valor: lacunas, icone: CircleHelp, href: "/admin/conhecimento", destaque: lacunas > 0, nota: "o que a IA não soube responder" },
      ]} />
    </div>
  );
}
