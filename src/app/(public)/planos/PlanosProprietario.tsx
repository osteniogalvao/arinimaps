import Link from "next/link";
import { ArrowRight, Check, Minus } from "lucide-react";
import { PLANOS_CATALOGO } from "@/lib/planos-catalogo";
import { COMECAR, COMPARATIVO, ETAPAS_MUNDO, VENDER, type TipoImovel } from "./proprietario-textos";

/**
 * Partes da página "Planos para proprietários" (modelos do Carlos, 25/11/2026):
 * troca rural/urbano, "Como você quer começar?", "Vender com a ARINI",
 * "Seu mundo cresce com você" e o comparativo de cada caminho.
 */
type Links = { vender: string; gratuito: string };

export function TrocaTipoImovel({ tipo }: { tipo: TipoImovel }) {
  return <nav aria-label="Tipo de imóvel" className="vitrine-tipo">
    {(["rural", "urbano"] as const).map((t) => <Link key={t} href={"/planos?perfil=vender&imovel=" + t + "#planos"} aria-current={tipo === t ? "page" : undefined}>
      Imóvel {t}
    </Link>)}
  </nav>;
}

export function ComoComecar({ tipo, links }: { tipo: TipoImovel; links: Links }) {
  const destino = { vender: links.vender, planos: "#pacotes", gratuito: links.gratuito };
  return <section aria-labelledby="como-comecar" className="space-y-4">
    <h3 id="como-comecar" className="vitrine-rotulo">Como você quer começar?</h3>
    <ol className="vitrine-comecar">
      {COMECAR[tipo].map((c, i) => <li key={c.titulo} data-principal={i === 0 || undefined}>
        <span className="numero" aria-hidden>{i + 1}</span>
        <p className="titulo">{c.titulo}</p>
        <p className="texto">{c.texto}</p>
        <Link href={destino[c.destino]} className="acao">{c.acao} <ArrowRight aria-hidden size={16} /></Link>
      </li>)}
    </ol>
  </section>;
}

