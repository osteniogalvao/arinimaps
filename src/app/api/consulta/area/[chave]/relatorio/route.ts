import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { carregarConsultaArea } from "@/lib/geo/consultaArea";
import { acessoAtual } from "@/lib/planos-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pdfDaArea, type SecaoPdf } from "@/lib/relatorio/pdf-area";
import { dataDaBase, opcoesRelatorio, secoesResultados } from "@/lib/relatorio/opcoes-area";
import { rotuloRaio } from "@/lib/rural/raios";

export async function GET(request: Request, ctx: { params: Promise<{chave: string}> }) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const { userId, acesso } = await acessoAtual();
  if (!userId) return Response.json({error:"Entre para baixar o relatório da sua área."}, {status:401});
  const opcoes = opcoesRelatorio(request, false);
  if (typeof opcoes === "string") return Response.json({error:opcoes}, {status:400});
  if (opcoes.modelo === "completo" && !acesso.recursos.has("relatorio_territorial")) {
    return Response.json({error:"Seu plano não inclui o relatório completo."}, {status:403});
  }
  const id = (await ctx.params).chave.replace(/^geo:/,"");
  if (!/^[0-9a-f]{40}$/.test(id)) return Response.json({error:"Área inválida."}, {status:400});
  const chave = "geo:" + id;
  const {data:area, error} = await supabaseAdmin().rpc("fn_ler_area_propria", {p_chave:chave,p_user:userId});
  if (error) return Response.json({error:"A consulta à área está indisponível."}, {status:503});
  if (!area?.geometry) return Response.json({error:"Área não encontrada nesta conta."}, {status:404});
  const secoes: SecaoPdf[] = [];
  if (opcoes.escolhidas.has("cadastro")) secoes.push({titulo:"Área desenhada",linhas:[
    "Área aproximada: " + Number(area.area_ha).toLocaleString("pt-BR",{maximumFractionDigits:4}) + " ha",
    "Município: " + (area.municipio ?? "Não identificado na cobertura disponível"),
    "Data de registro: " + dataDaBase(area.created_at),
    "Raio de consulta: " + rotuloRaio(opcoes.raioM),
  ]});
  if (opcoes.escolhidas.has("fontes")) {
    const consulta = await carregarConsultaArea(chave, {relatorio:true, raioM:opcoes.raioM});
    secoes.push(...secoesResultados(consulta.lista));
  }
  secoes.push({titulo:"Sobre o perímetro",linhas:["Área desenhada pelo titular sobre o mapa. O contorno é aproximado e não substitui levantamento técnico, matrícula ou certificação."]});
  const titulo = "Relatório territorial " + (opcoes.personalizado ? "personalizado" : opcoes.modelo);
  const bytes = await pdfDaArea(titulo, id.slice(0,12), secoes, opcoes.escolhidas.has("mapa") ? area.geometry : null, "desenho");
  return new Response(new Uint8Array(bytes).buffer, {headers:{
    "Content-Type":"application/pdf", "Cache-Control":"private, no-store",
    "Content-Disposition":opcoes.disposicao + '; filename="ARINI-area-' + id.slice(0,12) + '-' + opcoes.modelo + '.pdf"',
  }});
}
