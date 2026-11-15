import type { PersonaPlano } from "@/lib/planos";
import NavegacaoPerfis from "./NavegacaoPerfis";
import apresentacoes from "./apresentacao-dos-perfis.json";
import "./vitrine.css";

export function apresentacaoDoPerfil(persona: PersonaPlano) {
  return Object.hasOwn(apresentacoes, persona.id)
    ? apresentacoes[persona.id as keyof typeof apresentacoes]
    : { rotulo: "Planos", titulo: [persona.nome, ""], introducao: persona.chamada, escolha: persona.nome, resumo: "" };
}

export default function CabecalhoPlanos({ persona }: { persona: PersonaPlano }) {
  const { rotulo, titulo, introducao } = apresentacaoDoPerfil(persona);

  return <header className="vitrine-hero" id="perfis">
    <div className="vitrine-interno">
      <p className="vitrine-sobretitulo">{rotulo}</p>
      <h1>{titulo[0]}{titulo[1] && <><br /><span>{titulo[1]}</span></>}</h1>
      <p className="vitrine-intro">{introducao}</p>
      <NavegacaoPerfis key={persona.id} persona={persona} />
    </div>
  </header>;
}