export function VenderComArini({ tipo, links }: { tipo: TipoImovel; links: Links }) {
  const v = VENDER[tipo];
  return <section aria-labelledby="vender-arini" className="vitrine-vender" id="vender">
    <p className="vitrine-sobretitulo">Vender com a ARINI</p>
    <h2 id="vender-arini">Divulgou, o sistema é todo seu</h2>
    <p className="intro">Quando você assina a exclusividade e divulga o imóvel com a ARINI, tem acesso a tudo do sistema para ele, menos a Ari
      (inteligência artificial), sem mensalidade. Como a sua área já está cadastrada, anunciar leva poucos cliques.</p>
    <ul className="recursos">{v.recursos.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
    <div className="vigencia">
      <div>
        <p className="vitrine-sobretitulo">Enquanto durar a exclusividade</p>
        <p>Todo o acesso ao imóvel anunciado, com a ARINI acompanhando a venda ao seu lado. Anunciar é gratuito; a ARINI recebe 1,9% somente
          se o imóvel for vendido, com exclusividade de 6 ou 12 meses.</p>
      </div>
      <div className="termina">
        <p className="vitrine-sobretitulo">Quando termina ou o imóvel é vendido</p>
        <div className="colunas">
          <div><p className="font-bold">Continua com você</p>
            <ul>{v.continua.map((i) => <li key={i}><Check aria-hidden size={15} />{i}</li>)}</ul></div>
          <div><p className="font-bold">Deixa de ter</p>
            <ul>{v.deixa.map((i) => <li key={i}><Minus aria-hidden size={15} />{i}</li>)}</ul></div>
        </div>
      </div>
    </div>
    <Link href={links.vender} className="lp-btn vitrine-btn-vermelho">Divulgar meu imóvel grátis <ArrowRight aria-hidden /></Link>
  </section>;
}

export function MundoCresce() {
  const cuidados: [string, boolean][] = [["Área medida e no mapa", true], ["Matrícula guardada no cofre", true],
    ["Conferir o alerta da semana", false], ["Atualizar a documentação que vence", false]];
  const feitos = cuidados.filter(([, ok]) => ok).length;
  return <section aria-labelledby="mundo-cresce" className="space-y-5">
    <div>
      <p className="vitrine-rotulo">Seu mundo cresce com você</p>
      <h2 id="mundo-cresce" className="lp-display text-3xl md:text-5xl text-verde">Quanto mais você cuida, mais ele rende</h2>
      <p className="mt-2 max-w-2xl text-texto-2">Comece sem compromisso e evolua no seu ritmo. Quando chegar a hora de vender, a sua propriedade já
        está medida, documentada e conhecida, e você anuncia de dentro de casa.</p>
    </div>
    <ol className="vitrine-etapas">
      {ETAPAS_MUNDO.map(([titulo, texto, plano], i) => <li key={titulo} data-ultima={i === ETAPAS_MUNDO.length - 1 || undefined}>
        <span className="barras" aria-hidden>{ETAPAS_MUNDO.map((_, j) => <i key={j} data-cheia={j <= i || undefined} />)}</span>
        <p className="font-bold">{titulo}</p><p className="text-sm text-texto-2">{texto}</p><p className="plano">{plano}</p>
      </li>)}
    </ol>
    <div className="vitrine-cuidados">
      <div className="cartao p-5">
        <p className="flex justify-between font-bold">Cuidados desta semana <span className="vitrine-breve">Exemplo</span></p>
        <ul className="mt-3 space-y-2">{cuidados.map(([t, ok]) => <li key={t} className="flex items-center gap-2 text-sm">
          <span className={"grid size-5 place-items-center rounded border " + (ok ? "border-verde bg-verde text-fundo" : "border-linha")}>{ok && <Check size={13} aria-hidden />}</span>
          <span className={ok ? "" : "text-texto-2"}>{t}</span></li>)}</ul>
      </div>
      <div className="nivel">
        <p className="vitrine-sobretitulo">Nível do seu mundo</p>
        <p className="valor">{Math.round((feitos / cuidados.length) * 100)}%</p>
        <span className="barra" aria-hidden><i style={{ width: (feitos / cuidados.length) * 100 + "%" }} /></span>
        <p>Faltam {cuidados.length - feitos} cuidados para deixar sua propriedade em dia.</p>
        <p className="text-xs opacity-75">Exemplo ilustrativo. No painel, o nível acompanha a sua propriedade.</p>
      </div>
    </div>
  </section>;
}

export function ComparativoProprietario({ tipo }: { tipo: TipoImovel }) {
  const c = COMPARATIVO[tipo];
  const gratis = PLANOS_CATALOGO.find((p) => p.id === "proprietario_gratuito")?.limites.propriedades ?? 1;
  const pagos = PLANOS_CATALOGO.find((p) => p.id === "proprietario_monitoramento")?.limites.propriedades ?? 3;
  const [singular, avenda] = c.quais;
  const plural = tipo === "rural" ? "áreas suas" : "imóveis seus";
  const quais = [gratis === 1 ? (tipo === "rural" ? "Uma " : "Um ") + singular : "Até " + gratis + " " + plural, avenda,
    c.quais[2].replace(/\d+/, String(pagos)), c.quais[2].replace(/\d+/, String(pagos)), c.quais[2].replace(/\d+/, String(pagos))];
  const colunas = ["Gratuito", "Vender", "Monitoramento", "Inteligência", "Completo"];
  return <section aria-labelledby="comparar-caminhos" className="space-y-3">
    <h2 id="comparar-caminhos" className="lp-display text-3xl md:text-4xl text-verde">Compare tudo o que cada caminho entrega</h2>
    <p className="text-texto-2">A coluna Vender vale para o imóvel que você divulga com a ARINI e traz tudo, menos a Ari. Os planos pagos cuidam das
      suas propriedades, à venda ou não.</p>
    <div className="vitrine-comparativo" tabIndex={0} role="region" aria-label="O que cada caminho entrega">
      <table>
        <thead><tr><th scope="col"><span className="sr-only">Recurso</span></th>{colunas.map((n) => <th scope="col" key={n}>{n}</th>)}</tr></thead>
        <tbody>
          <tr className="grupo"><th colSpan={6} scope="colgroup">Vale para</th></tr>
          <tr><th scope="row">Quais {tipo === "rural" ? "propriedades" : "imóveis"}</th>{quais.map((q, i) => <td key={i}>{q}</td>)}</tr>
          {c.grupos.map(([grupo, linhas]) => [
            <tr key={grupo} className="grupo"><th colSpan={6} scope="colgroup">{grupo}</th></tr>,
            ...linhas.map(([nome, marcas]) => <tr key={grupo + nome}><th scope="row">{nome}</th>
              {[...marcas].map((m, i) => <td key={i} className="marca">{m === "1"
                ? <><Check aria-hidden size={17} className="text-verde" /><span className="sr-only">Incluído</span></>
                : <><span aria-hidden>–</span><span className="sr-only">Não incluído</span></>}</td>)}</tr>),
          ])}
        </tbody>
      </table>
    </div>
    <p className="text-xs text-texto-2">Medidas, solo e estimativas de mercado são apoio, sem valor de laudo ou avaliação oficial. Itens &quot;Em breve&quot; ainda estão em implantação.</p>
  </section>;
}
