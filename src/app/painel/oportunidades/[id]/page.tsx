import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone, Mail, Building2, Quote } from "lucide-react";
import { Etiqueta } from "@/components/ui/Pagina";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatBRL } from "@/lib/format";
import { ETAPA_LABEL } from "@/lib/funil";
import OportunidadeClient from "@/components/crm/OportunidadeClient";
import SimuladorProposta from "@/components/empreendimento/SimuladorProposta";
import { hojeBrasilia, simulacaoDaRodada } from "@/lib/simulador";
import { nomeAnunciante } from "@/lib/empreendimento/espelho";
import { ator } from "@/lib/authz";

export default async function OportunidadeParceiro({ params }: PageProps<"/painel/oportunidades/[id]">) {
  const { id } = await params;

  // RLS decide o acesso: se a query autenticada não devolver, é 404
  const supabase = await supabaseServer();
  const { data: opp } = await supabase
    .from("opportunities")
    .select("id, codigo, etapa, responsavel_tipo, responsavel_partner_id, partner_comprador_id, motivo_perda")
    .eq("id", id)
    .maybeSingle();
  if (!opp) notFound();

  const admin = supabaseAdmin();
  const [{ data: detalhe }, { data: eventos }, { data: visitas }, { data: propostas }] = await Promise.all([
    admin.from("opportunities")
      .select("lead:leads(nome, telefone, email, mensagem), property:properties(codigo, titulo, valor, owner_id, partner_id)")
      .eq("id", id).single(),
    admin.from("opportunity_events").select("id, tipo, descricao, created_at, autor:profiles(nome)").eq("opportunity_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("visits").select("id, data_hora, status, feedback, relatorio").eq("opportunity_id", id).order("data_hora", { ascending: false })
      .then(async (r) => (r.error
        ? await admin.from("visits").select("id, data_hora, status, feedback").eq("opportunity_id", id).order("data_hora", { ascending: false })
        : r)),
    admin.from("proposals").select("id, numero_rodada, autor_lado, valor, entrada, prazo, condicoes, observacoes, status, created_at, parcelamento").eq("opportunity_id", id).order("numero_rodada", { ascending: false }),
  ]);

  const lead = detalhe?.lead as unknown as { nome: string; telefone: string | null; email: string | null; mensagem: string | null } | null;
  const prop = detalhe?.property as unknown as { codigo: string; titulo: string; valor: number | null; owner_id: string | null; partner_id: string | null } | null;
  // simulador (item 20): quem anuncia contrapropõe como vendedor; o parceiro do comprador propõe
  const [a, anunciante] = await Promise.all([ator(), nomeAnunciante(prop?.owner_id ?? null, prop?.partner_id ?? null)]);
  const ladoVendedor = !!a && ((!!a.ownerId && a.ownerId === prop?.owner_id) || (!!a.partnerId && a.partnerId === opp.responsavel_partner_id));
  const rodadas = (propostas ?? []).flatMap((p) => {
    const simulacao = simulacaoDaRodada(p.parcelamento);
    return simulacao ? [{ id: p.id, numero_rodada: p.numero_rodada, autor_lado: p.autor_lado, status: p.status, valor: Number(p.valor), simulacao }] : [];
  });

  return (
    <div className="space-y-8">
      <div>
        <Link href="/painel/oportunidades" className="inline-flex items-center gap-1.5 text-sm font-semibold text-texto-2 hover:text-verde transition-colors">
          <ArrowLeft className="size-4" /> Minhas oportunidades
        </Link>
        <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-sm text-texto-2">{opp.codigo}</p>
            <h1 className="lp-display mt-1 text-2xl md:text-[2rem] text-texto">{lead?.nome}</h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-base text-texto-2">
              {lead?.telefone && <span className="inline-flex items-center gap-2"><Phone className="size-4" /> {lead.telefone}</span>}
              {lead?.email && <span className="inline-flex items-center gap-2"><Mail className="size-4" /> {lead.email}</span>}
            </div>
            {lead?.mensagem && (
              <p className="mt-4 flex max-w-2xl gap-2 rounded-xl bg-superficie-2 px-4 py-3 text-base italic text-texto-2">
                <Quote className="mt-1 size-4 shrink-0 text-ouro" />“{lead.mensagem}”
              </p>
            )}
          </div>
          <div className="cartao shrink-0 p-5 md:max-w-xs">
            <Etiqueta tom="ouro">{ETAPA_LABEL[opp.etapa]}</Etiqueta>
            <p className="mt-3 flex items-start gap-2 text-sm text-texto-2">
              <Building2 className="mt-0.5 size-4 shrink-0" />
              <span>{prop?.codigo} — {prop?.titulo}</span>
            </p>
            <p className="mt-2 text-lg font-semibold tabular-nums text-texto">{formatBRL(prop?.valor ?? null)}</p>
          </div>
        </div>
      </div>

      <OportunidadeClient
        modo="parceiro"
        oportunidade={{
          id: opp.id, etapa: opp.etapa, responsavel_tipo: opp.responsavel_tipo,
          responsavel_partner_id: opp.responsavel_partner_id, partner_comprador_id: opp.partner_comprador_id,
          motivo_perda: opp.motivo_perda, valor_imovel: prop?.valor ?? null,
        }}
        parceiros={[]}
        eventos={(eventos ?? []).map((e) => ({
          id: e.id, tipo: e.tipo, descricao: e.descricao, created_at: e.created_at,
          autor: (e.autor as unknown as { nome: string } | null)?.nome ?? null,
        }))}
        visitas={visitas ?? []}
        propostas={propostas ?? []}
        contrato={null}
        venda={null}
        percentualPadrao={1}
      />

      <SimuladorProposta
        oportunidadeId={opp.id}
        imovel={{ codigo: prop?.codigo ?? "", titulo: prop?.titulo ?? "" }}
        valorTabela={prop?.valor ?? null}
        cliente={lead?.nome ?? null}
        anunciante={anunciante}
        hoje={hojeBrasilia()}
        rodadas={rodadas}
        ladoPadrao={ladoVendedor ? "vendedor" : "comprador"}
      />
    </div>
  );
}
