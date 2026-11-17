import { dataDaBase, opcoesRelatorio, secoesResultados } from "@/lib/relatorio/opcoes-area";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { consultarCar } from "@/lib/geo/car";
import { perfilDaArea } from "@/lib/relatorio/territorio";
import { fontesPublicasCar } from "@/lib/relatorio/fontes-car";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { carregarConsultaArea } from "@/lib/geo/consultaArea";
import { pdfDaArea, type SecaoPdf } from "@/lib/relatorio/pdf-area";
import { TEMAS_CAR, type TemaCar } from "@/lib/geo/temasCar";
import { acessoAtual } from "@/lib/planos-servidor";
import { linkWhatsappValido } from "@/lib/relatorio/link-whatsapp";

const tipos: Record<string,string> = { IRU: "Imóvel rural", AST: "Assentamento", PCT: "Povos e comunidades tradicionais" };
const situacoes: Record<string,string> = { AT: "Ativo", PE: "Pendente", SU: "Suspenso", CA: "Cancelado" };
export async function GET(request: Request, ctx: RouteContext<"/api/consulta/car/[cod]/relatorio">) {
  const opcoes = opcoesRelatorio(request, true);
  if (typeof opcoes === "string") return Response.json({error:opcoes}, {status:400});
  const {raioM, modelo, disposicao, escolhidas} = opcoes;
  const bloqueio = await limiteLeituraMapa(request, "relatorio");
  if (bloqueio) return bloqueio;
  const cod = (await ctx.params).cod.toUpperCase();
  if (!/^[A-Z]{2}-\d{7}-[0-9A-F.-]{20,45}$/i.test(cod)) return Response.json({ error: "Código CAR inválido." }, { status: 400 });
  // 17/11/2026: o modelo completo (fontes oficiais, ambiente e clima) é do plano
  // com relatório territorial, como no relatório da área desenhada. O simples
  // continua público (dados do próprio CAR). Clique no link vai para entrar ou
  // para os planos; chamada de API recebe o erro em JSON.
  // O link que o atendimento do WhatsApp manda vem assinado (o plano já foi conferido).
  if (modelo === "completo" && !linkWhatsappValido(new URL(request.url), cod, modelo)) {
    const { userId, acesso } = await acessoAtual();
    if (!acesso.recursos.has("relatorio_territorial")) {
      const navegador = request.headers.get("accept")?.includes("text/html");
      const volta = "/consulta/car/" + encodeURIComponent(cod);
      if (navegador) {
        return Response.redirect(new URL(userId ? "/planos?recurso=relatorio_territorial" : "/entrar?volta=" + encodeURIComponent(volta), request.url), 303);
      }
      return userId
        ? Response.json({ error: "Seu plano não inclui o relatório completo." }, { status: 403 })
        : Response.json({ error: "Entre para baixar o relatório completo." }, { status: 401 });
    }
  }
  const db = supabaseAdmin();
  const {data, error} = await consultarCar(cod);
  if (error) return Response.json({ error:"A consulta está indisponível." }, {status:503});
  if (!data?.properties) return Response.json({ error:"Perímetro do CAR não encontrado na consulta." }, {status:404});
  const p = data.properties;
  const hectares = Number(p.area_ha);
  const secoes: SecaoPdf[] = [];
  if (escolhidas.has("cadastro")) secoes.push({ titulo:"Dados do Cadastro Ambiental Rural", linhas:[
    "Município: " + (p.municipio ?? "Não informado") + (p.cod_ibge ? " · IBGE " + p.cod_ibge : ""),
    "Tipo de imóvel: " + (tipos[p.tipo ?? ""] ?? p.tipo ?? "Não informado"),
    "Área declarada: " + (p.area_ha == null || !Number.isFinite(hectares) ? "Não informada" : hectares.toLocaleString("pt-BR",{maximumFractionDigits:4}) + " ha"),
    "Situação cadastral: " + (situacoes[p.status ?? ""] ?? p.status ?? "Não informada"),
    "Condição da análise: " + (p.condicao ?? "Não informada"),
    "Fonte: SICAR · atualização do cadastro: " + dataDaBase(p.atualizado_sicar),
    ...(p.importado_em ? ["Cópia consultada pela ARINI em " + dataDaBase(p.importado_em) + "."] : []),
  ]});
  const perfil = perfilDaArea(data.geometry, "car:" + cod, hectares, escolhidas);
  if (escolhidas.has("fontes") || escolhidas.has("ambiente")) {
    const [consulta, ambiente] = await Promise.all([
      escolhidas.has("fontes") ? carregarConsultaArea("car:" + cod, { excluir: ["car"], relatorio: true, raioM }) : null,
      escolhidas.has("ambiente") ? db.rpc("fn_ambiente_por_car", { p_cod: cod }) : null,
    ]);
    const contagem = new Map<string,number>();
    for (const f of ambiente?.data?.features ?? []) {
      const tema = f.properties?.tema;
      if (typeof tema !== "string") continue;
      if (tema !== "area_imovel") contagem.set(tema, (contagem.get(tema) ?? 0) + 1);
    }
    if (ambiente) secoes.push({titulo:"Ambiente no perímetro cadastrado", linhas:ambiente.error ? ["Base ambiental indisponível na emissão."] : contagem.size ? Array.from(contagem, ([k,v]) => (k === "nascente" ? "Nascentes aproximadas (FBDS)" : TEMAS_CAR[k as TemaCar] ?? k) + ": " + v.toLocaleString("pt-BR") + (v === 1 ? " feição mapeada." : " feições mapeadas.")) : ["Sem feições na cobertura ambiental disponível para este perímetro."]});
    secoes.push(...await perfil);
    if (consulta) {
      const fontes = await fontesPublicasCar(cod, raioM, consulta.lista);
      secoes.push(...secoesResultados(fontes.filter(f=>f.consulta)));
      const pendentes = fontes.filter(f=>!f.consulta);
      if(pendentes.length) secoes.push({titulo:"Cobertura complementar",linhas:["Sem resultado disponível nesta emissão: "+pendentes.map(f=>f.nome).join(", ")+"."]});
    }
  } else secoes.push(...await perfil);
  secoes.push({ titulo:"Sobre os dados", linhas:["O CAR é autodeclarado. Esta consulta é informativa e não substitui certidão, matrícula ou vistoria. A ausência de registro na base não confirma ausência de restrição no terreno."] });
  const titulo = opcoes.personalizado ? "Relatório territorial personalizado" : "Relatório territorial " + modelo;
  const bytes = await pdfDaArea(titulo, cod, secoes, escolhidas.has("mapa") ? data.geometry : null);
  return new Response(new Uint8Array(bytes).buffer, {headers:{"Content-Type":"application/pdf","Content-Disposition":`${disposicao}; filename="ARINI-${cod}-${modelo}.pdf"`,"Cache-Control":"private, no-store"}});
}
