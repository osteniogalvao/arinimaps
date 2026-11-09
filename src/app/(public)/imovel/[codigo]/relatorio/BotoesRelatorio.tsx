"use client";

import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";
import EnviarWhatsApp from "@/components/compartilhar/EnviarWhatsApp";

/**
 * O PDF sai pela impressão do navegador (Salvar como PDF). É o caminho que
 * funciona em qualquer hospedagem — gerar o arquivo no servidor exigiria
 * Chromium instalado, que o app não tem (o worker tem, e pode assumir isso
 * depois sem mudar esta página).
 *
 * O link enviado leva as seções escolhidas (?secoes=…): quem recebe abre o
 * mesmo recorte do relatório. O relatório do imóvel publicado é público.
 */
export default function BotoesRelatorio({ codigo, titulo, secoes }: { codigo: string; titulo: string; secoes: string | null }) {
  const caminho = `/imovel/${codigo}/relatorio${secoes ? `?secoes=${secoes}` : ""}`;
  return (
    <div className="mb-10 flex flex-wrap gap-3 print:hidden">
      <button onClick={() => window.print()} className="lp-btn btn-verde !px-5 !py-3 text-[0.95rem]">
        <Download /> Baixar relatório (PDF)
      </button>
      <EnviarWhatsApp caminho={caminho} titulo={`Relatório territorial ${codigo}`}
        texto={`Relatório territorial ${secoes ? "(seções escolhidas) " : ""}de ${titulo} (${codigo}), da Arini:`}
        className="lp-btn lp-btn-contorno !px-5 !py-3 text-[0.95rem]" />
      <Link href={`/imovel/${codigo}`} className="lp-btn lp-btn-contorno !px-5 !py-3 text-[0.95rem]">
        Ver anúncio <ArrowRight />
      </Link>
    </div>
  );
}
