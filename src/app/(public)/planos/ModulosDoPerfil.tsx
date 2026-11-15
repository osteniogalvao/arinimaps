import modulos from "./modulos-dos-perfis.json";

const porPerfil: Record<string, { nome: string; itens: string[][] }[]> = modulos;

export default function ModulosDoPerfil({ perfil }: { perfil: string }) {
  const grupos = porPerfil[perfil];
  if (!grupos?.length) return null;
  return <section aria-labelledby="escopo-titulo">
    <h2 id="escopo-titulo" className="lp-display text-3xl md:text-4xl">Recursos por área de trabalho</h2>
    <p className="mt-2 mb-4 max-w-3xl text-texto-2">{perfil === "comprar" ?
      "Os dados disponíveis variam conforme a documentação do anúncio e a cobertura das fontes." :
      "Consulte o escopo previsto de cada área. A equipe confirma quais módulos já estão disponíveis antes da contratação."}</p>
    <div className="grid items-start gap-3 md:grid-cols-2">
      {grupos.map((grupo) => <details key={grupo.nome} className="cartao overflow-hidden">
        <summary className="cursor-pointer px-5 py-4 font-bold text-texto">{grupo.nome}</summary>
        <ul className="divide-y divide-linha border-t border-linha px-5">
          {grupo.itens.map(([nome, nivel]) => <li className="flex items-start justify-between gap-3 py-3 text-sm" key={nome}>
            <span>{nome}</span><small className="max-w-28 text-right font-semibold text-texto-2">{nivel}</small>
          </li>)}
        </ul>
      </details>)}
    </div>
  </section>;
}
