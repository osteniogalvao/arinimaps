import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Building2, Mail, MessageCircle, Phone, Plus } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { BotaoLink, CabecalhoPagina, Etiqueta } from "@/components/ui/Pagina";
import { LISTA } from "@/components/admin/estilos";
import { equipeAtiva } from "@/components/admin/Painel";
import { carteira } from "@/lib/crm-clientes";
import { ETAPA_LABEL, humanizarEvento } from "@/lib/funil";
import { formatBRL } from "@/lib/format";
import { ORIGEM_LABEL, TEMPERATURA_LABEL, TEMPERATURA_TOM, linkWhatsApp, type Temperatura } from "@/lib/crm-comercial";

/** Ficha do cliente: todas as negociações e a linha do tempo de contatos, juntas. */
export default async function FichaCliente({ params }: PageProps<"/admin/clientes/[chave]">) {
  await exigirSetor("comercial");
  const { chave } = await params;
  const alvo = decodeURIComponent(chave);
  const [{ clientes }, equipe] = await Promise.all([carteira(), equipeAtiva()]);
  const c = clientes.find((x) => x.chave === alvo);
  if (!c) notFound();
  const nome = new Map(equipe.map((m) => [m.user_id, m.nome]));
  const ids = c.oportunidades.map((o) => o.id);
  const { data: eventos } = await supabaseAdmin().from("opportunity_events")
    .select("id, opportunity_id, tipo, descricao, created_at, autor").in("opportunity_id", ids)
    .order("created_at", { ascending: false }).limit(80);
  const codigo = new Map(c.oportunidades.map((o) => [o.id, o.codigo]));
  const zap = linkWhatsApp(c.telefone, `Olá, ${c.nome.split(/\s+/)[0]}!`);

  return (
    <div className="max-w-5xl space-y-8">
      <CabecalhoPagina eyebrow="Carteira de clientes" titulo={c.nome}
        subtitulo={<span className="flex flex-wrap gap-x-5 gap-y-1">
          {c.telefone && <span className="inline-flex items-center gap-1.5"><Phone className="size-4" />{c.telefone}</span>}
          {c.email && <span className="inline-flex items-center gap-1.5"><Mail className="size-4" />{c.email}</span>}
          {c.responsavel && <span>Corretor: {nome.get(c.responsavel) ?? "equipe"}</span>}
        </span>}
        acoes={<div className="flex flex-wrap gap-2">
          {zap && <a href={zap} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-verde !px-5 !py-3 text-[0.95rem]"><MessageCircle /> WhatsApp</a>}
          <BotaoLink href="/admin/leads/novo" variante="contorno" seta={false}><Plus /> Outro imóvel</BotaoLink>
        </div>} />

      <div className="flex flex-wrap gap-2">
        {c.temperatura && <Etiqueta tom={TEMPERATURA_TOM[c.temperatura as Temperatura]}>{TEMPERATURA_LABEL[c.temperatura as Temperatura]}</Etiqueta>}
        {c.etiquetas.map((t) => <Etiqueta key={t}>{t}</Etiqueta>)}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-texto">Negociações ({c.oportunidades.length})</h2>
        <div className={LISTA}>
          {c.oportunidades.map((o) => (
            <Link key={o.id} href={`/admin/oportunidades/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-superficie-2/70">
              <span className="font-mono text-xs text-texto-2">{o.codigo}</span>
              <span className="inline-flex flex-1 min-w-56 items-center gap-1.5 text-texto"><Building2 className="size-4 shrink-0" />{o.property?.codigo} — {o.property?.titulo}</span>
              <span className="text-sm tabular-nums text-texto-2">{formatBRL(o.property?.valor ?? null)}</span>
              <span className="text-xs text-texto-2">{ORIGEM_LABEL[o.lead?.origem ?? ""] ?? o.lead?.origem}</span>
              <Etiqueta tom={o.etapa === "perdido" ? "critico" : ["fechado", "pos_venda"].includes(o.etapa) ? "verde" : "ouro"}>{ETAPA_LABEL[o.etapa] ?? o.etapa}</Etiqueta>
              <ArrowRight className="size-4 text-verde" />
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-texto">Linha do tempo</h2>
        <ol className="cartao space-y-3 p-5 text-sm">
          {(eventos ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2 border-b border-linha pb-2 last:border-0">
              <span className="tabular-nums text-texto-2">{new Date(e.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })}</span>
              <span className="font-mono text-xs text-texto-2">{codigo.get(e.opportunity_id)}</span>
              <span className="font-medium text-texto">{e.autor ? nome.get(e.autor) ?? "Cliente" : "Sistema"}</span>
              <span className="text-texto-2">{humanizarEvento(e.descricao)}</span>
            </li>
          ))}
          {!eventos?.length && <li className="text-texto-2">Sem eventos.</li>}
        </ol>
      </section>
    </div>
  );
}
