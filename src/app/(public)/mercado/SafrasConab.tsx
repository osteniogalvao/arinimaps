import { Wheat } from "lucide-react";
import { formatarDataHora } from "@/lib/mercado/formato";
import { formatarHectares, formatarToneladas, nomeProduto, type SafraProduto } from "@/lib/mercado/safras";

/**
 * Safras de grãos da CONAB dentro das cotações (pedido de 17/11: a camada
 * "CONAB safras" do Dados Fazenda é tabela, não mapa). Produção, área e
 * produtividade nacionais da safra mais recente, com a variação sobre a
 * anterior e os maiores estados produtores. Sem dados, a seção não aparece.
 */
export default function SafrasConab({ safras }: { safras: SafraProduto[] }) {
  if (!safras.length) return null;
  const { safra, levantamento } = safras[0];
  const atualizado = safras.reduce<string | null>((m, s) => (s.atualizadoEm && (!m || s.atualizadoEm > m) ? s.atualizadoEm : m), null);

  return (
    <section id="safras" aria-labelledby="titulo-safras" className="mt-12 scroll-mt-24">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ouro">CONAB · Safra {safra}</p>
      <h2 id="titulo-safras" className="lp-display mt-1 text-3xl text-texto">Safras de grãos</h2>
      <p className="mt-2 max-w-3xl text-sm text-texto-2">
        Estimativa nacional de produção, área plantada e produtividade{levantamento && <>, {levantamento.toLowerCase()}</>}.
        A variação compara com a safra anterior. Pelo WhatsApp, envie SAFRA e o nome da cultura.
      </p>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {safras.slice(0, 12).map((s) => (
          <li key={s.produto} className="cartao space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="flex items-center gap-2 font-semibold text-texto">
                <Wheat className="size-4 text-verde" aria-hidden /> {nomeProduto(s.produto)}
              </h3>
              {s.variacao != null && (
                <span className={`text-sm font-semibold tabular-nums ${s.variacao >= 0 ? "text-verde" : "text-critico"}`}
                  title={s.anterior ? `Safra ${s.anterior.safra}: ${formatarToneladas(s.anterior.producaoMilT)}` : undefined}>
                  {s.variacao >= 0 ? "+" : ""}{s.variacao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                </span>
              )}
            </div>
            <p className="text-2xl font-semibold tabular-nums text-texto">{formatarToneladas(s.producaoMilT)}</p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-xs text-texto-2">Área plantada</dt><dd className="tabular-nums">{formatarHectares(s.areaMilHa)}</dd></div>
              <div><dt className="text-xs text-texto-2">Produtividade</dt>
                <dd className="tabular-nums">{s.produtividade ? `${Math.round(s.produtividade).toLocaleString("pt-BR")} kg/ha` : "—"}</dd></div>
            </dl>
            {s.ufs.length > 0 && (
              <p className="text-xs text-texto-2">
                Maiores produtores: {s.ufs.slice(0, 4).map((u) => `${u.uf} ${formatarToneladas(u.producaoMilT)}`).join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-texto-2">
        Fonte:{" "}
        <a href="https://portaldeinformacoes.conab.gov.br/safra-serie-historica-graos.html" target="_blank" rel="noopener noreferrer"
          className="underline hover:text-verde">CONAB, série histórica e levantamentos de safra de grãos</a>.
        {atualizado && <> Coletado em {formatarDataHora(atualizado)}.</>}
      </p>
    </section>
  );
}
