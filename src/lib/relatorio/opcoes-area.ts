import type { FonteConsultada } from "@/components/rural/FontesLista";
import { alcanceDaFonte, raioConsulta } from "@/lib/rural/raios";
import type { SecaoPdf } from "./pdf-area";

export function dataDaBase(valor?: string | null) {
  if (!valor) return "Sem data informada";
  const dia = /^(\d{4})-(\d{2})-(\d{2})(?:T| |$)/.exec(valor);
  return dia ? `${dia[3]}/${dia[2]}/${dia[1]}` : valor;
}

export function opcoesRelatorio(request: Request, car: boolean) {
  const opcoes = new URL(request.url).searchParams;
  const raioM = raioConsulta(opcoes.get("raio_m"), 2000);
  if (raioM === null) return "Raio de consulta inválido.";
  const modelo = opcoes.get("modelo") ?? "simples";
  const disposicao = opcoes.get("visualizar") === "1" ? "inline" : "attachment";
  if (!["simples","completo"].includes(modelo)) return "Modelo inválido.";
  const secoesPermitidas = ["cadastro", "mapa", "matricula", "uso", ...(modelo === "completo" ? [...(car ? ["ambiente"] : []), "clima", "fontes"] : [])];
  const escolhidas = new Set(opcoes.has("personalizar") ? opcoes.getAll("secao") : secoesPermitidas);
  if (!escolhidas.size || [...escolhidas].some(s => !secoesPermitidas.includes(s))) {
    return "Escolha ao menos uma seção disponível no modelo.";
  }
  return {raioM, modelo, disposicao, escolhidas, personalizado:opcoes.has("personalizar")};
}

export function secoesResultados(lista: FonteConsultada[]) {
  const secoes: SecaoPdf[] = [];
  const validas = lista.filter(f => f.consulta && !f.consulta.erro).length;
  if (lista.length) secoes.push({titulo:"Consultas às fontes oficiais",linhas:[
    `${validas} de ${lista.length} fontes com resposta disponível na emissão. Os resultados abaixo correspondem à área de busca indicada em cada consulta.`
  ]});
  else secoes.push({titulo:"Consultas às fontes oficiais",linhas:["A lista de fontes não estava disponível na emissão."]});
  for (const f of lista) {
    const c = f.consulta;
    const linhas = !c ? ["Fonte ainda não consultada."] : c.erro ? ["Fonte indisponível na consulta de " + dataDaBase(c.consultado_em) + "."] :
      [`Consulta de ${dataDaBase(c.consultado_em)} · ${alcanceDaFonte(f.id,c.raio_m)} · registros encontrados: ${Number(c.quantidade).toLocaleString("pt-BR")}.`,
      ...(c.resultado?.ultima_falha ? ["A tentativa mais recente falhou. Exibindo o último retorno válido."] : []),
      ...(c.resultado?.itens ?? []).map(i => [i.titulo,i.detalhe].filter(Boolean).join(" · "))];
    secoes.push({titulo:f.nome + " · " + f.orgao,linhas});
  }
  return secoes;
}
