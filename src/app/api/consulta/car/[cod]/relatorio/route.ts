import { supabaseAdmin } from "@/lib/supabase/admin";
import { consultarCar } from "@/lib/geo/car";
import { acessoAtual } from "@/lib/planos-servidor";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { carregarConsultaArea } from "@/lib/geo/consultaArea";
import { pdfDaArea, type SecaoPdf } from "@/lib/relatorio/pdf-area";
import { TEMAS_CAR, type TemaCar } from "@/lib/geo/temasCar";

const tipos: Record<string,string> = { IRU: "Imóvel rural", AST: "Assentamento", PCT: "Povos e comunidades tradicionais" };
const situacoes: Record<string,string> = { AT: "Ativo", PE: "Pendente", SU: "Suspenso", CA: "Cancelado" };
function dataDaBase(valor?: string | null) {
  if (!valor) return "Sem data informada";
  const dia = /^(\d{4})-(\d{2})-(\d{2})(?:T| |$)/.exec(valor);
  return dia ? `${dia[3]}/${dia[2]}/${dia[1]}` : valor;
}
export async function GET(request: Request, ctx: RouteContext<"/api/consulta/car/[cod]/relatorio">) {
  const opcoes = new URL(request.url).searchParams;
  const modelo = opcoes.get("modelo") ?? "simples";
  const disposicao = opcoes.get("visualizar") === "1" ? "inline" : "attachment";
  if (!["simples","completo"].includes(modelo)) return Response.json({ error: "Modelo inválido." }, { status: 400 });
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const cod = (await ctx.params).cod.toUpperCase();
  if (!/^[A-Z]{2}-\d{7}-[0-9A-F.-]{20,45}$/i.test(cod)) return Response.json({ error: "Código CAR inválido." }, { status: 400 });
  if (modelo === "completo") {
    const { userId, acesso } = await acessoAtual();
    if (!userId || !acesso.recursos.has("relatorio_territorial")) return Response.json({error:"O relatório completo exige acesso profissional."},{ status:userId ? 403 : 401 });
  }
  const db = supabaseAdmin();
  const {data, error} = await consultarCar(cod);
  if (error) return Response.json({ error:"A consulta está indisponível." }, {status:503});
  if (!data?.properties) return Response.json({ error:"Perímetro do CAR não encontrado na consulta." }, {status:404});
  const p = data.properties;
  const hectares = Number(p.area_ha);
  const secoes: SecaoPdf[] = [{ titulo:"Dados do Cadastro Ambiental Rural", linhas:[
    "Município: " + (p.municipio ?? "Não informado") + (p.cod_ibge ? " · IBGE " + p.cod_ibge : ""),
    "Tipo de imóvel: " + (tipos[p.tipo ?? ""] ?? p.tipo ?? "Não informado"),
    "Área declarada: " + (p.area_ha == null || !Number.isFinite(hectares) ? "Não informada" : hectares.toLocaleString("pt-BR",{maximumFractionDigits:4}) + " ha"),
    "Situação cadastral: " + (situacoes[p.status ?? ""] ?? p.status ?? "Não informada"),
    "Condição da análise: " + (p.condicao ?? "Não informada"),
    "Fonte: SICAR · atualização do cadastro: " + dataDaBase(p.atualizado_sicar),
    ...(p.importado_em ? ["Cópia consultada pela ARINI em " + dataDaBase(p.importado_em) + "."] : []),
  ]}];
  if (modelo === "completo") {
    const [consulta, ambiente] = await Promise.all([
      carregarConsultaArea("car:" + cod, { excluir: ["car"], relatorio: true }),
      db.rpc("fn_ambiente_por_car", { p_cod: cod }),
    ]);
    const contagem = new Map<string,number>();
    for (const f of ambiente.data?.features ?? []) {
      const tema = f.properties?.tema;
      if (typeof tema !== "string") continue;
      if (tema !== "area_imovel") contagem.set(tema, (contagem.get(tema) ?? 0) + 1);
    }
    secoes.push({titulo:"Ambiente no perímetro cadastrado", linhas:ambiente.error ? ["Base ambiental indisponível na emissão."] : contagem.size ? Array.from(contagem, ([k,v]) => (k === "nascente" ? "Nascentes aproximadas (FBDS)" : TEMAS_CAR[k as TemaCar] ?? k) + ": " + v.toLocaleString("pt-BR") + (v === 1 ? " feição mapeada." : " feições mapeadas.")) : ["Sem feições na cobertura ambiental disponível para este perímetro."]});
    const validas = consulta.lista.filter(f => f.consulta && !f.consulta.erro).length;
    if (consulta.lista.length) secoes.push({titulo:"Consultas às fontes oficiais",linhas:[
      `${validas} de ${consulta.lista.length} fontes com resposta disponível na emissão. Os resultados abaixo correspondem à área de busca indicada em cada consulta.`
    ]});
    else secoes.push({titulo:"Consultas às fontes oficiais",linhas:["A lista de fontes não estava disponível na emissão."]});
    for (const f of consulta.lista) {
      const c = f.consulta;
      const linhas = !c ? ["Fonte ainda não consultada."] : c.erro ? ["Fonte indisponível na consulta de " + dataDaBase(c.consultado_em) + "."] :
        [`Consulta de ${dataDaBase(c.consultado_em)} · entorno pesquisado: ${Number(c.raio_m).toLocaleString("pt-BR")} m · registros encontrados: ${Number(c.quantidade).toLocaleString("pt-BR")}.`,
        ...(c.resultado?.ultima_falha ? ["A tentativa mais recente falhou. Exibindo o último retorno válido."] : []),
        ...(c.resultado?.itens ?? []).map(i => [i.titulo,i.detalhe].filter(Boolean).join(" · "))];
      secoes.push({titulo:f.nome + " · " + f.orgao,linhas});
    }
  }
  secoes.push({ titulo:"Sobre os dados", linhas:["O CAR é autodeclarado. Esta consulta é informativa e não substitui certidão, matrícula ou vistoria. A ausência de registro na base não confirma ausência de restrição no terreno."] });
  const bytes = await pdfDaArea(modelo === "completo" ? "Relatório territorial completo" : "Relatório territorial simples", cod, secoes, data.geometry);
  return new Response(new Uint8Array(bytes).buffer, {headers:{"Content-Type":"application/pdf","Content-Disposition":`${disposicao}; filename="ARINI-${cod}-${modelo}.pdf"`,"Cache-Control":"private, no-store"}});
}
