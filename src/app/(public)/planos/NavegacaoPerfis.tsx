"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { PERSONAS_PLANOS, type PersonaPlano } from "@/lib/planos";

export default function NavegacaoPerfis({ persona }: { persona: PersonaPlano }) {
  const [aberto, setAberto] = useState(false);
  return <>
    <button type="button" className="vitrine-trocar" aria-expanded={aberto} aria-controls="opcoes-de-perfil"
      onClick={() => setAberto(!aberto)}>
      <span>{persona.nome}</span><span>Trocar perfil <ChevronDown aria-hidden size={16} /></span>
    </button>
    <nav aria-label="Perfis da ARINI" id="opcoes-de-perfil" className="vitrine-personas" data-aberto={aberto}>
      {PERSONAS_PLANOS.map((item) => <Link key={item.id} href={"/planos?perfil=" + item.id + "#perfis"}
        aria-current={persona.id === item.id ? "page" : undefined}>{item.nome}</Link>)}
    </nav>
  </>;
}
