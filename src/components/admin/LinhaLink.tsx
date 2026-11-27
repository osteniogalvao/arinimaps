"use client";

import { useRouter } from "next/navigation";

/**
 * Linha de tabela que abre o registro (como no CRM da Arini Negócios: clicar
 * em qualquer ponto da linha abre a ficha). Enter e Espaço também abrem.
 * Links e botões dentro da linha continuam funcionando sozinhos.
 */
export default function LinhaLink({ href, className = "", rotulo, children }: {
  href: string; className?: string; rotulo: string; children: React.ReactNode;
}) {
  const router = useRouter();
  const abrir = (e: React.SyntheticEvent) => {
    if ((e.target as HTMLElement).closest("a,button,input,select,textarea")) return;
    router.push(href);
  };
  return (
    <tr tabIndex={0} aria-label={rotulo} onClick={abrir}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(e); } }}
      className={"cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-verde/50 " + className}>
      {children}
    </tr>
  );
}
