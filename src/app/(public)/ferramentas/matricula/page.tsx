import type { Metadata } from "next";
import Moldura from "@/components/shell/Moldura";
import { CabecalhoPagina, Conteudo } from "@/components/ui/Pagina";
import { currentUser } from "@/lib/supabase/server";
import LeituraMatriculaCliente from "./LeituraMatriculaCliente";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leitura de matrícula",
  description: "Envie a certidão de matrícula e receba o resumo: proprietários atuais, atos e ônus vigentes.",
};

/** Leitura de matrícula com IA (ideia do Geomart, 11/11/2026). */
export default async function LeituraMatricula() {
  const user = await currentUser();
  const usuario = user
    ? { nome: user.nome || "Conta", papel: user.role === "admin_central" ? "Administrador" : "Usuário" }
    : null;
  return (
    <Moldura usuario={usuario}>
      <CabecalhoPagina
        variante="faixa"
        eyebrow="Ferramentas"
        titulo="Leitura de"
        destaque="matrícula"
        subtitulo="Envie o PDF ou a foto da certidão. A Ari lê os registros e averbações e devolve os proprietários atuais e os ônus que continuam valendo."
      />
      <Conteudo estreito className="py-12 md:py-16">
        <LeituraMatriculaCliente logado={!!user} />
      </Conteudo>
    </Moldura>
  );
}
