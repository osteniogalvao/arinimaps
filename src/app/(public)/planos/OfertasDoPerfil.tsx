"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Minus, Plus } from "lucide-react";
import { textoAcaoOferta, urlAcaoOferta, valorOferta, type OfertaPerfil } from "@/lib/ofertas-perfis";

export default function OfertasDoPerfil({ ofertas, autenticado }: { ofertas: OfertaPerfil[]; autenticado: boolean }) {
  const pacotes = ofertas.filter((o) => o.modalidade !== "complemento");
  const [id, setId] = useState(pacotes[0]?.id);
  const [anual, setAnual] = useState(false);
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const escolhido = pacotes.find((p) => p.id === id);
  if (!escolhido) return <p>As opções deste perfil estão indisponíveis no momento.</p>;
  const extras = ofertas.filter((o) => o.modalidade === "complemento");
  const oferecidos = extras.filter((o) => o.aplica_em.includes(escolhido.id));
  const marcados = oferecidos.filter((o) => quantidades[o.id] > 0);
  const cta = urlAcaoOferta(escolhido, autenticado, anual, marcados.map((o) =>
    ({ ...o, nome: quantidades[o.id] > 1 ? quantidades[o.id] + " × " + o.nome : o.nome })));
  function selecionar(novo: string) {
    if (novo !== id) { setId(novo); setQuantidades({}); }
  }

  return <div className="space-y-7">
    {pacotes.some((p) => p.anual_centavos !== null) && <div className="inline-flex gap-1 rounded-full border border-linha p-1" aria-label="Periodicidade">
      {["Mensal", "Anual"].map((rotulo) => <button type="button" key={rotulo} aria-pressed={anual === (rotulo === "Anual")}
        className={"rounded-full px-5 py-2 text-sm font-bold " + (anual === (rotulo === "Anual") ? "bg-verde text-fundo" : "")}
        onClick={() => setAnual(rotulo === "Anual")}>{rotulo}</button>)}
    </div>}
    <div className="vitrine-grade">
      {pacotes.map((p) => <article key={p.id} data-selecionado={p.id === id} className="vitrine-card gap-3"
        onClick={() => selecionar(p.id)}>
        <h3>{p.nome}</h3>
        <p className="valor">{valorOferta(p, anual)}</p>
        <p className="nota">{p.descricao}</p>
        {p.prazo_dias && <p className="nota">{p.prazo_dias} dias</p>}
        {p.modalidade === "espera" && p.id !== "comprar_creditos" && <span className="estado">Em breve · lista de interesse</span>}
        {p.modalidade === "proposta" && <span className="estado">Ativação por proposta</span>}
        {p.limites.length > 0 && <p className="vitrine-limites">{p.limites.join(" · ")}</p>}
        <ul className="itens-vitrine">{p.detalhes.map((x) => <li key={x}>{x}</li>)}</ul>
        <button type="button" aria-pressed={p.id === id} aria-label={"Selecionar " + p.nome} className="escolher" onClick={() => selecionar(p.id)}>
          {p.id === id ? <><Check size={16} /> Selecionado</> : "Selecionar"}
        </button>
      </article>)}
    </div>
    {extras.length > 0 && <section id="configuracao" className="scroll-mt-24" aria-labelledby="titulo-adicionais">
      <h3 className="lp-display text-3xl" id="titulo-adicionais">Complementos</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {extras.map((extra) => {
          const permitido = oferecidos.includes(extra);
          const qtd = quantidades[extra.id] || 0;
          return <div key={extra.id} className="cartao flex min-w-0 flex-col gap-2 p-4">
            <h4 className="font-semibold">{extra.nome}</h4><p className="text-sm text-texto-2">{extra.descricao}</p>
            <p className="font-semibold">{valorOferta(extra)}{extra.prazo_dias ? " por " + extra.prazo_dias + " dias" : ""}</p>
            {permitido ? <div className="mt-auto flex items-center gap-2">
              <button type="button" disabled={!qtd} aria-label={"Remover " + extra.nome} className="rounded-full border border-linha p-2 disabled:opacity-40"
                onClick={() => setQuantidades({ ...quantidades, [extra.id]: qtd - 1 })}><Minus size={16} /></button>
              <output aria-label={"Quantidade de " + extra.nome}>{qtd}</output>
              <button type="button" disabled={qtd >= 999} aria-label={"Adicionar " + extra.nome} className="rounded-full border border-linha p-2"
                onClick={() => setQuantidades({ ...quantidades, [extra.id]: qtd + 1 })}><Plus size={16} /></button>
            </div> : <p className="mt-auto text-sm">Escolha {pacotes.filter((p) => extra.aplica_em.includes(p.id)).map((p) => p.nome).join(", ")}.</p>}
          </div>;
        })}
      </div>
    </section>}
    <div className="cartao flex flex-wrap items-center justify-between gap-5 p-5">
      <div><h3 className="font-bold">{escolhido.nome}</h3>
        {escolhido.modalidade === "espera" && escolhido.id !== "comprar_creditos" && <p>Registre seu interesse para saber quando a equipe liberar esta oferta.</p>}
        {escolhido.modalidade === "proposta" && <p>Conte à equipe o porte da organização e o que precisa implantar.</p>}
        {marcados.length > 0 && <p className="text-sm">{marcados.map((x) => quantidades[x.id] + " × " + x.nome).join(" · ")}</p>}
      </div>
      <Link href={cta} className="lp-btn lp-btn-verde">{textoAcaoOferta(escolhido, autenticado)} <ArrowRight /></Link>
    </div>
    {pacotes.length > 1 && <section><h3 className="lp-display mb-3 text-3xl">Compare as opções</h3>
      <div className="vitrine-comparativo" tabIndex={0} role="region" aria-label="Comparação das opções">
        <table><thead><tr><th scope="col">Opção</th><th scope="col">Valor</th><th scope="col">Condições</th></tr></thead>
        <tbody>{pacotes.map((p) => <tr key={p.id}><th scope="row">{p.nome}</th><td>{valorOferta(p, anual)}</td>
          <td>{[...p.limites, ...(p.prazo_dias ? [p.prazo_dias + " dias"] : [])].join(" · ")}</td></tr>)}</tbody></table>
      </div>
    </section>}
  </div>;
}
