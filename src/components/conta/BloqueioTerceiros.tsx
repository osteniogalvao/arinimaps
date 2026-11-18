import { Lock, Search, Sparkles } from "lucide-react";
import Moldura from "@/components/shell/Moldura";
import { BotaoLink, Conteudo } from "@/components/ui/Pagina";
import { currentUser } from "@/lib/supabase/server";

/**
 * Página no lugar da consulta de uma área de terceiro (CAR ou lote sem anúncio)
 * para visitante e conta gratuita — pedido de 18/11/2026: "contas públicas
 * gratuitas só veem imóveis à venda; imóveis de terceiros não veem nada".
 */
export default async function BloqueioTerceiros({ tipo, anunciar }: { tipo: "rural" | "lote"; anunciar: string }) {
  const user = await currentUser();
  const usuario = user ? { nome: user.nome || "Conta", papel: "Usuário" } : null;
  return (
    <Moldura usuario={usuario}>
      <Conteudo estreito className="py-14 md:py-20">
        <div className="cartao space-y-6 p-7 md:p-10">
          <span className="grid size-12 place-items-center rounded-full border border-[#D9BD6F] text-ouro"><Lock className="size-5" /></span>
          <div className="space-y-3">
            <p className="lp-eyebrow">{tipo === "rural" ? "Área rural sem anúncio" : "Lote urbano sem anúncio"}</p>
            <h1 className="lp-display text-3xl text-texto md:text-4xl">Esta área não está à venda na Arini</h1>
            <p className="max-w-[60ch] text-[17px] leading-relaxed text-texto-2">
              {user
                ? "Sua conta gratuita mostra todos os imóveis à venda, com fotos, valores e a ficha completa. Área, matrícula, quadro ambiental e medidas de imóveis de terceiros fazem parte dos planos de consulta."
                : "Sem conta, o mapa mostra os imóveis à venda. Dados de imóveis de terceiros (área, matrícula, quadro ambiental e medidas) ficam nos planos de consulta."}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {user
              ? <BotaoLink href="/planos" variante="ouro"><Sparkles className="size-4" /> Ver planos de consulta</BotaoLink>
              : <BotaoLink href="/entrar?cadastro=1" variante="ouro">Criar conta grátis</BotaoLink>}
            <BotaoLink href="/imoveis" variante="contorno" seta={false}><Search className="size-4" /> Ver imóveis à venda</BotaoLink>
          </div>
          <p className="border-t border-linha pt-4 text-sm text-texto-2">
            {tipo === "rural"
              ? <>A área é sua? <a href={anunciar} className="font-semibold text-verde hover:underline">Guarde no seu cofre ou anuncie</a> e veja os dados dela sem custo.</>
              : <>O lote é seu? <a href={anunciar} className="font-semibold text-verde hover:underline">Anuncie pela Arini</a>.</>}
          </p>
        </div>
      </Conteudo>
    </Moldura>
  );
}
