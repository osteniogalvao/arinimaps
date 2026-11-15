import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LogIn } from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { BotaoLink, CabecalhoPagina, Conteudo } from "@/components/ui/Pagina";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { acessoDe } from "@/lib/planos-servidor";
import { ehTipoSolicitacao, type TipoSolicitacao } from "@/lib/cartografia/solicitacoes";
import { resolverReferencia } from "@/lib/cartografia/servidor";
import FormSolicitacao from "./FormSolicitacao";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Informar imóvel ausente ou divergente",
  description: "Não encontrou seu imóvel no mapa ou a divisa está errada? Abra uma solicitação para a equipe de cartografia.",
};

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * "Não encontrei meu imóvel no mapa" / "O mapa está divergente" (requisitos
 * §2.1). Chega do chip do mapa (lng/lat/zoom), do cartão do CAR ou do lote
 * (referencia) ou do painel do imóvel (imovel). Tudo que vem pela URL é só
 * pré-preenchimento: a rota da API confere de novo.
 */
export default async function SolicitarCartografia({ searchParams }: PageProps<"/cartografia/solicitar">) {
  const sp = await searchParams;
  const user = await currentUser();
  const acesso = await acessoDe(user?.id);
  const usuario = user
    ? { nome: user.nome || "Conta", papel: acesso.equipe ? "Matriz" : acesso.planNome ?? "Usuário" }
    : null;

  const lng = Number(str(sp.lng)), lat = Number(str(sp.lat)), zoom = Number(str(sp.zoom));
  const centro = Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
    ? { lng, lat, zoom: Number.isFinite(zoom) ? Math.min(19, Math.max(8, zoom)) : 14 }
    : null;
  const tipoInicial: TipoSolicitacao = ehTipoSolicitacao(str(sp.tipo)) ? (str(sp.tipo) as TipoSolicitacao) : "inclusao";

  if (!user) {
    const volta = `/cartografia/solicitar?${new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string")).toString()}`;
    return (
      <Moldura usuario={null}>
        <CabecalhoPagina variante="faixa" eyebrow="Cartografia" titulo="Informar imóvel ausente ou" destaque="divergente" />
        <Conteudo estreito className="py-12 md:py-16">
          <div className="cartao space-y-4 p-6 text-base leading-relaxed md:p-8">
            <span className="grid size-12 place-items-center rounded-2xl bg-verde/12 text-verde">
              <LogIn className="size-6" />
            </span>
            <p className="text-texto">
              Para abrir a solicitação é preciso entrar na sua conta: ela ganha um número de protocolo e você
              acompanha cada etapa da análise da equipe de cartografia.
            </p>
            <p className="text-texto-2">
              A conta é gratuita. Depois de entrar, volte a esta página — se veio do mapa, a posição que você estava vendo
              é guardada no endereço.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <BotaoLink href="/entrar">Entrar ou criar conta</BotaoLink>
              <BotaoLink href={volta} variante="contorno" seta={false}>Voltar a esta página depois</BotaoLink>
              <BotaoLink href="/mapa" variante="contorno" seta={false}>Voltar ao mapa</BotaoLink>
            </div>
          </div>
        </Conteudo>
      </Moldura>
    );
  }

  const admin = supabaseAdmin();
  const [referencia, { data: municipios }, imovel] = await Promise.all([
    resolverReferencia(str(sp.referencia)),
    admin.from("municipalities").select("id, nome").eq("ativo", true).order("nome"),
    (async () => {
      const id = str(sp.imovel);
      if (!id || !RE_UUID.test(id)) return null;
      // RLS: só aparece se o imóvel for visível a quem está logado
      const supabase = await supabaseServer();
      const { data } = await supabase.from("properties").select("id, codigo, titulo, municipality_id").eq("id", id).maybeSingle();
      if (data) return data;
      const { data: publicado } = await admin.from("properties").select("id, codigo, titulo, municipality_id")
        .eq("id", id).in("status", ["publicado", "em_negociacao"]).maybeSingle();
      return publicado ?? null;
    })(),
  ]);

  return (
    <Moldura usuario={usuario}>
      <CabecalhoPagina
        variante="faixa"
        eyebrow="Cartografia"
        titulo="Informar imóvel ausente ou"
        destaque="divergente"
        subtitulo={
          <>
            Não encontrou seu imóvel no mapa, ou a divisa, a área ou a posição estão erradas? Conte para a equipe de
            cartografia. A solicitação ganha um protocolo e você acompanha a análise em{" "}
            <Link href="/painel/cartografia" className="inline-flex items-center gap-1 font-semibold text-verde hover:underline">Mapa: solicitações <ArrowRight className="size-4" /></Link>.
          </>
        }
      />
      <Conteudo estreito className="py-12 md:py-16">

        <FormSolicitacao
          tipoInicial={tipoInicial}
          centro={centro}
          referencia={referencia ? { codigo: `${referencia.tipo}:${referencia.codigo}`, rotulo: referencia.rotulo, geometry: referencia.geometry, fonte: referencia.tipo } : null}
          municipios={municipios ?? []}
          municipioInicial={referencia?.municipality_id ?? imovel?.municipality_id ?? ""}
          imovel={imovel ? { id: imovel.id, codigo: imovel.codigo, titulo: imovel.titulo } : null}
        />
      </Conteudo>
    </Moldura>
  );
}
