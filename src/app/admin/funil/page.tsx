import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ETAPAS } from "@/lib/funil";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO, aba } from "@/components/admin/estilos";
import { equipeAtiva } from "@/components/admin/Painel";
import FunilQuadro, { type CartaoFunil } from "@/components/crm-comercial/FunilQuadro";
import { TEMPERATURAS, TEMPERATURA_LABEL, type Temperatura } from "@/lib/crm-comercial";

/**
 * Teto do quadro: as N oportunidades mais recentes. O PostgREST cortaria em
 * 1000 sem avisar; aqui o corte é explícito e a página diz quantas ficaram de
 * fora (a busca por código fica em Leads).
 */
const MAX_CARDS = 500;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminFunil({ searchParams }: PageProps<"/admin/funil">) {
  const user = await exigirSetor("comercial");
  const sp = await searchParams;
  const quem = typeof sp.corretor === "string" && (UUID.test(sp.corretor) || sp.corretor === "eu") ? (sp.corretor === "eu" ? user.id : sp.corretor) : "";
  const temperatura = TEMPERATURAS.includes(sp.temperatura as Temperatura) ? (sp.temperatura as string) : "";
  const verPerdidos = sp.perdidos === "1";
  const BASE = `id, codigo, etapa, responsavel_tipo, created_at,
      lead:leads(nome), property:properties(codigo, titulo, valor),
      partner:partners!opportunities_responsavel_partner_id_fkey(razao_social)`;
  const admin = supabaseAdmin();
  const consulta = (campos: string, filtros: boolean) => {
    let q = admin.from("oportunidades_oficiais").select(campos, { count: "exact" }).order("created_at", { ascending: false }).limit(MAX_CARDS);
    if (!verPerdidos) q = q.neq("etapa", "perdido");
    if (filtros && quem) q = q.eq("responsavel_user_id", quem);
    if (filtros && temperatura) q = q.eq("temperatura", temperatura);
    return q;
  };
  const [r1, equipe] = await Promise.all([consulta(`${BASE}, responsavel_user_id, temperatura, proxima_acao_em`, true), equipeAtiva()]);
  const semCrm = !!r1.error;
  const r = semCrm ? await consulta(BASE, false) : r1;
  const nome = new Map(equipe.map((m) => [m.user_id, m.nome]));
  type Bruto = {
    id: string; codigo: string; etapa: string; responsavel_tipo: string; lead: { nome: string } | null;
    property: { titulo: string; valor: number | null } | null; partner: { razao_social: string } | null;
    responsavel_user_id?: string | null; temperatura?: string | null; proxima_acao_em?: string | null;
  };
  const brutos = [...((r.data ?? []) as unknown as Bruto[])].reverse(); // a mais antiga no topo da coluna
  const cartoes: CartaoFunil[] = brutos.map((o) => ({
    id: o.id, codigo: o.codigo, etapa: o.etapa, cliente: o.lead?.nome ?? "—", imovel: o.property?.titulo ?? "",
    valor: o.property?.valor ?? null, temperatura: o.temperatura ?? null, proximaAcaoEm: o.proxima_acao_em ?? null,
    responsavel: o.responsavel_user_id ? nome.get(o.responsavel_user_id) ?? "Arini"
      : o.responsavel_tipo === "arini" ? "Arini" : o.responsavel_tipo === "proprietario" ? "Proprietário" : o.partner?.razao_social ?? "Parceiro",
  }));
  const colunas = [...ETAPAS, ...(verPerdidos ? ["perdido"] : [])] as string[];
  const qs = (extra: Record<string, string>) => {
    const u = new URLSearchParams(Object.entries({ corretor: typeof sp.corretor === "string" ? sp.corretor : "", temperatura, perdidos: verPerdidos ? "1" : "", ...extra }).filter(([, v]) => v));
    return `/admin/funil${u.size ? `?${u}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Funil comercial"
        subtitulo="Arraste o card para mudar a etapa. Clique para abrir a oportunidade completa (linha do tempo, visitas, propostas, contrato, venda)." />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ corretor: "" })} className={aba(!quem)}>Toda a equipe</Link>
        <Link href={qs({ corretor: "eu" })} className={aba(quem === user.id)}>Meu funil</Link>
        <Link href={qs({ perdidos: verPerdidos ? "" : "1" })} className={aba(verPerdidos)}>Mostrar perdidos</Link>
        {!semCrm && (
          <form action="/admin/funil" className="ml-auto flex flex-wrap items-center gap-2">
            {verPerdidos && <input type="hidden" name="perdidos" value="1" />}
            <select name="corretor" defaultValue={quem} className={CAMPO_COMPACTO} aria-label="Corretor">
              <option value="">Todos os corretores</option>
              {equipe.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
            </select>
            <select name="temperatura" defaultValue={temperatura} className={CAMPO_COMPACTO} aria-label="Temperatura">
              <option value="">Qualquer temperatura</option>
              {TEMPERATURAS.map((t) => <option key={t} value={t}>{TEMPERATURA_LABEL[t]}</option>)}
            </select>
            <button className="lp-btn lp-btn-verde !px-4 !py-2 text-sm">Filtrar</button>
          </form>
        )}
      </div>
      {r.count != null && r.count > cartoes.length && (
        <p className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-texto">
          Mostrando as {cartoes.length} oportunidades mais recentes de {r.count}. As contagens das colunas valem para as que estão na tela.
        </p>
      )}
      <FunilQuadro colunas={colunas} cartoes={cartoes} />
    </div>
  );
}
