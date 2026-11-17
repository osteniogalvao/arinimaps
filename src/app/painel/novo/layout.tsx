import Link from "next/link";
import { acessoAtual } from "@/lib/planos-servidor";

export default async function AcessoAoCadastro({ children }: LayoutProps<"/painel/novo">) {
  const { acesso } = await acessoAtual();
  if (acesso.recursos.has("anunciar")) return children;
  return (
    <section className="space-y-3">
      <h1 className="lp-display text-2xl">Anunciar imóvel</h1>
      <p>O cadastro de anúncios exige perfil de anunciante e plano com esse recurso.</p>
      <p className="flex flex-wrap gap-4">
        <Link href="/planos" className="font-semibold text-verde hover:underline">Ver os planos com anúncio</Link>
        <Link href="/suporte" className="text-texto-2 hover:underline">Dúvidas sobre o perfil</Link>
      </p>
    </section>
  );
}
