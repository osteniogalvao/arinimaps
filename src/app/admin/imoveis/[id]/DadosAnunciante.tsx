import { formatBRL } from "@/lib/format";

/**
 * 25/11/2026 (Stenio): "a Central deve conseguir visualizar as informações" que o
 * proprietário cadastrou. Antes a ficha mostrava só o checklist; descrição,
 * características, condições e o quadro-resumo do termo ficavam escondidos (o
 * quadro só dentro do texto integral do termo). Aqui vai tudo, em uma lista.
 */

const ROTULO: Record<string, string> = {
  subtipo: "Tipo da unidade", andar: "Andar", unidade: "Unidade",
  medidas_informadas: "Medidas informadas", tour_virtual_url: "Tour virtual",
  quartos: "Quartos", suites: "Suítes", banheiros: "Banheiros", vagas: "Vagas",
  area_construida: "Área construída", area_util: "Área útil",
  aptidao: "Aptidão", benfeitorias: "Benfeitorias", agua: "Água", topografia: "Topografia",
  solo: "Solo", pastagem: "Pastagem", reserva_legal: "Reserva legal", app: "APP",
  energia: "Energia", acesso: "Acesso", distancia_cidade_km: "Distância da cidade (km)",
};
const OCULTAS = new Set(["unidade_area"]);

function textoDe(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (Array.isArray(v)) return v.map(textoDe).filter(Boolean).join(", ");
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${ROTULO[k] ?? k.replace(/_/g, " ")}: ${textoDe(x)}`).join("; ");
  return String(v);
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-texto-2">{rotulo}</dt>
      <dd className="min-w-0 whitespace-pre-line break-words text-texto">{valor}</dd>
    </div>
  );
}

export type DadosDoAnuncio = {
  tipo: string; descricao: string | null; valor: number | null; area_declarada: number | null;
  caracteristicas: Record<string, unknown> | null; condicoes_venda: string | null;
  aceita_permuta: boolean | null; aceita_financiamento: boolean | null; created_at: string;
  lote_quadra?: string | null; lote_numero?: string | null;
};

export default function DadosAnunciante({ p, responsavel, quadro }: {
  p: DadosDoAnuncio;
  responsavel: { nome: string | null; telefone: string | null; papel: string } | null;
  /** 1ª seção do termo assinado (quadro-resumo e Anexo I), quando houver */
  quadro: string[] | null;
}) {
  const carac = Object.entries(p.caracteristicas ?? {}).filter(([k, v]) => !OCULTAS.has(k) && textoDe(v));
  const unidade = p.tipo === "rural" ? "ha" : "m²";
  return (
    <div className="space-y-5 text-[0.95rem]">
      <dl className="divide-y divide-linha">
        {responsavel && <Linha rotulo="Quem cadastrou" valor={`${responsavel.nome ?? "—"} (${responsavel.papel}) · ${responsavel.telefone ?? "sem telefone"}`} />}
        <Linha rotulo="Enviado em" valor={new Date(p.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })} />
        {(p.lote_quadra || p.lote_numero) && <Linha rotulo="Lote da planta" valor={[p.lote_quadra && `Quadra ${p.lote_quadra}`, p.lote_numero && `Lote ${p.lote_numero}`].filter(Boolean).join(" · ")} />}
        <Linha rotulo="Preço pedido" valor={p.valor != null ? formatBRL(p.valor) : "—"} />
        <Linha rotulo="Área declarada" valor={p.area_declarada != null ? `${Number(p.area_declarada).toLocaleString("pt-BR")} ${unidade}` : "—"} />
        <Linha rotulo="Descrição" valor={p.descricao?.trim() || "—"} />
        <Linha rotulo="Condições de venda" valor={p.condicoes_venda?.trim() || "—"} />
        <Linha rotulo="Aceita permuta" valor={p.aceita_permuta ? "Sim" : "Não"} />
        <Linha rotulo="Aceita financiamento" valor={p.aceita_financiamento ? "Sim" : "Não"} />
        {carac.map(([k, v]) => (
          <Linha key={k} rotulo={ROTULO[k] ?? k.replace(/_/g, " ")}
            valor={k === "tour_virtual_url" ? <a className="text-verde underline" href={String(v)} target="_blank" rel="noreferrer">{String(v)}</a> : textoDe(v)} />
        ))}
      </dl>
      {quadro && quadro.length > 0 && (
        <div>
          <h3 className="font-semibold text-texto">Quadro-resumo do termo (como o proprietário preencheu)</h3>
          <p className="mt-1 text-sm text-texto-2">O que aparece como &quot;a completar pela Central&quot; ficou em branco no cadastro: complete na análise.</p>
          <ul className="mt-2 divide-y divide-linha rounded-xl border border-linha px-4">
            {quadro.map((item, i) => (
              <li key={i} className={`py-2 whitespace-pre-line break-words ${item.includes("a completar pela Central") ? "text-alerta" : "text-texto"}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
