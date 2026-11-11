import { LEAD_ORIGEM_LABEL } from "@/lib/funil";
import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatBRL, STATUS_LABEL } from "@/lib/format";
import { ETAPA_LABEL } from "@/lib/funil";
import OportunidadeClient, { type Atendimento } from "@/components/crm/OportunidadeClient";
import { equipeAtiva } from "@/components/admin/Painel";
import SimuladorProposta from "@/components/empreendimento/SimuladorProposta";
import { hojeBrasilia, simulacaoDaRodada } from "@/lib/simulador";
import { nomeAnunciante } from "@/lib/empreendimento/espelho";
import { exigirSetor } from "@/lib/setores-servidor";
import { ArrowRight, Building2, Mail, Phone, Radio } from "lucide-react";
import { Etiqueta } from "@/components/ui/Pagina";

export default async function OportunidadeAdmin({ params }: PageProps<"/admin/oportunidades/[id]">) {
  const user = await exigirSetor("comercial");
  const { id } = await params;
  const admin = supabaseAdmin();

  const { data: opp } = await admin
    .from("opportunities")
    .select(`
      id, codigo, etapa, responsavel_tipo, responsavel_partner_id, partner_comprador_id,
      qualificacao, motivo_perda, created_at,
      lead:leads(nome, telefone, email, mensagem, origem, created_at),
      property:properties(id, codigo, titulo, tipo, status, valor, owner_id, partner_id,
        municipality:municipalities!properties_municipality_id_fkey(nome))
    `)
    .eq("id", id)
    .single();
  if (!opp) notFound();

  const [{ data: eventos }, { data: visitas }, { data: propostas }, { data: contrato }, { data: venda }, { data: parceiros }, { data: pctPadrao }] = await Promise.all([
    admin.from("opportunity_events").select("id, tipo, descricao, created_at, autor:profiles(nome)").eq("opportunity_id", id).order("created_at", { ascending: false }).limit(50),
    // relatório da visita (0065); sem a coluna, cai para a lista antiga
    admin.from("visits").select("id, data_hora, status, feedback, relatorio").eq("opportunity_id", id).order("data_hora", { ascending: false })
      .then(async (r) => (r.error
        ? await admin.from("visits").select("id, data_hora, status, feedback").eq("opportunity_id", id).order("data_hora", { ascending: false })
        : r)),
    admin.from("proposals").select("id, numero_rodada, autor_lado, valor, entrada, prazo, condicoes, observacoes, status, created_at, parcelamento").eq("opportunity_id", id).order("numero_rodada", { ascending: false }),
    admin.from("contracts").select("status, documento_path, assinado_at").eq("opportunity_id", id).maybeSingle(),
    admin.from("sales").select("id, valor_final, data_venda, commission:commissions(valor, percentual, status)").eq("opportunity_id", id).maybeSingle(),
    admin.from("partners").select("id, razao_social, tipo").in("status", ["aprovado", "ativo"]).order("razao_social"),
    admin.from("settings").select("valor").eq("chave", "comissao_percentual_padrao").single(),
  ]);

  // atendimento do lead (rodízio, 0065): só existe com a migration aplicada
  const [{ data: atend }, equipe] = await Promise.all([
    admin.from("opportunities").select("responsavel_user_id, prazo_atendimento, primeiro_atendimento_em").eq("id", id).maybeSingle(),
    equipeAtiva(),
  ]);
  const atendimento: Atendimento | null = atend ? {
    responsavelId: atend.responsavel_user_id,
    responsavelNome: equipe.find((m) => m.user_id === atend.responsavel_user_id)?.nome ?? null,
    souEu: user.id,
    prazo: atend.prazo_atendimento,
    primeiroAtendimento: atend.primeiro_atendimento_em,
    podeRepassar: user.setores.includes("comercial") || user.setores.includes("diretoria"),
    equipe,
  } : null;

  const lead = opp.lead as unknown as { nome: string; telefone: string | null; email: string | null; mensagem: string | null; origem: string } | null;
  const prop = opp.property as unknown as { id: string; codigo: string; titulo: string; tipo: string; status: string; valor: number | null; owner_id: string | null; partner_id: string | null; municipality: { nome: string } | null } | null;
  // simulador de proposta (item 20)
  const anunciante = await nomeAnunciante(prop?.owner_id ?? null, prop?.partner_id ?? null);
  const rodadas = (propostas ?? []).flatMap((p) => {
    const simulacao = simulacaoDaRodada(p.parcelamento);
    return simulacao ? [{ id: p.id, numero_rodada: p.numero_rodada, autor_lado: p.autor_lado, status: p.status, valor: Number(p.valor), simulacao }] : [];
  });

  return (
    <div className="space-y-8 max-w-5xl">
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 max-w-3xl">
          <p className="lp-eyebrow text-xs">Oportunidade <span className="font-mono tracking-normal">{opp.codigo}</span></p>
          <h1 className="lp-display mt-2 text-3xl md:text-[2.5rem] text-texto text-balance">{lead?.nome ?? "Oportunidade"}</h1>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[0.95rem] text-texto-2">
            {lead?.telefone && <span className="inline-flex items-center gap-1.5"><Phone className="size-4" />{lead.telefone}</span>}
            {lead?.email && <span className="inline-flex items-center gap-1.5"><Mail className="size-4" />{lead.email}</span>}
            <span className="inline-flex items-center gap-1.5"><Radio className="size-4" />origem: {lead?.origem ? LEAD_ORIGEM_LABEL[lead.origem] ?? lead.origem : "—"}</span>
          </p>
          {lead?.mensagem && <p className="mt-3 text-base leading-relaxed text-texto-2">“{lead.mensagem}”</p>}
        </div>
        <div className="flex flex-col items-start gap-2.5 md:items-end">
          <Etiqueta tom="ouro" className="!px-3 !py-1.5 !text-sm">
            {ETAPA_LABEL[opp.etapa] ?? opp.etapa}
          </Etiqueta>
          {prop && (
            <p className="text-sm text-texto-2 md:text-right">
              <Link className="inline-flex items-center gap-1.5 font-semibold text-verde hover:underline underline-offset-4" href={`/admin/imoveis/${prop.id}`}>
                <Building2 className="size-4" />{prop.codigo} — {prop.titulo}
              </Link>
              <br />
              {prop.municipality?.nome} · <span className="tabular-nums">{formatBRL(prop.valor)}</span> · {STATUS_LABEL[prop.status]}
            </p>
          )}
          {/* 5.16: o cliente não gostou do imóvel — guarda o que ele procura para casar com os próximos */}
          <Link href={`/admin/demandas?opp=${opp.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline underline-offset-4"
            title="O cliente não gostou deste imóvel? Registre o que ele procura e o sistema avisa quando um imóvel novo casar.">
            Registrar demanda do cliente <ArrowRight className="size-4" />
          </Link>
        </div>
      </header>

      <OportunidadeClient
        modo="arini"
        oportunidade={{
          id: opp.id,
          etapa: opp.etapa,
          responsavel_tipo: opp.responsavel_tipo,
          responsavel_partner_id: opp.responsavel_partner_id,
          partner_comprador_id: opp.partner_comprador_id,
          motivo_perda: opp.motivo_perda,
          valor_imovel: prop?.valor ?? null,
        }}
        parceiros={parceiros ?? []}
        eventos={(eventos ?? []).map((e) => ({
          id: e.id, tipo: e.tipo, descricao: e.descricao, created_at: e.created_at,
          autor: (e.autor as unknown as { nome: string } | null)?.nome ?? null,
        }))}
        visitas={visitas ?? []}
        propostas={propostas ?? []}
        contrato={contrato ?? null}
        venda={venda ? {
          valor_final: venda.valor_final, data_venda: venda.data_venda,
          comissao: venda.commission as unknown as { valor: number; percentual: number; status: string } | null,
        } : null}
        percentualPadrao={Number(pctPadrao?.valor ?? 1)}
        atendimento={atendimento}
      />

      <SimuladorProposta
        oportunidadeId={opp.id}
        imovel={{ codigo: prop?.codigo ?? "", titulo: prop?.titulo ?? "" }}
        valorTabela={prop?.valor ?? null}
        cliente={lead?.nome ?? null}
        anunciante={anunciante}
        hoje={hojeBrasilia()}
        rodadas={rodadas}
      />
    </div>
  );
}
