import Link from "next/link";
import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import NavAtendimento from "@/components/atendimento/NavAtendimento";
import { falta0156, lerMenu } from "@/lib/atendimento";
import { setoresDe } from "@/lib/setores";
import ConfigAtendimento from "@/components/atendimento/ConfigAtendimento";
import type { HorarioSetor } from "@/lib/atendimento-horario";
import { telegramConfigurado } from "@/lib/meta-mensagens";

export const metadata = { title: "Configurar atendimento" };

/** Diretoria: menu automático do WhatsApp, respostas prontas, recepção e prazo de resposta. */
export default async function ConfigurarAtendimento() {
  await exigirSetor("diretoria");
  const admin = supabaseAdmin();
  const [{ menu, opcoes, erro }, respostas, equipe, prazo, horarios, chatSite] = await Promise.all([
    lerMenu(),
    admin.from("atendimento_respostas").select("id, atalho, titulo, texto, setor").order("atalho"),
    admin.from("profiles").select("user_id, nome, role, setores, atendimento_recepcao").in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("nome"),
    admin.from("settings").select("valor").eq("chave", "atendimento_prazo_minutos").maybeSingle(),
    admin.from("atendimento_setores_horario").select("setor, dias, inicio, fim, prazo_minutos, mensagem_fora"),
    admin.from("settings").select("valor").eq("chave", "atendimento_chat_site").maybeSingle(),
  ]);
  if (erro || !menu) {
    return (
      <div className="space-y-4">
        <CabecalhoPagina titulo="Configurar atendimento" eyebrow="Diretoria" />
        <p className="cartao p-5" role="alert">{falta0156(erro) || !menu ? "Falta rodar a migration 0156 (Atendimento por setores) no Supabase." : "Falha ao carregar."}</p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <CabecalhoPagina titulo="Configurar atendimento" eyebrow="Diretoria" />
      <NavAtendimento atual="configurar" triagem diretoria />
      <p className="text-sm text-texto-2">
        Um número de WhatsApp para a empresa toda. O cliente recebe o menu, escolhe o assunto e cai na fila do setor; quem já tem negociação
        aberta vai direto ao corretor, e proprietário ou parceiro reconhecido pelo telefone pula o menu. O que não for escolhido fica na caixa
        central para a recepção triar. <Link href="/admin/atendimento" className="font-semibold text-verde underline">Abrir o atendimento</Link>
      </p>
      <ConfigAtendimento
        menu={menu}
        opcoes={opcoes}
        respostas={respostas.data ?? []}
        prazo={Number(prazo.data?.valor ?? 30) || 30}
        horarios={horarios.error ? null : (horarios.data ?? []).map((h) => ({
          ...h, inicio: String(h.inicio).slice(0, 5), fim: String(h.fim).slice(0, 5),
        })) as HorarioSetor[]}
        chatSite={chatSite.data?.valor === true}
        telegram={telegramConfigurado()}
        equipe={(equipe.data ?? []).map((p) => ({
          user_id: p.user_id as string, nome: (p.nome as string) || "Sem nome", diretoria: p.role === "admin_central",
          recepcao: !!p.atendimento_recepcao, setores: setoresDe(p.role as string, p.setores as string[] | null),
        }))}
      />
    </div>
  );
}
