import Link from "next/link";
import { acessoAtual } from "@/lib/planos-servidor";

export default async function AcessoAoCadastro({ children }: LayoutProps<"/painel/novo">) {
  const { acesso } = await acessoAtual();
  if (acesso.recursos.has("anunciar")) return children;
  return (
    <section className="space-y-3">
      <h1 className="lp-display text-2xl">Anunciar imóvel</h1>
      <p>O cadastro de anúncios exige perfil de anunciante e plano com esse recurso.</p>
      <Link href="/suporte" className="font-semibold text-verde hover:underline">Falar com a Arini</Link>
    </section>
  );
}
