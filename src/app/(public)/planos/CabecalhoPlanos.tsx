import Link from "next/link";
import { PERSONAS_PLANOS, type PersonaPlano } from "@/lib/planos";
import "./vitrine.css";

const TITULOS: Record<string, [string, string]> = {
  vender: ["Como você deseja", "utilizar a ARINI?"],
  corretor: ["Seu CRM, seus dados", "e a rede ARINI"],
  produtor: ["Sua fazenda medida,", "planejada e gerida"],
  tecnico: ["Dados do território", "e o CRM da sua profissão"],
  comprar: ["Compre com dados reais,", "com segurança"],
  leiloeiro: ["Seus leilões em destaque,", "com a análise do imóvel"],
  instituicao: ["O território do seu município,", "em um só sistema"],
  empresa: ["Do terreno ao lote vendido,", "em um só sistema"],
  anunciar: ["Venda seu imóvel", "e acompanhe cada passo"],
  correspondente: ["Clientes com o imóvel escolhido,", "direto no seu atendimento"],
};

export default function CabecalhoPlanos({ persona }: { persona: PersonaPlano }) {
  const titulo = TITULOS[persona.id] ?? ["Como você deseja", "utilizar a ARINI?"];
  return <header className="vitrine-hero" id="perfis">
    <div className="vitrine-interno">
      <p className="vitrine-sobretitulo">Planos e acesso</p>
      <h1>{titulo[0]}<br /><span>{titulo[1]}</span></h1>
      <p className="vitrine-intro">{persona.id === "vender" ? "Escolha como usar a ARINI. Você pode adicionar outros perfis à sua conta." : persona.chamada}</p>
      <nav aria-label="Perfis da ARINI" className="vitrine-personas">
        {PERSONAS_PLANOS.map((item) => <Link key={item.id} href={"/planos?perfil=" + item.id + "#planos"}
          aria-current={persona.id === item.id ? "page" : undefined}>{item.nome}</Link>)}
      </nav>
    </div>
  </header>;
}
