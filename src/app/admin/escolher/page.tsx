import { exigirEquipe } from "@/lib/setores-servidor";
import { Handshake, LayoutGrid, ArrowRight } from "lucide-react";
import { escolherPainel } from "./acoes";

/**
 * Escolha do painel logo depois de entrar (pedido do Stenio, 27/11/2026):
 * dois botões, um para o CRM da Arini Brasil e outro para o sistema completo
 * sem o CRM. Dá para trocar depois pelo botão "Trocar painel" do menu.
 */
export default async function EscolherPainel() {
  const user = await exigirEquipe();
  const primeiro = (user.nome ?? "").split(" ")[0];

  const cartao = (painel: "crm" | "sistema", Icone: typeof Handshake, titulo: string, texto: string, itens: string) => (
    <form action={escolherPainel}>
      <input type="hidden" name="painel" value={painel} />
      <button type="submit"
        className="cartao group flex h-full w-full flex-col items-start gap-4 p-7 text-left transition-colors hover:border-ouro focus-visible:border-ouro focus-visible:outline-none">
        <span className="grid size-14 place-items-center rounded-2xl border border-linha-forte text-ouro">
          <Icone className="size-7" />
        </span>
        <span className="lp-display text-3xl text-texto">{titulo}</span>
        <span className="text-texto-2">{texto}</span>
        <span className="text-sm text-texto-2/80">{itens}</span>
        <span className="mt-auto inline-flex items-center gap-2 pt-2 font-semibold text-verde group-hover:text-ouro">
          Entrar <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>
    </form>
  );

  return (
    <div className="mx-auto max-w-4xl py-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-texto-2">Central Arini</p>
      <h1 className="lp-display mt-2 text-4xl text-texto">{primeiro ? `Olá, ${primeiro}.` : "Olá."} Onde você vai trabalhar?</h1>
      <p className="mt-2 text-texto-2">Você pode trocar a qualquer momento pelo botão “Trocar painel”, no alto do menu.</p>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {cartao("crm", Handshake, "CRM Arini Brasil",
          "Captação, imóveis, proprietários, leads, aprovações e financeiro do dia a dia.",
          "Menu no mesmo jeito do CRM da Arini Negócios, só com as telas do seu setor.")}
        {cartao("sistema", LayoutGrid, "Sistema completo",
          "Matriz, tarefas, cartografia, planos, marketing, suporte, segurança e configurações.",
          "Tudo o que não é CRM, organizado por setor.")}
      </div>
    </div>
  );
}
