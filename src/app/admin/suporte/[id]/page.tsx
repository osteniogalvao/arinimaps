import Link from "next/link";
import { ArrowLeft, CalendarClock, Mail, Phone, UserCheck, UserX } from "lucide-react";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { dataHoraBR, equipeAtiva } from "@/components/admin/Painel";
import Atendimento from "./Atendimento";
import Conversa from "./Conversa";

const CATEGORIA: Record<string, string> = {
  duvida: "Dúvida", problema: "Problema no sistema", anuncio: "Meu anúncio", financeiro: "Cobrança", outro: "Outro",
};

export default async function ChamadoAdmin({ params }: PageProps<"/admin/suporte/[id]">) {
  await exigirSetor("suporte");
  const { id } = await params;
  const admin = supabaseAdmin();
  const [{ data: c }, { data: mensagens }, equipe, {data:avaliacao,error:erroAvaliacao}] = await Promise.all([
    admin.from("support_tickets")
      .select("id, codigo, nome, email, telefone, categoria, assunto, status, prioridade, responsavel, user_id, created_at")
      .eq("id", id).maybeSingle(),
    admin.from("support_messages").select("id, autor_nome, da_equipe, interno, corpo, created_at").eq("ticket_id", id).order("created_at"),
    equipeAtiva(),
    admin.from("support_avaliacoes").select("nota,comentario,created_at").eq("ticket_id",id).maybeSingle(),
  ]);
  if (!c) notFound();
  if(erroAvaliacao)throw new Error("Não foi possível consultar a avaliação do chamado.");

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-4">
        <Link href="/admin/suporte" className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline">
          <ArrowLeft className="size-4" /> Chamados
        </Link>
        <div>
          <p className="lp-eyebrow text-xs"><span className="font-mono">{c.codigo}</span> · {CATEGORIA[c.categoria] ?? c.categoria}</p>
          <h1 className="lp-display mt-2 text-3xl md:text-[2.5rem] text-texto text-balance">{c.assunto}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.95rem] text-texto-2">
            <span className="font-semibold text-texto">{c.nome}</span>
            <span className="inline-flex items-center gap-1.5"><Mail className="size-4" /> {c.email}</span>
            {c.telefone && <span className="inline-flex items-center gap-1.5"><Phone className="size-4" /> {c.telefone}</span>}
            <span className="inline-flex items-center gap-1.5 tabular-nums"><CalendarClock className="size-4" /> aberto em {dataHoraBR(c.created_at)}</span>
            {c.user_id
              ? <span className="inline-flex items-center gap-1.5"><UserCheck className="size-4 text-verde" /> tem conta no sistema</span>
              : <span className="inline-flex items-center gap-1.5"><UserX className="size-4" /> visitante sem conta</span>}
          </div>
        </div>
      </header>

      {/* 10.2: a conversa atualiza sozinha (polling de 5 s) */}
      <Conversa id={c.id} inicial={mensagens ?? []} temConta={!!c.user_id} />
      {avaliacao&&<section className="cartao space-y-2 p-5"><h2 className="font-semibold">Avaliação do cliente: {avaliacao.nota} de 5</h2><p className="text-sm text-texto-2">{dataHoraBR(avaliacao.created_at)}</p>{avaliacao.comentario&&<p className="whitespace-pre-wrap">{avaliacao.comentario}</p>}</section>}

      <Atendimento
        id={c.id} situacao={c.status} prioridade={c.prioridade} responsavel={c.responsavel ?? ""}
        equipe={equipe} semConta={!c.user_id}
      />
    </div>
  );
}
