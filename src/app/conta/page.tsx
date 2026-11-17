import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { normalizar } from "@/lib/preferencias";
import { TIPO_ORG_LABEL, PAPEL_ORG_LABEL, type TipoOrg } from "@/lib/organizacoes";
import { convitesPendentes, organizacaoDoUsuario } from "@/lib/organizacoes-servidor";
import { acessoDe } from "@/lib/planos-servidor";
import { armazenamentoDaConta } from "@/lib/armazenamento";
import { ShieldCheck, Users, BadgeCheck, LifeBuoy, ChevronRight } from "lucide-react";
import { CabecalhoPagina, Secao } from "@/components/ui/Pagina";
import TopoConta from "@/components/painel/TopoConta";
import Conta from "./Conta";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Minha conta" };

/**
 * Minha conta (4.6 + 5.10): nome, telefone, foto do perfil, preferências que
 * acompanham a pessoa em qualquer aparelho e convites de organização (5.9).
 * Vale para todo mundo — equipe, parceiro e cliente —, por isso fica fora de
 * /painel e de /admin, como /conta/seguranca.
 */
export default async function MinhaConta() {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  const daEquipe = ["admin_central", "analista_arini"].includes(user.role);

  const [{ data: perfil }, vinculo, convites, acesso, avisos] = await Promise.all([
    supabaseAdmin().from("profiles").select("nome, telefone, avatar_url, preferencias, profissao_declarada, especialidade, avisos_email").eq("user_id", user.id).single(),
    organizacaoDoUsuario(user.id),
    convitesPendentes(user.email),
    acessoDe(user.id),
    supabaseAdmin().from("matriz_entregas").select("comunicado",{count:"exact",head:true}).eq("titular",user.id).is("lido_em",null),
  ]);

  const espaco = daEquipe ? null : await armazenamentoDaConta(user.id, acesso).catch(() => null);
  const mb = (b: number) => (b / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const mais = [
    { href:"/conta/termos",rotulo:"Termos e contratos aceitos",texto:"Versões, cópias dos contratos de imóveis e renovação",icone:ShieldCheck },
    {href:"/conta/comunicados",rotulo:"Comunicados da Matriz",texto:avisos.count ? `${avisos.count} aviso(s) por ler` : "Avisos de manutenção, planos e atualizações",icone:LifeBuoy},
    ...(user.nicho==="engenheiro" ? [{href:"/painel/crm/profissoes",rotulo:"CRM da minha profissão",texto:"Modelos disponíveis e pedidos de módulos técnicos",icone:BadgeCheck}] : []),
    ...(["proprietario","produtor_rural"].includes(user.nicho??"") ? [{href:"/conta/monitoramento",rotulo:"Monitoramento territorial",texto:"Áreas acompanhadas e ocorrências nas fontes oficiais",icone:ShieldCheck}] : []),
    ...(user.nicho==="comprador_investidor" ? [{href:"/conta/filtros",rotulo:"Filtros de interesse",texto:"Buscas salvas e novos imóveis que combinam com você",icone:BadgeCheck}] : []),
    ...(!daEquipe && user.nicho!=="divulgador" ? [{ href: "/conta/creditos", rotulo: "Carteira da Ari", texto: "Créditos do plano, compras e histórico de uso", icone: BadgeCheck }] : []),
    ...(user.nicho==="divulgador" ? [{href:"/divulgador",rotulo:"Painel do divulgador",texto:"Inscrição, imóveis e atividades de divulgação",icone:BadgeCheck}] : []),
    { href: "/privacidade/preferencias", rotulo: "Preferências de privacidade", texto: "Histórico da Ari, navegação e avisos", icone: ShieldCheck },
    ...(!daEquipe && user.role!=="franqueado" ? [{ href: "/conta/perfis", rotulo: "Perfis de acesso", texto: "Adicionar um perfil ou trocar o contexto ativo", icone: Users }] : []),
    { href: "/conta/seguranca", rotulo: "Segurança da conta", texto: "senha, segundo fator e histórico de acessos", icone: ShieldCheck },
    ...(!daEquipe ? [{
      href: "/painel/organizacao", rotulo: "Organização", icone: Users,
      texto: vinculo ? `${vinculo.org.nome} (${PAPEL_ORG_LABEL[vinculo.membro.papel_org]})` : "você ainda não faz parte de nenhuma",
    }] : []),
    { href: "/planos", rotulo: "Planos", texto: "o que o seu plano libera", icone: BadgeCheck },
    { href: "/suporte", rotulo: "Suporte", texto: "fale com a equipe; dados pessoais (LGPD) também por lá", icone: LifeBuoy },
  ];

  return (
    <div className="min-h-screen bg-fundo">
      <TopoConta daEquipe={daEquipe} />
      <main className="mx-auto w-full max-w-3xl space-y-10 px-5 pb-16 pt-10 md:px-8 md:pt-14">
        <CabecalhoPagina
          eyebrow="Minha conta"
          titulo="Minha conta"
          subtitulo={<>
            {user.email} · plano <strong className="font-semibold text-texto">{acesso.planNome ?? "—"}</strong>
            {vinculo && ` · ${vinculo.org.nome}`}
            {espaco?.usadoBytes != null && <> · arquivos: {mb(espaco.usadoBytes)} MB{espaco.limiteMb ? ` de ${espaco.limiteMb.toLocaleString("pt-BR")} MB` : ""}</>}
          </>}
        />

        <Conta
          inicial={{
            nome: perfil?.nome ?? "",
            telefone: perfil?.telefone ?? "",
            avatar: perfil?.avatar_url ?? null,
            profissao_declarada: perfil?.profissao_declarada ?? "",
            especialidade: perfil?.especialidade ?? "",
            avisos_email: perfil?.avisos_email === true,
            preferencias: normalizar(perfil?.preferencias),
          }}
          convites={convites.map((c) => ({
            id: c.id, org: c.org?.nome ?? "Organização", tipo: TIPO_ORG_LABEL[c.org?.tipo as TipoOrg] ?? "",
            papel: PAPEL_ORG_LABEL[c.papel_org] ?? c.papel_org, emOutra: !!vinculo,
          }))}
        />

        <Secao titulo="Mais da conta">
          <div className="grid gap-4 sm:grid-cols-2">
            {mais.map(({ href, rotulo, texto, icone: Icone }) => (
              <Link key={href} href={href} className="cartao cartao-link group flex items-start gap-4 p-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde">
                  <Icone className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-base font-semibold text-texto group-hover:text-verde transition-colors">
                    {rotulo} <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-0.5 block text-sm text-texto-2">{texto}</span>
                </span>
              </Link>
            ))}
          </div>
        </Secao>
      </main>
    </div>
  );
}
