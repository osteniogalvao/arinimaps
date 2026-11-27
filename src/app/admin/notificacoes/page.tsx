import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirEquipe } from "@/lib/setores-servidor";
import { CabecalhoPagina, Etiqueta, Vazio } from "@/components/ui/Pagina";
import { LINHA_LISTA, LISTA, aba } from "@/components/admin/estilos";
import Resumo from "@/components/admin/Resumo";
import { Bell } from "lucide-react";
import MarcarLidas from "./MarcarLidas";

export const metadata = { title: "Notificações" };

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
/** só links internos: a notificação nunca leva para fora do site */
const interno = (l: string | null) => (l && l.startsWith("/") && !l.startsWith("//") ? l : null);

/**
 * Notificações da pessoa (tela do CRM da Arini Negócios): o histórico inteiro
 * do sino, com filtro de não lidas.
 */
export default async function Notificacoes({ searchParams }: PageProps<"/admin/notificacoes">) {
  const user = await exigirEquipe();
  const sp = await searchParams;
  const soNovas = sp.novas === "1";
  const admin = supabaseAdmin();
  let q = admin.from("notificacoes").select("id, nivel, titulo, texto, link, lida_em, created_at")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(200);
  if (soNovas) q = q.is("lida_em", null);
  const [{ data }, { count: naoLidas }, { count: criticas }] = await Promise.all([
    q,
    admin.from("notificacoes").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("lida_em", null),
    admin.from("notificacoes").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("lida_em", null).eq("nivel", "critico"),
  ]);
  const itens = data ?? [];

  return (
    <div className="space-y-6">
      <CabecalhoPagina eyebrow="Meu dia" titulo="Notificações" subtitulo="Avisos dos setores, das tarefas e do sistema para você."
        acoes={naoLidas ? <MarcarLidas /> : undefined} />
      <Resumo itens={[
        { rotulo: "Não lidas", valor: naoLidas ?? 0, tom: naoLidas ? "ouro" : "neutro", href: "/admin/notificacoes?novas=1", ativo: soNovas },
        { rotulo: "Críticas não lidas", valor: criticas ?? 0, tom: criticas ? "critico" : "neutro" },
        { rotulo: "Últimas", valor: itens.length, href: "/admin/notificacoes", ativo: !soNovas },
      ]} />
      <div className="flex gap-2">
        <Link href="/admin/notificacoes" className={aba(!soNovas)}>Todas</Link>
        <Link href="/admin/notificacoes?novas=1" className={aba(soNovas)}>Não lidas</Link>
      </div>
      {!itens.length ? <Vazio icone={Bell} titulo={soNovas ? "Tudo lido" : "Nenhuma notificação ainda"} /> : (
        <div className={LISTA}>
          {itens.map((n) => {
            const corpo = (<>
              {!n.lida_em && <span className="size-2 shrink-0 rounded-full bg-ouro" aria-label="não lida" />}
              <div className="flex-1 min-w-48">
                <p className={"text-texto " + (n.lida_em ? "" : "font-semibold")}>{n.titulo}</p>
                {n.texto && <p className="mt-0.5 text-sm text-texto-2">{n.texto}</p>}
              </div>
              {n.nivel !== "info" && <Etiqueta tom={n.nivel === "critico" ? "critico" : "alerta"}>{n.nivel === "critico" ? "Crítico" : "Atenção"}</Etiqueta>}
              <span className="text-sm text-texto-2 whitespace-nowrap">{quando(n.created_at)}</span>
            </>);
            const link = interno(n.link);
            return link
              ? <Link key={n.id} href={link} className={LINHA_LISTA}>{corpo}</Link>
              : <div key={n.id} className={LINHA_LISTA}>{corpo}</div>;
          })}
        </div>
      )}
    </div>
  );
}
